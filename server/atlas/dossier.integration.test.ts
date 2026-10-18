import test from "node:test";
import assert from "node:assert/strict";
import { AtlasOrchestrator } from "../../src/orchestrator/orchestrator";
import { AutonomousWorkforce } from "../../src/orchestrator/autonomous-workforce";
import { MissionRunner } from "../../src/orchestrator/mission-runner";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";
import { InMemoryBusinessRepository } from "../../src/services/scout/business-repository";
import { submitManualBusiness } from "../../src/services/scout/manual-entry";
import { OperationalLedger } from "../../src/services/finance/ledger";
import { ProviderRegistry } from "../../src/workforce/provider-registry";
import { OpenRouterProvider } from "../../src/workforce/openrouter-provider";
import { defaultWorkforceConfig } from "../../src/workforce/workforce-config";
import { stubCollectors } from "../../src/orchestrator/atlas-test-harness";
import { DossierEngine, STAGES } from "./dossier";

/**
 * Real stack: manual entry -> orchestrator -> evidence collectors -> score -> audit, then the dossier engine drives real
 * missions through the real MissionRunner + AutonomousWorkforce + OpenRouterProvider. ONLY the outbound HTTP call
 * (the AI provider and web search) is replaced with a scripted stub, so this is NOT a live-provider verification.
 */
const REPLY: Record<string, unknown> = {
  "Business profile": { name: "Joe's Cafe", industry: "cafe", productsServices: ["coffee"], location: "Accra", targetAudience: "locals", website: "https://joescafe.example", socialAccounts: [], brandNotes: "", facts: [{ claim: "Sells coffee", basis: "verified", sourceRefs: ["S1"], confidence: "medium" }], unknowns: [] },
  "Brand and digital presence audit": { summary: "Has a basic site", strengths: [{ text: "Has a website", basis: "verified", sourceRefs: ["S1"] }], weaknesses: [], gaps: [{ text: "No social accounts found", basis: "unknown", sourceRefs: [] }], improvementOpportunities: [] },
  "SWOT analysis": { strengths: [{ text: "Local niche", basis: "hypothesis", sourceRefs: [] }], weaknesses: [], opportunities: [], threats: [] },
  "Growth opportunities": { recommendations: [{ title: "Claim social handles", area: "social", rationale: "none found", priority: "high", effort: "low", basis: "hypothesis", sourceRefs: [] }] },
  "Action plan and follow-ups": { dossierSummary: "ok", actionPlan: [{ title: "Claim handles", description: "d", owner: "Atlas", timeframe: "1 week" }], followUps: [{ title: "Email the owner", description: "draft", assignedAI: "closer", external: true }], limitations: [] },
};

test("real MissionRunner/Workforce runs every dossier stage; results persist on the store; follow-ups stay behind server-side approval", async () => {
  const deps = createPipelineDeps({ collectors: stubCollectors() });
  const orchestrator = new AtlasOrchestrator(undefined, true, deps);
  const ledger = new OperationalLedger();
  const stages: string[] = [];
  const fakeFetch: typeof fetch = async (_u, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const prompt = body.messages.map((m: { content: string }) => m.content).join("\n");
    const title = Object.keys(REPLY).find((t) => prompt.includes(`TASK: ${t}.`));
    if (!title) return new Response("unexpected prompt", { status: 500 });
    stages.push(title);
    return new Response(JSON.stringify({ model: "stub-model", choices: [{ message: { content: JSON.stringify(REPLY[title]) } }], usage: { prompt_tokens: 300, completion_tokens: 200 } }), { status: 200 });
  };
  const registry = new ProviderRegistry();
  registry.registerProvider(new OpenRouterProvider({ defaultModel: defaultWorkforceConfig.modelDefaults.openrouter, apiKey: "test-not-real", fetchImpl: fakeFetch, costPerThousandTokensUsd: 0.01 }));
  const workforce = new AutonomousWorkforce({ missionQueue: deps.missionQueue, providerRegistry: registry, workforceConfig: defaultWorkforceConfig, ledger, orchestrator });
  const runner = new MissionRunner({ workforce, missionQueue: deps.missionQueue, ledger, dispatcher: orchestrator, store: deps.store, executionEnabled: true });
  const repository = new InMemoryBusinessRepository();

  const entered = await submitManualBusiness({ businessName: "Joe's Cafe", category: "catering.cafe", address: "Accra, Ghana", latitude: "5.6037", longitude: "-0.1870", website: "https://joescafe.example" }, { repository, dispatch: (t, p) => orchestrator.dispatch(t, p) });
  assert.ok(entered.ok);
  const id = entered.outcome.businessId;
  assert.ok(deps.store.started.has(id), "manual entry went through the same pipeline");
  const business = deps.store.businesses.get(id)!;

  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner, search: async () => [{ title: "Joe's Cafe Accra", url: "https://example.com/joes", snippet: "coffee shop" }], retryCooldownMs: 0 });
  engine.ensure(business); engine.kick(id); await engine.idle();
  assert.equal(engine.get(id)!.status, "awaiting_sources", "research waits for the operator before any AI stage");
  assert.equal(deps.missionQueue.getSnapshot().filter((m) => m.missionType === "dossier_profile").length, 0);
  for (const src of engine.get(id)!.sources.filter((u) => u.decision === "pending")) await engine.applyAction(id, { action: "decide", sourceId: src.id, decision: "approved" });
  await engine.applyAction(id, { action: "approve" }); await engine.idle();

  const d = engine.get(id)!;
  assert.equal(d.status, "completed");
  assert.deepEqual(stages, ["Business profile", "Brand and digital presence audit", "SWOT analysis", "Growth opportunities", "Action plan and follow-ups"]);
  for (const s of STAGES.filter((x) => x.id !== "research")) {
    const t = deps.missionQueue.getSnapshot().find((m) => m.taskId === d.stages[s.id].taskId)!;
    assert.equal(t.status, "Completed", s.id);
    assert.equal(t.executionHistory.at(-1)?.outcome, "SUCCEEDED");
    assert.equal(t.executionHistory.at(-1)?.provider, "openrouter");
    assert.equal(t.executionHistory.at(-1)?.assignedAI, s.assignedAI);
    assert.equal(deps.store.missionOutputs.get(t.taskId)?.isEvidence, false, "model text is a work product, never evidence");
    assert.ok(d.stages[s.id].output && typeof d.stages[s.id].output === "object");
  }
  assert.ok(ledger.list().some((t) => t.category === "AI_COST"), "AI cost was recorded");
  // the opportunity score was NOT forced by the dossier
  assert.ok(deps.store.scores.has(id));
  // follow-up: created, linked, and the Workforce refuses to run it without a human approval
  const fu = deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_followup")!;
  assert.equal(fu.clientId, id);
  assert.equal(fu.approvalRequired, "Approval Required");
  const attempt = await runner.run(fu.taskId, {});
  assert.equal(attempt.executed, false);
  assert.notEqual(deps.missionQueue.getSnapshot().find((t) => t.taskId === fu.taskId)!.status, "Completed");
  const autonomous = await runner.run(fu.taskId, {}, { autonomous: true });
  assert.equal(autonomous.outcome, "BLOCKED", "autonomous runs never execute a follow-up");
  assert.equal(stages.length, 5, "no AI call was made for the follow-up");
});
