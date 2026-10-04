import { buildAtlas, stubCollectors } from "../../orchestrator/atlas-test-harness";
import { buildProvenanceEvidence } from "../../orchestrator/atlas-pipeline";
import { acquireEvidence } from "../evidence/acquisition";
import { LifecycleStore } from "./lifecycle-store";
import { ProspectService } from "./prospects";
import { DeliveryService } from "./delivery";
import { RevenueService } from "./revenue";
import { AutonomyScheduler, createInternalExecutor, runAutonomyCycle, type AutonomyCycle, type DecisionExecutor, type LoopDeps } from "./loop";
import { defaultAutonomyPolicy, type AutonomyPolicy } from "./policy";
import { makeClock, T0 } from "./autonomy-test-helpers";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}`); if (!cond) failures++; };
const P = (over: { top?: Partial<AutonomyPolicy>; loop?: Partial<AutonomyPolicy["loop"]> } = {}): AutonomyPolicy =>
  ({ ...defaultAutonomyPolicy, maxScoreForOutreach: 95, ...over.top, loop: { ...defaultAutonomyPolicy.loop, ...over.loop }, metricPriority: { ...defaultAutonomyPolicy.metricPriority } });
const MIN = 60_000;

async function loopWorld(opts: { execution?: boolean; sources?: string[]; policy?: AutonomyPolicy; execute?: DecisionExecutor; healthy?: () => boolean } = {}) {
  const a = await buildAtlas({ executionEnabled: opts.execution ?? false, collectors: stubCollectors(), sources: opts.sources });
  const clock = makeClock();
  const lifecycle = new LifecycleStore();
  const prospects = new ProspectService(lifecycle, clock.now);
  const delivery = new DeliveryService(lifecycle, prospects, a.deps.missionQueue, clock.now);
  const revenue = new RevenueService(lifecycle, prospects, a.ledger, clock.now);
  const real = createInternalExecutor({ pipeline: a.deps.store, collectors: stubCollectors(), missionQueue: a.deps.missionQueue, lifecycle, dispatcher: a.orchestrator, prospects, delivery, revenue, now: clock.now });
  const calls: string[] = [];
  const execute: DecisionExecutor = async (d) => { calls.push(d.type); return (opts.execute ?? real)(d); };
  const metricInputs = () => ({
    prospects: [...lifecycle.prospects.values()], engagements: [...lifecycle.engagements.values()], invoices: [...lifecycle.invoices.values()], tasks: a.deps.missionQueue.getSnapshot(), ledger: a.ledger.list(),
    approvals: [...lifecycle.approvals.values()], businesses: [...a.deps.store.businesses.values()].map((b) => ({ id: b.id, website: b.website, createdAt: b.createdAt })), observations: a.deps.store.observations,
    audits: [...a.deps.store.audits.values()].map((x) => ({ businessId: x.businessId, generatedAt: x.generatedAt })), scores: a.deps.store.scores,
  });
  const deps: LoopDeps = { policy: opts.policy ?? P(), lifecycle, pipeline: a.deps.store, missionQueue: a.deps.missionQueue, ledger: a.ledger, execute, metricInputs, now: clock.now, persistenceHealthy: opts.healthy };
  return { a, clock, lifecycle, prospects, deps, calls, cycle: (t = "test") => runAutonomyCycle(deps, t) };
}
const executed = (c: AutonomyCycle) => c.steps.filter((s) => s.action === "EXECUTED").map((s) => s.type);

// ---- S1: qualified business, real pipeline state, idempotency, approval boundary ----
{
  const w = await loopWorld();
  const res = await w.a.submit("Loop Cafe");
  const id = res.ok ? res.outcome.businessId : "";
  const missionsBefore = w.a.deps.missionQueue.getSnapshot().length;
  const c1 = await w.cycle();
  const outreach = w.a.deps.missionQueue.getSnapshot().find((t) => t.missionType === "outreach_draft");
  check("cycle 1 executes the controller's one permitted decision: CREATE_OUTREACH_MISSION for the qualified business", executed(c1).join() === "CREATE_OUTREACH_MISSION" && c1.status === "COMPLETED" && c1.stopReason === "NO_LEGITIMATE_ACTION" && w.lifecycle.prospects.get(`prospect:${id}`)?.state === "PROSPECT");
  check("the outreach mission is queued as Approval Required, tagged, and NOT executed (no AI call, nothing spent)", outreach?.approvalRequired === "Approval Required" && outreach.status === "Pending" && outreach.clientId === id && w.a.ai.calls === 0 && w.a.ledger.list().length === 0 && w.a.deps.missionQueue.getSnapshot().length === missionsBefore + 1);
  const persisted = w.lifecycle.cycles.get(c1.cycleId)!;
  const step = persisted.steps.find((s) => s.action === "EXECUTED")!;
  check("the cycle is persisted with state snapshot, policy hash, decisions, step, mission refs and side effects", persisted.status === "COMPLETED" && !!persisted.completedAt && persisted.stateSnapshot!.hash.length === 64 && persisted.stateSnapshot!.businesses === 1 && persisted.stateSnapshot!.decisionIds.length > 0 && persisted.policyHash.length === 64 && step.missionIds.length === 1 && step.sideEffects.includes(`prospect:${id}`) && step.sideEffects.some((e) => e.startsWith("mission:")) && step.decisionId.length === 64);
  check("the executed decision is recorded durably and its decision record exists", w.lifecycle.executions.get(step.decisionId)?.outcome === "EXECUTED" && w.lifecycle.decisions.has(step.decisionId));
  const calls1 = w.calls.length;
  const c2 = await w.cycle();
  w.clock.advance(2 * 24 * 3_600_000);
  const c3 = await w.cycle();
  check("re-running cycles never executes the same deterministic decision twice (no duplicate prospect, mission or step)", executed(c2).length === 0 && executed(c3).length === 0 && w.calls.length === calls1 && w.a.deps.missionQueue.getSnapshot().filter((t) => t.missionType === "outreach_draft").length === 1 && w.lifecycle.prospects.size === 1);
  check("the approval-required mission stays blocked: the runner refuses it and it remains Pending", await (async () => { const r = await w.a.runner.run(outreach!.taskId, {}); return !r.executed && w.a.deps.missionQueue.getSnapshot().find((t) => t.taskId === outreach!.taskId)!.status === "Pending"; })());
  check("each cycle gets its own ID and a durable record", new Set([c1.cycleId, c2.cycleId, c3.cycleId]).size === 3 && w.lifecycle.cycles.size === 3);
}

// ---- S2: partial state -> COLLECT_EVIDENCE then GENERATE_AUDIT; per-business mission limit ----
{
  const w = await loopWorld({ execution: false, sources: ["geoapify"] });
  await w.a.submit("Partial Cafe");
  const rec = w.a.repository.list()[0];
  w.a.deps.store.businesses.set(rec.id, rec); w.a.deps.store.evidence.set(rec.id, buildProvenanceEvidence(rec)); w.a.deps.store.started.add(rec.id);
  const c1 = await w.cycle();
  const store = w.a.deps.store;
  check("evidence is refreshed first (real collectors), the business is rescored, then the audit is generated through the existing handlers", executed(c1).join() === "COLLECT_EVIDENCE,GENERATE_AUDIT" && (store.observations.get(rec.id) ?? []).some((o) => o.field === "title") && typeof store.scores.get(rec.id)?.overallScore === "number" && store.audits.has(rec.id));
  check("per-business mission limit: a second mission-creating action for the same business waits for the next cycle", c1.status === "STOPPED_LIMIT" && c1.stopReason === "LIMIT_REACHED" && !w.a.deps.missionQueue.getSnapshot().some((t) => t.missionType === "outreach_draft") && (c1.nextEvaluation?.pendingInternal ?? 0) >= 1);
  const summary = w.a.deps.missionQueue.getSnapshot().find((t) => t.missionType === "internal_audit_summary");
  check("audit missions were created by the existing handlers; the safe summary mission is Auto but not executed while execution is disabled", !!summary && summary.approvalRequired === "Auto" && summary.status === "Pending" && w.a.ai.calls === 0 && c1.steps.find((s) => s.type === "GENERATE_AUDIT")!.missionIds.length >= 2);
  const c2 = await w.cycle();
  check("the next cycle performs the deferred action and then stops cleanly", executed(c2).join() === "CREATE_OUTREACH_MISSION" && c2.status === "COMPLETED");
}

// ---- S2b: ANALYZE_OPPORTUNITY runs through EvidenceUpdated ----
{
  const w = await loopWorld({ sources: ["geoapify"] });
  await w.a.submit("Analyze Cafe");
  const rec = w.a.repository.list()[0];
  const s = w.a.deps.store;
  s.businesses.set(rec.id, rec); s.evidence.set(rec.id, buildProvenanceEvidence(rec)); s.started.add(rec.id);
  s.observations.set(rec.id, (await acquireEvidence(rec, stubCollectors())).records);
  const c = await w.cycle();
  check("with evidence but no score the loop dispatches EvidenceUpdated: score, audit and missions follow from the existing chain", executed(c)[0] === "ANALYZE_OPPORTUNITY" && s.scores.has(rec.id) && s.audits.has(rec.id) && w.a.events().includes("EvidenceUpdated:SUCCESS") && w.a.events().includes("AuditGenerated:SUCCESS"));
}

// ---- S3: limits ----
{
  const w = await loopWorld({ policy: P({ loop: { maxMissionsPerCycle: 1 } }) });
  await w.a.submit("Limit Cafe One", { website: "https://one.example" }); await w.a.submit("Zanzibar Spice House", { address: "Kumasi, Ghana", latitude: "6.69", longitude: "-1.62", website: "https://two.example", category: "catering.restaurant" });
  const c1 = await w.cycle(); const c2 = await w.cycle();
  check("maxMissionsPerCycle is enforced: one business per cycle, the next cycle handles the other", executed(c1).length === 1 && c1.status === "STOPPED_LIMIT" && c1.missionsCreated === 1 && executed(c2).length === 1 && c2.status === "COMPLETED" && w.a.deps.missionQueue.getSnapshot().filter((t) => t.missionType === "outreach_draft").length === 2);
  const w2 = await loopWorld({ policy: P({ top: { estimatedCostUsd: { ...defaultAutonomyPolicy.estimatedCostUsd, CREATE_OUTREACH_MISSION: 0.5 } }, loop: { maxSpendPerCycleUsd: 0.1 } }) });
  await w2.a.submit("Spend Cafe");
  const s1 = await w2.cycle();
  check("the per-cycle spend limit blocks work whose estimated cost would exceed it", executed(s1).length === 0 && s1.status === "STOPPED_LIMIT" && s1.steps.some((x) => x.action === "SKIPPED" && /spend limit/.test(x.reason)) && w2.calls.length === 0);
  const w3 = await loopWorld({ policy: P({ top: { estimatedCostUsd: { ...defaultAutonomyPolicy.estimatedCostUsd, CREATE_OUTREACH_MISSION: 0.5 } }, loop: { maxSpendPerDayUsd: 0.2, maxSpendPerCycleUsd: 5 } }) });
  await w3.a.submit("Daily Cafe");
  check("the daily spend limit blocks the same work independently of the cycle limit", executed(await w3.cycle()).length === 0 && w3.calls.length === 0);
  const w4 = await loopWorld({ policy: P({ loop: { maxActionsPerCycle: 1 } }), sources: ["geoapify"] });
  await w4.a.submit("Actions Cafe");
  const r4 = w4.a.repository.list()[0]; w4.a.deps.store.businesses.set(r4.id, r4); w4.a.deps.store.evidence.set(r4.id, buildProvenanceEvidence(r4)); w4.a.deps.store.started.add(r4.id);
  const ac = await w4.cycle();
  check("maxActionsPerCycle is a hard stop for any kind of action", executed(ac).length === 1 && ac.status === "STOPPED_LIMIT");
}

// ---- S4: real AI spend is measured from the ledger and attributed to the step ----
{
  const w = await loopWorld({ execution: true, sources: ["geoapify"] });
  await w.a.submit("Spend Measured Cafe");
  const rec = w.a.repository.list()[0]; const s = w.a.deps.store;
  s.businesses.set(rec.id, rec); s.evidence.set(rec.id, buildProvenanceEvidence(rec)); s.started.add(rec.id);
  s.observations.set(rec.id, (await acquireEvidence(rec, stubCollectors())).records);
  s.scores.set(rec.id, (await import("../scoring/opportunity-score")).calculateOpportunityScore((await import("../../orchestrator/atlas-pipeline")).buildOpportunityInput(rec, s.evidence.get(rec.id)!, s.observations.get(rec.id)!)) as never);
  const c = await w.cycle();
  const audit = c.steps.find((x) => x.type === "GENERATE_AUDIT");
  const events = w.a.events();
  check("when an audit triggers the safe auto-mission, its real AI cost is attributed to the step, the cycle and the ledger", !!audit && w.a.ai.calls === 1 && audit.finance.aiCostTransactionIds.length === 1 && audit.finance.spendUsd > 0 && Math.abs(c.spendUsd - w.a.ledger.list().reduce((n, t) => n + Number(t.amount.minorUnits) / 100, 0)) < 1e-9 && events.includes("MissionCompleted:SUCCESS") && !events.some((e) => e.startsWith("PaymentRecorded")));
  check("approval-required missions created by the same audit were not executed", w.a.deps.missionQueue.getSnapshot().filter((t) => t.approvalRequired === "Approval Required").every((t) => t.status === "Pending"));
}

// ---- S5: circuit breaker ----
{
  let healthy = true;
  const failing: DecisionExecutor = async () => { throw new Error("boom"); };
  const w = await loopWorld({ execute: failing, healthy: () => healthy });
  await w.a.submit("Breaker One", { website: "https://b1.example" }); await w.a.submit("Zanzibar Spice House", { address: "Kumasi", latitude: "6.69", longitude: "-1.62", website: "https://b2.example", category: "catering.restaurant" }); await w.a.submit("Harbour Fish Market", { address: "Tema", latitude: "5.67", longitude: "0.01", website: "https://b3.example", category: "retail.fish" });
  const c1 = await w.cycle();
  check("three consecutive autonomous failures trip the breaker mid-cycle", c1.status === "STOPPED_CIRCUIT_OPEN" && c1.steps.filter((s) => s.action === "FAILED").length === 3 && w.lifecycle.breaker.state === "OPEN" && w.lifecycle.breaker.consecutiveFailures === 3 && w.calls.length === 3);
  w.clock.advance(MIN);
  const c2 = await w.cycle();
  check("while open, a cycle stops immediately and executes nothing", c2.status === "STOPPED_CIRCUIT_OPEN" && c2.steps.length === 0 && w.calls.length === 3);
  w.clock.advance(31 * MIN); healthy = false;
  const c3 = await w.cycle();
  check("after the open period the breaker resets only if the health/eligibility evaluation succeeds; otherwise it stays open", c3.status === "STOPPED_CIRCUIT_OPEN" && w.lifecycle.breaker.state === "OPEN" && w.calls.length === 3);
  w.clock.advance(31 * MIN); healthy = true;
  const okExecute: DecisionExecutor = async () => ({ sideEffects: ["noop"] });
  (w.deps as { execute: DecisionExecutor }).execute = async (d) => { w.calls.push(d.type); return okExecute(d); };
  const c4 = await w.cycle();
  check("a healthy evaluation closes the breaker; failed decisions are retried after their cooldown and the failure counter resets", w.lifecycle.breaker.state === "CLOSED" && w.lifecycle.breaker.consecutiveFailures === 0 && executed(c4).length === 3 && c4.status === "COMPLETED");
  check("each failed decision recorded its attempt count and error", [...w.lifecycle.executions.values()].every((e) => e.outcome === "EXECUTED" && e.attempts === 2));
}
{
  const failing: DecisionExecutor = async () => { throw new Error("always fails"); };
  const w = await loopWorld({ execute: failing, policy: P({ top: { maxRetries: 2 }, loop: { circuitBreaker: { tripAfterConsecutiveFailures: 100, openForMs: MIN } } }) });
  await w.a.submit("Retry Cafe");
  await w.cycle(); w.clock.advance(MIN);
  const cooling = await w.cycle();
  w.clock.advance(31 * MIN); await w.cycle(); w.clock.advance(31 * MIN);
  const exhausted = await w.cycle();
  check("a failed decision waits out its cooldown, is retried up to maxRetries, then is reported as exhausted (no retry storm)", w.calls.length === 2 && cooling.steps.some((s) => /cooling down/.test(s.reason)) && exhausted.steps.some((s) => /retries exhausted/.test(s.reason)) && [...w.lifecycle.executions.values()][0].attempts === 2);
}

// ---- S6: external actions are never performed by the loop ----
{
  const spy: string[] = [];
  const w = await loopWorld({ execute: async (d) => { spy.push(d.type); return { sideEffects: [] }; } });
  const res = await w.a.submit("External Cafe");
  const id = res.ok ? res.outcome.businessId : "";
  w.lifecycle.prospects.set(`prospect:${id}`, { prospectId: `prospect:${id}`, businessId: id, state: "RESPONSE_PENDING", history: [], followUps: 0, lastContactAt: "2026-09-01T00:00:00.000Z", createdAt: T0, updatedAt: T0 } as never);
  const c = await w.cycle();
  check("FOLLOW_UP (contact) is an external action: the loop records it as skipped and never performs it", spy.length === 0 && c.steps.some((s) => s.type === "FOLLOW_UP" && s.action === "SKIPPED" && /external/.test(s.reason)));
}

// ---- S7: scheduler ----
{
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let started = 0;
  const cycle = (id: string): AutonomyCycle => ({ cycleId: id, trigger: "t", startedAt: T0, completedAt: T0, status: "COMPLETED", stopReason: "x", policyHash: "h", stateSnapshot: null, steps: [], missionsCreated: 0, spendUsd: 0, failure: null, nextEvaluation: null });
  const sched = new AutonomyScheduler(async () => { started++; await gate; return cycle(`c${started}`); });
  const first = sched.wake("a");
  const second = await sched.wake("b");
  check("a wake-up during a running cycle is refused: cycles never overlap", sched.isCycleRunning() && second.started === false && second.reason === "cycle_in_progress" && started === 1);
  release();
  const done = await first;
  const third = await sched.wake("c");
  check("after the cycle ends a new one can start", done.started === true && !sched.isCycleRunning() && third.started === true && started === 2);
  check("the scheduler is start/stop controllable, rejects dangerous intervals and never double-starts", (() => { const s = new AutonomyScheduler(async () => cycle("x")); let threw = false; try { s.start(10); } catch { threw = true; } s.start(60_000); s.start(60_000); const on = s.isStarted(); s.stop(); return threw && on && !s.isStarted(); })());
  const erroring = new AutonomyScheduler(async () => { throw new Error("cycle blew up"); }, () => undefined);
  const r = await erroring.wake("x");
  check("a crashing cycle is contained: the scheduler survives and can run again", r.reason === "cycle_error" && !erroring.isCycleRunning() && (await erroring.wake("y")).started === true);
}

console.log(failures === 0 ? "\nALL AUTONOMY LOOP TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
