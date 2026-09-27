import { AtlasOrchestrator } from "./orchestrator";
import { canTransition, allowedTransitions } from "../services/scout/workflow";
import { computeTaskPriority, comparePriority } from "./task-priority";
import { computeBackoff } from "./retry-manager";
import { checkApproval } from "./approval-gateway";
import { EventBus } from "./event-bus";
import { computeEventId } from "./idempotency";
import { defaultOrchestrationConfig } from "./orchestration-config";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

// ---------- Event Bus: deterministic ordering ----------
const bus = new EventBus();
const order: number[] = [];
bus.subscribe("MissionCreated", () => { order.push(1); });
bus.subscribe("MissionCreated", () => { order.push(2); });
const missionPayload = { businessId: "b1", taskId: "t1" };
await bus.emit({ type: "MissionCreated", payload: missionPayload, eventId: computeEventId("MissionCreated", missionPayload), lineageId: "l1", emittedAt: new Date().toISOString() });
check("event bus runs subscribers in subscription order (deterministic)", order.join(",") === "1,2");

const unsub = bus.subscribe("PaymentRecorded", () => { throw new Error("should not fire after unsubscribe"); });
unsub();
let unsubOk = true;
const payPayload = { transactionId: "t1", snapshotInput: {} as any };
await bus.emit({ type: "PaymentRecorded", payload: payPayload, eventId: computeEventId("PaymentRecorded", payPayload), lineageId: "l2", emittedAt: new Date().toISOString() }).catch(() => { unsubOk = false; });
check("unsubscribe actually removes the handler", unsubOk);

// ---------- Workflow transitions (reused from scout/workflow.ts, not redefined) ----------
check("DISCOVERED -> QUALIFIED is valid", canTransition("DISCOVERED", "QUALIFIED"));
check("DISCOVERED -> SCORED is invalid (cannot skip states)", !canTransition("DISCOVERED", "SCORED"));
check("BLOCKED reachable from every non-terminal state", Object.entries(allowedTransitions).every(([state, next]) => state === "MISSION_CREATED" || state === "BLOCKED" || next.includes("BLOCKED")));

// ---------- Retry: exponential backoff, deterministic ----------
const b1 = computeBackoff(1, { maxRetries: 3, baseDelayMs: 500, backoffFactor: 2 });
const b2 = computeBackoff(2, { maxRetries: 3, baseDelayMs: 500, backoffFactor: 2 });
const b3 = computeBackoff(3, { maxRetries: 3, baseDelayMs: 500, backoffFactor: 2 });
check("backoff doubles each attempt (500, 1000, 2000)", b1.delayMs === 500 && b2.delayMs === 1000 && b3.delayMs === 2000);
check("backoff marks exhausted at maxRetries", b3.exhausted === true && b1.exhausted === false);

// ---------- Approval gateway: never bypasses approval ----------
check("Auto action is always allowed", checkApproval({ level: "Auto", approvedByHuman: false, approvedByCeo: false }).allowed);
check("Approval Required action is blocked without human approval", !checkApproval({ level: "Approval Required", approvedByHuman: false, approvedByCeo: false }).allowed);
check("Approval Required action is allowed once approved", checkApproval({ level: "Approval Required", approvedByHuman: true, approvedByCeo: false }).allowed);
check("CEO Only action is blocked by ordinary human approval alone", !checkApproval({ level: "CEO Only", approvedByHuman: true, approvedByCeo: false }).allowed);
check("CEO Only action is allowed only with CEO approval", checkApproval({ level: "CEO Only", approvedByHuman: true, approvedByCeo: true }).allowed);

// ---------- Task priority: deterministic, no randomness ----------
const p1 = computeTaskPriority({ opportunityScore: 80, commercialValue: 5000, missionUrgency: "High", dueDate: "2026-09-19", now: "2026-09-18T00:00:00Z" });
const p2 = computeTaskPriority({ opportunityScore: 80, commercialValue: 5000, missionUrgency: "High", dueDate: "2026-09-19", now: "2026-09-18T00:00:00Z" });
check("task priority is deterministic (same input -> same score)", p1 === p2);
const pLow = computeTaskPriority({ opportunityScore: 10, commercialValue: 50, missionUrgency: "Low", dueDate: null, now: "2026-09-18T00:00:00Z" });
check("higher opportunity/urgency/value scores higher priority", p1 > pLow);
const sorted = [{ priority: 50, dueDate: "2026-09-20", id: "b" }, { priority: 80, dueDate: "2026-09-25", id: "a" }].sort(comparePriority);
check("comparePriority sorts by priority first, ignoring due date when priority differs", sorted[0].id === "a");

// ---------- Full orchestrator dispatch: approval blocking + execution logging ----------
// wireRealHandlers=false: this file tests orchestrator mechanics with stub
// handlers, independent of the real Sprint 5B wiring (covered in smoke-test-5b.ts).
const orchestrator = new AtlasOrchestrator(defaultOrchestrationConfig, false);
let auditHandlerCalled = false;
orchestrator.registry.register("ScoreCalculated", async () => {
  auditHandlerCalled = true;
  return { output: { auditId: "audit-1" }, confidence: 0.9 };
});
await orchestrator.dispatch("ScoreCalculated", { businessId: "b1", opportunityScore: {} as any, auditInput: { recommendations: [], quickWins: [] } as any });
check("Auto-tier event with a registered handler actually runs it", auditHandlerCalled);
check("execution log records the successful dispatch", orchestrator.log.all().some((e) => e.event === "ScoreCalculated" && e.outcome === "SUCCESS"));

let financeHandlerCalled = false;
orchestrator.registry.register("PaymentRecorded", async () => {
  financeHandlerCalled = true;
  return { output: {}, confidence: 1 };
});
await orchestrator.dispatch("PaymentRecorded", { transactionId: "tx-1", snapshotInput: {} as any }); // Approval Required, no approval supplied
check("Approval Required event is blocked when no approval is supplied", !financeHandlerCalled);
check("execution log records the block, not a fake success", orchestrator.log.all().some((e) => e.event === "PaymentRecorded" && e.outcome === "BLOCKED"));

await orchestrator.dispatch("PaymentRecorded", { transactionId: "tx-2", snapshotInput: {} as any }, { approval: { approvedByHuman: true, approvedByCeo: false } });
check("same event succeeds once approval is explicitly supplied", financeHandlerCalled);

await orchestrator.dispatch("MissionCreated", { businessId: "b1", taskId: "t9" });
const missingHandlerEntry = orchestrator.log.all().find((e) => e.event === "MissionCreated");
check("dispatching an event with no registered handler logs FAILURE, never a fake success", missingHandlerEntry?.outcome === "FAILURE");

// ---------- Provider abstraction: escalation on low confidence ----------
const attempts: string[] = [];
orchestrator.registry.register("EvidenceUpdated", async () => {
  attempts.push("call");
  return { output: {}, confidence: 0.1 }; // always below threshold -> should escalate through all tiers
});
await orchestrator.dispatch("EvidenceUpdated", { businessId: "b1", opportunityInput: { businessId: "b1", components: [{ key: "x", rawValue: 1, maxValue: 1, normalizedValue: 1, weight: 1, evidenceRefs: [], confidence: "HIGH", observability: "OBSERVED_PRESENT", explanation: "x" }], evidenceCoverage: 50, competitorCoverage: 50 } });
check("low-confidence result triggers multiple attempts across tiers (escalation, not first-try acceptance)", attempts.length > 1);
const evidenceEntry = orchestrator.log.all().find((e) => e.event === "EvidenceUpdated");
check("exhausted escalation logs FAILURE honestly, not a fabricated SUCCESS", evidenceEntry?.outcome === "FAILURE");

console.log(failures === 0 ? "\nALL ORCHESTRATOR SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
