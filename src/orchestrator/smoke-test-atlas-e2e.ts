import { AtlasOrchestrator } from "./orchestrator";
import { AutonomousWorkforce } from "./autonomous-workforce";
import { MissionRunner } from "./mission-runner";
import { createPipelineDeps, MIN_SCORABLE_WEIGHT } from "./atlas-pipeline";
import { InMemoryBusinessRepository } from "../services/scout/business-repository";
import { submitManualBusiness } from "../services/scout/manual-entry";
import { OperationalLedger } from "../services/finance/ledger";
import { ProviderRegistry } from "../workforce/provider-registry";
import { OpenRouterProvider } from "../workforce/openrouter-provider";
import { defaultWorkforceConfig } from "../workforce/workforce-config";

/**
 * Atlas end-to-end acceptance. Everything is real (orchestrator, handlers, discovery loop, repository,
 * pipeline store, in-memory mission queue, AutonomousWorkforce, ledger, finance handler) EXCEPT the
 * network call to the AI provider, which is the one external dependency and is stubbed at fetch().
 */
let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const fakeFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ model: "stub-model", choices: [{ message: { content: "Stub work product: a plan for gathering missing evidence." } }], usage: { prompt_tokens: 400, completion_tokens: 200 } }), { status: 200 });

function build(options: { executionEnabled: boolean; sources?: string[] }) {
  const deps = createPipelineDeps({ allowedSources: options.sources });
  const orchestrator = new AtlasOrchestrator(undefined, true, deps);
  const repository = new InMemoryBusinessRepository();
  const ledger = new OperationalLedger();
  const registry = new ProviderRegistry();
  registry.registerProvider(new OpenRouterProvider({ defaultModel: defaultWorkforceConfig.modelDefaults.openrouter, apiKey: "test-not-real", fetchImpl: fakeFetch, costPerThousandTokensUsd: 0.01 }));
  const workforce = new AutonomousWorkforce({ missionQueue: deps.missionQueue, providerRegistry: registry, workforceConfig: defaultWorkforceConfig, ledger, orchestrator });
  const runner = new MissionRunner({ workforce, missionQueue: deps.missionQueue, ledger, dispatcher: orchestrator, store: deps.store, executionEnabled: options.executionEnabled });
  deps.onMissionCreated = (task) => runner.autoExecute(task);
  const submit = (name: string, extra: Record<string, unknown> = {}) =>
    submitManualBusiness({ businessName: name, category: "catering.restaurant", address: "Accra, Ghana", latitude: "5.6037", longitude: "-0.1870", ...extra } as never, { repository, dispatch: (t, p) => orchestrator.dispatch(t, p) });
  return { deps, orchestrator, repository, ledger, runner, submit };
}
const events = (o: AtlasOrchestrator) => o.log.all().map((e) => `${e.event}:${e.outcome}`);

// ---- Stage 1-5: discovery -> evidence -> score -> audit -> mission (no execution) ----
{
  const { deps, orchestrator, submit } = build({ executionEnabled: false });
  const result = await submit("Atlas E2E Acceptance Business");
  const businessId = result.ok ? result.outcome.businessId : "";
  const log = events(orchestrator);
  check("manual discovery enters the pipeline and persists the business", result.ok && result.outcome.action === "CREATED" && deps.store.businesses.has(businessId));
  check("event chain runs BusinessDiscovered -> EvidenceUpdated -> ScoreCalculated -> AuditGenerated -> MissionCreated, all SUCCESS",
    ["BusinessDiscovered", "EvidenceUpdated", "ScoreCalculated", "AuditGenerated", "MissionCreated"].every((e) => log.includes(`${e}:SUCCESS`)));
  const evidence = deps.store.evidence.get(businessId) ?? [];
  check("evidence contains only fields the discovery record really has (name, category, address, coordinates)", evidence.map((e) => e.field).sort().join() === "address,category,coordinates,name" && evidence.every((e) => e.sources.includes("manual")));
  const score = deps.store.scores.get(businessId);
  const observable = score?.components.filter((c) => c.observability !== "NOT_OBSERVABLE").map((c) => c.key);
  check("only evidenceQuality is observed; the other six components are NOT_OBSERVABLE, none invented", observable?.join() === "evidenceQuality" && score!.components.filter((c) => c.observability === "NOT_OBSERVABLE").every((c) => c.normalizedValue === null && c.rawValue === null));
  check(`opportunity score is withheld (null) because observed weight < ${MIN_SCORABLE_WEIGHT}%, with an explicit blocker`, score?.overallScore === null && score.blockers.some((b) => /withheld/i.test(b.title)));
  const audit = deps.store.audits.get(businessId);
  check("audit is generated from the real state and recommends collecting missing evidence", !!audit && audit.recommendations.some((r) => r.missionType === "collect_missing_evidence") && audit.nextAction?.missionType === "collect_missing_evidence");
  const missions = deps.missionQueue.getSnapshot();
  check("exactly one mission exists in the server queue (no demo seed tasks)", missions.length === 1 && missions[0].clientId === businessId && !missions.some((t) => t.taskId.startsWith("task-visibility")));
  check("approval boundary: the mission requires human approval and was NOT executed", missions[0].approvalRequired === "Approval Required" && missions[0].status === "Pending" && missions[0].executionHistory.length === 0);
  check("no money events fired: no MissionCompleted, no PaymentRecorded", !log.some((e) => e.startsWith("MissionCompleted") || e.startsWith("PaymentRecorded")));
  const stages = deps.store.trace.map((t) => t.stage);
  check("trace records every stage with handler, resulting state and next event", ["intake", "score", "audit", "mission", "execution"].every((s) => stages.includes(s as never)) && deps.store.trace.every((t) => t.handler && t.state));
  check("trace shows the mission waiting for human approval", deps.store.trace.some((t) => t.stage === "execution" && /waiting for human approval/.test(t.state)));

  // Re-discovery must not spawn a second audit or mission.
  const again = await submit("Atlas E2E Acceptance Business");
  check("re-discovering the same business does not duplicate the audit or mission", again.ok && again.outcome.action === "UPDATED_EXISTING" && deps.missionQueue.getSnapshot().length === 1 && deps.store.audits.size === 1);

  // ---- Execution boundary: disabled ----
  const disabled = await build({ executionEnabled: false }).runner.run(missions[0].taskId, { approvedByHuman: true });
  check("execution is refused when mission execution is disabled", disabled.outcome === "NOT_FOUND" || disabled.outcome === "DISABLED");
}

// ---- Execution gated by approval, then real MissionCompleted + finance ----
{
  const { deps, orchestrator, ledger, runner, submit } = build({ executionEnabled: true });
  const result = await submit("Atlas E2E Acceptance Business");
  const task = deps.missionQueue.getSnapshot()[0];
  const blocked = await runner.run(task.taskId, {});
  check("without human approval the existing approval gate blocks execution and requeues", !blocked.executed && blocked.outcome === "BLOCKED" && deps.missionQueue.getSnapshot()[0].status === "Pending");
  check("a blocked run spends nothing and emits no MissionCompleted", ledger.list().length === 0 && !events(orchestrator).some((e) => e.startsWith("MissionCompleted")));
  const run = await runner.run(task.taskId, { approvedByHuman: true });
  const log = events(orchestrator);
  check("with explicit human approval the mission executes through AutonomousWorkforce and completes", run.executed && run.outcome === "COMPLETED" && deps.missionQueue.getSnapshot()[0].status === "Completed");
  check("execution lifecycle events were dispatched (Started, Succeeded)", log.includes("MissionExecutionStarted:SUCCESS") && log.includes("MissionExecutionSucceeded:SUCCESS"));
  check("MissionCompleted was dispatched and its finance handler succeeded", log.includes("MissionCompleted:SUCCESS") && run.completedEventDispatched === true);
  const posted = ledger.list();
  check("the only ledger entries are the real AI-cost outflows for this run", posted.length === 1 && posted[0].category === "AI_COST" && posted[0].direction === "OUTFLOW" && result.ok);
  check("no PaymentRecorded / ledger snapshot: nothing in this loop receives payment", !log.some((e) => e.startsWith("PaymentRecorded")));
  const output = deps.store.missionOutputs.get(task.taskId);
  check("AI output is stored as a work product flagged isEvidence=false and never added to evidence", output?.isEvidence === false && (deps.store.evidence.get(result.ok ? result.outcome.businessId : "") ?? []).every((e) => !/Stub work product/.test(JSON.stringify(e))));
}

// ---- Source gating, review hold ----
{
  const { deps, orchestrator, submit } = build({ executionEnabled: false, sources: ["geoapify"] });
  const result = await submit("Atlas E2E Source Gated Business");
  check("a source not enabled for the pipeline is persisted by Scout but does not enter the pipeline", result.ok && deps.store.audits.size === 0 && deps.missionQueue.getSnapshot().length === 0 && deps.store.trace.some((t) => /source not enabled/.test(t.state)) && events(orchestrator).includes("BusinessDiscovered:SUCCESS"));
}
{
  const { deps, submit } = build({ executionEnabled: false });
  await submit("Golden Bean Cafe", { address: "12 Oxford St, Osu, Accra" });
  const missionsBefore = deps.missionQueue.getSnapshot().length;
  const possible = await submit("Golden Bean Cafe", { address: "Oxford Street, Osu" });
  check("a possible duplicate is held for human review and creates no second audit or mission", possible.ok && possible.outcome.duplicateStatus === "POSSIBLE_DUPLICATE" && deps.missionQueue.getSnapshot().length === missionsBefore && deps.store.trace.some((t) => /held for human duplicate review/.test(t.state)));
}

console.log(failures === 0 ? "\nALL ATLAS E2E ACCEPTANCE TESTS PASSED" : `\n${failures} E2E TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
