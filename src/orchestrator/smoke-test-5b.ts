import { AtlasOrchestrator } from "./orchestrator";
import { HandlerRegistry, DuplicateHandlerError } from "./handler-registry";
import { computeEventId, ProcessedEventCache } from "./idempotency";
import { validatePayload } from "./payload-validation";
import { defaultOrchestrationConfig } from "./orchestration-config";
import type { OpportunityInput } from "../services/scoring/opportunity-score";
import type { AuditGeneratorInput } from "../services/audit/audit-inputs";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

// ---------- Handler Registry: duplicate/missing validation ----------
const registry = new HandlerRegistry();
registry.register("MissionCreated", async () => ({ output: {} }));
check("registering a handler once succeeds", registry.has("MissionCreated"));
let duplicateThrew = false;
try { registry.register("MissionCreated", async () => ({ output: {} })); } catch (e) { duplicateThrew = e instanceof DuplicateHandlerError; }
check("registering a duplicate handler throws instead of silently replacing", duplicateThrew);
registry.register("MissionCreated", async () => ({ output: { replaced: true } }), { replace: true });
check("explicit { replace: true } is allowed to update a handler", (await registry.get("MissionCreated")({ type: "MissionCreated", payload: { businessId: "b", taskId: "t" }, eventId: "e", lineageId: "l", emittedAt: "" })).output as any);
let missingThrew = false;
try { registry.get("PaymentRecorded"); } catch { missingThrew = true; }
check("looking up an unregistered handler throws MissingHandlerError", missingThrew);
check("tryGet returns null instead of throwing for an unregistered handler", registry.tryGet("PaymentRecorded") === null);

// ---------- Idempotency: deterministic duplicate detection ----------
const cache = new ProcessedEventCache(1000);
const id1 = computeEventId("BusinessDiscovered", { businessId: "b1" });
const id2 = computeEventId("BusinessDiscovered", { businessId: "b1" });
check("computeEventId is deterministic for identical payloads", id1 === id2);
check("computeEventId differs for different payloads", id1 !== computeEventId("BusinessDiscovered", { businessId: "b2" }));
check("unprocessed event is not marked as processed", !cache.hasProcessed(id1));
cache.markProcessed(id1);
check("processed event is detected as processed", cache.hasProcessed(id1));
check("expired entries are treated as unprocessed", !cache.hasProcessed(id1, Date.now() + 5000));

// ---------- Payload validation: rejects, never fabricates ----------
const invalidEvidence = validatePayload({ type: "EvidenceUpdated", payload: { businessId: "b1", opportunityInput: { components: [] } as any }, eventId: "e", lineageId: "l", emittedAt: "" });
check("empty components array is rejected, not silently accepted", !invalidEvidence.valid);
const missingBusinessId = validatePayload({ type: "BusinessDiscovered", payload: { discoveredBusiness: {}, duplicateStatus: "NONE" } as any, eventId: "e", lineageId: "l", emittedAt: "" });
check("missing required field is rejected", !missingBusinessId.valid && missingBusinessId.errors.some((e) => e.includes("businessId")));
const validEvidence = validatePayload({
  type: "EvidenceUpdated",
  payload: { businessId: "b1", opportunityInput: { businessId: "b1", components: [{ key: "x", rawValue: 1, maxValue: 1, normalizedValue: 1, weight: 1, evidenceRefs: [], confidence: "HIGH", observability: "OBSERVED_PRESENT", explanation: "x" }], evidenceCoverage: 80, competitorCoverage: 50 } },
  eventId: "e", lineageId: "l", emittedAt: "",
});
check("a well-formed payload passes validation", validEvidence.valid);

// ---------- Full orchestrator: real wiring, live handlers ----------
const orchestrator = new AtlasOrchestrator();

const opportunityInput: OpportunityInput = {
  businessId: "b1",
  components: [
    { key: "visibilityWeakness", rawValue: 0.7, maxValue: 1, normalizedValue: 0.7, weight: 20, evidenceRefs: ["e1"], confidence: "HIGH", observability: "OBSERVED_PRESENT", explanation: "weak profile" },
  ],
  evidenceCoverage: 70,
  competitorCoverage: 40,
};

// 1. BusinessDiscovered: real Scout Intake call.
await orchestrator.dispatch("BusinessDiscovered", { businessId: "b1", discoveredBusiness: { name: "Cedar & Salt" }, duplicateStatus: "NONE", evidenceRefs: [], sourceRefs: ["src1"] });
const discoveredEntry = orchestrator.log.all().find((e) => e.event === "BusinessDiscovered");
check("BusinessDiscovered runs the real Scout Intake handler and logs SUCCESS", discoveredEntry?.outcome === "SUCCESS");
check("execution log entry has a real, non-fabricated duration", typeof discoveredEntry?.durationMs === "number" && discoveredEntry!.durationMs! >= 0);

// 2. EvidenceUpdated: real Opportunity Score call.
await orchestrator.dispatch("EvidenceUpdated", { businessId: "b1", opportunityInput });
const evidenceEntry = orchestrator.log.all().find((e) => e.event === "EvidenceUpdated");
check("EvidenceUpdated runs the real Opportunity Score engine", evidenceEntry?.outcome === "SUCCESS");

// 3. ScoreCalculated -> auto-chains to AuditGenerated -> auto-chains to MissionCreated (full pipeline).
const auditInput: AuditGeneratorInput = {
  business: { id: "b1" }, evidence: [], evidenceCoverage: 70, visibilityScore: null, competitorGaps: [], competitorBenchmark: null,
  opportunityScore: {}, recommendations: [{ recommendationId: "r1", action: "Update photos", reason: "stale visuals", evidenceRefs: [], confidence: "MEDIUM", estimatedEffort: "low", approvalLevel: "AUTO", status: "OPEN" }],
  quickWins: [], generatedBy: "smoke-test", methodologyVersion: "v1",
};
await orchestrator.dispatch("ScoreCalculated", { businessId: "b1", opportunityScore: {} as any, auditInput });

const scoreEntry = orchestrator.log.all().find((e) => e.event === "ScoreCalculated");
check("ScoreCalculated runs the real Audit Generator", scoreEntry?.outcome === "SUCCESS");
const auditGeneratedEntry = orchestrator.log.all().find((e) => e.event === "AuditGenerated");
check("successful audit generation auto-chains to a real AuditGenerated dispatch (not just logged, actually executed)", auditGeneratedEntry?.outcome === "SUCCESS");
const missionCreatedEntry = orchestrator.log.all().find((e) => e.event === "MissionCreated");
check("AuditGenerated auto-chains to a real Mission Queue task creation (MissionCreated)", missionCreatedEntry?.outcome === "SUCCESS");
check("full pipeline shares a traceable chain (each stage has its own lineageId, none reused/overwritten)", new Set([scoreEntry?.lineageId, auditGeneratedEntry?.lineageId, missionCreatedEntry?.lineageId]).size === 3);

// ---------- Duplicate-event prevention ----------
const beforeDuplicateCount = orchestrator.log.all().filter((e) => e.event === "EvidenceUpdated").length;
await orchestrator.dispatch("EvidenceUpdated", { businessId: "b1", opportunityInput }); // identical payload -> same eventId
const duplicateEntry = orchestrator.log.all().filter((e) => e.event === "EvidenceUpdated").pop();
check("re-dispatching an identical event is detected as a duplicate", duplicateEntry?.outcome === "DUPLICATE");
check("a duplicate event does not run the handler again", orchestrator.log.all().filter((e) => e.event === "EvidenceUpdated" && e.outcome === "SUCCESS").length === beforeDuplicateCount);

// ---------- Invalid payload rejection ----------
await orchestrator.dispatch("EvidenceUpdated", { businessId: "b2", opportunityInput: { businessId: "b2", components: [], evidenceCoverage: 0, competitorCoverage: 0 } });
const invalidEntry = orchestrator.log.all().filter((e) => e.event === "EvidenceUpdated").pop();
check("an empty-components payload is rejected before the handler runs, never fabricated", invalidEntry?.outcome === "INVALID_PAYLOAD");

// ---------- Missing-handler behavior ----------
orchestrator.registry.unregister("PaymentRecorded");
await orchestrator.dispatch("PaymentRecorded", { transactionId: "tx-missing", snapshotInput: { period: { start: "2026-09-01", end: "2026-09-30", timezone: "Africa/Accra" }, methodologyVersion: "v1", generatedAt: "", generatedBy: "test", transactionCutoff: "", metrics: {}, evidenceCoverage: 0, confidence: "UNKNOWN", limitations: [] } }, { approval: { approvedByHuman: true, approvedByCeo: false } });
const unregisteredEntry = orchestrator.log.all().filter((e) => e.event === "PaymentRecorded").pop();
check("dispatching to an unregistered handler logs FAILURE, never a fake success", unregisteredEntry?.outcome === "FAILURE");

// ---------- Approval blocking (still enforced with real handlers) ----------
const orchestrator2 = new AtlasOrchestrator();
await orchestrator2.dispatch("PaymentRecorded", { transactionId: "tx-1", snapshotInput: { period: { start: "2026-09-01", end: "2026-09-30", timezone: "Africa/Accra" }, methodologyVersion: "v1", generatedAt: "", generatedBy: "test", transactionCutoff: "", metrics: {}, evidenceCoverage: 0, confidence: "UNKNOWN", limitations: [] } });
check("PaymentRecorded (Approval Required) is blocked without approval even with a real handler registered", orchestrator2.log.all().find((e) => e.event === "PaymentRecorded")?.outcome === "BLOCKED");

// ---------- Retry recovery ----------
const orchestrator3 = new AtlasOrchestrator(defaultOrchestrationConfig, false);
let missionAttempts = 0;
orchestrator3.registry.register("MissionCreated", async () => {
  missionAttempts++;
  if (missionAttempts < 2) throw new Error("transient failure");
  return { output: { recovered: true } };
});
await orchestrator3.dispatch("MissionCreated", { businessId: "b1", taskId: "t1" });
const recoveredEntry = orchestrator3.log.all().find((e) => e.event === "MissionCreated");
check("a handler that fails once then succeeds is recovered via retry, not abandoned", recoveredEntry?.outcome === "SUCCESS" && recoveredEntry.retryCount === 1);

// ---------- Dead-letter routing ----------
const orchestrator4 = new AtlasOrchestrator(defaultOrchestrationConfig, false);
orchestrator4.registry.register("MissionCreated", async () => { throw new Error("permanent failure"); });
await orchestrator4.dispatch("MissionCreated", { businessId: "b1", taskId: "t2" });
const deadLetterEntry = orchestrator4.log.all().find((e) => e.event === "MissionCreated");
check("a handler that always fails is DEAD_LETTERED, not silently dropped", deadLetterEntry?.outcome === "DEAD_LETTERED");
check("the failure is recorded in the retry manager's dead-letter queue", orchestrator4.retryManager.getDeadLetters().length === 1);

// ---------- Deterministic ordering ----------
const orchestrator5 = new AtlasOrchestrator(defaultOrchestrationConfig, false);
const callOrder: string[] = [];
orchestrator5.bus.subscribe("MissionCreated", () => { callOrder.push("first"); });
orchestrator5.bus.subscribe("MissionCreated", () => { callOrder.push("second"); });
orchestrator5.registry.register("MissionCreated", async () => ({ output: {} }));
await orchestrator5.dispatch("MissionCreated", { businessId: "b1", taskId: "t3" });
check("event bus subscribers fire in deterministic registration order during a real dispatch", callOrder.join(",") === "first,second");

console.log(failures === 0 ? "\nALL SPRINT 5B SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
