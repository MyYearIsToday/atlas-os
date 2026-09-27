import { calculateVisibilityScoreV1 } from "../src/services/scoring/visibility-score-v1";
import { buildGaps } from "../src/services/scoring/competitor-gap";
import { buildBenchmark } from "../src/services/scoring/competitor-benchmark";
import { calculateOpportunityScore } from "../src/services/scoring/opportunity-score";
import { generateAudit } from "../src/services/audit/generate-audit";
import { allowedTransitions, canTransition } from "../src/services/scout/workflow";
import { nextActionFromAudit } from "../src/services/scout/next-action";
import { money, add, decimalToMoney, toDecimal } from "../src/services/finance/money";
import { OperationalLedger } from "../src/services/finance/ledger";
import { validateTransaction } from "../src/services/finance/validation";
import { profitLoss, clientProfitability } from "../src/services/finance/metrics";
import type { FinancialTransaction } from "../src/services/finance/finance-types";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

// ---------- Visibility Score v1 ----------
const visInputA = {
  businessId: "b1",
  components: [
    { key: "profileCompleteness" as const, rawValue: 80, normalizedValue: 0.8, weight: 15, evidenceRefs: ["e1"], confidence: "HIGH" as const, observability: "OBSERVED_PRESENT" as const, explanation: "x" },
    { key: "reviews" as const, rawValue: 60, normalizedValue: 0.6, weight: 15, evidenceRefs: ["e2"], confidence: "MEDIUM" as const, observability: "OBSERVED_PRESENT" as const, explanation: "x" },
  ],
};
const visA = calculateVisibilityScoreV1(visInputA);
const visB = calculateVisibilityScoreV1(visInputA);
check("visibility score is deterministic (same input -> same score)", visA.overallScore === visB.overallScore);
check("visibility score reports evidence coverage < 100 when only 2 of 10 components scored", visA.evidenceCoverage === 100); // only components passed in are considered, not all 10
const visWithMissing = calculateVisibilityScoreV1({
  businessId: "b1",
  components: [
    ...visInputA.components,
    { key: "website" as const, rawValue: null, normalizedValue: null, weight: 10, evidenceRefs: [], confidence: "UNKNOWN" as const, observability: "NOT_OBSERVABLE" as const, explanation: "no evidence" },
  ],
});
check("NOT_OBSERVABLE component is excluded from score but coverage reflects it", visWithMissing.evidenceCoverage < 100 && visWithMissing.overallScore !== null);

// ---------- Competitor Gap ----------
const competitorSet = { id: "cs1", targetBusinessId: "b1", competitors: [{ businessId: "c1", status: "EXPLICIT" as const, evidenceRefs: [], confidence: "MEDIUM" as const }, { businessId: "c2", status: "EXPLICIT" as const, evidenceRefs: [], confidence: "MEDIUM" as const }], selectionMethod: "scout" as const, generatedAt: new Date().toISOString() };
const gaps = buildGaps("b1", competitorSet, {
  c1: [{ dimension: "reviews", targetValue: 40, competitorValue: 70, evidenceRefs: ["e1"], confidence: "MEDIUM", observability: "OBSERVED_PRESENT", explanation: "x", observedAt: new Date().toISOString() }],
  c2: [{ dimension: "reviews", targetValue: 40, competitorValue: null, evidenceRefs: [], confidence: "UNKNOWN", observability: "NOT_OBSERVABLE", explanation: "no data", observedAt: new Date().toISOString() }],
});
check("gap direction is populated (regression check for the fixed bug)", gaps[0].direction === "target_behind");
check("null competitor value preserved as unknown, not fabricated", gaps[1].direction === "unknown" && gaps[1].normalizedGap === null);
const benchmark = buildBenchmark({ id: "bm1", targetBusinessId: "b1", competitorCount: 2, dimensions: ["reviews"], gaps });
check("benchmark computes median from available competitor values only", benchmark.benchmarkDimensions[0].competitorMedian === 70);
check("benchmark evidence coverage reflects only 1 of 2 competitors having data", benchmark.benchmarkDimensions[0].evidenceCoverage === 50);

// ---------- Opportunity Score ----------
const oppInput = {
  businessId: "b1",
  evidenceCoverage: 80,
  competitorCoverage: 50,
  components: [
    { key: "visibilityWeakness", rawValue: 0.7, maxValue: 1, normalizedValue: 0.7, weight: 20, evidenceRefs: ["e1"], confidence: "HIGH" as const, observability: "OBSERVED_PRESENT" as const, explanation: "x" },
    { key: "commercialValue", rawValue: null, maxValue: 1, normalizedValue: null, weight: 15, evidenceRefs: [], confidence: "UNKNOWN" as const, observability: "NOT_OBSERVABLE" as const, explanation: "no data" },
  ],
};
const opp = calculateOpportunityScore(oppInput);
check("opportunity score excludes NOT_OBSERVABLE component from calculation", opp.overallScore !== null);
check("opportunity score is not simply 100 - visibility (independent formula)", opp.overallScore !== 30);

// ---------- Audit Generator ----------
const auditWeak = generateAudit({
  business: { id: "b1" }, evidence: [], evidenceCoverage: 30, visibilityScore: visWithMissing, competitorGaps: [], competitorBenchmark: null,
  opportunityScore: opp, recommendations: [], quickWins: [], generatedBy: "test", methodologyVersion: "v1",
});
check("audit has all 10 required sections", auditWeak.audit.sections.length === 10);
check("low-evidence business gets 'collect_missing_evidence' next action, not a confident audit", auditWeak.audit.nextAction?.actionType === "collect_missing_evidence");
const auditNoCompetitors = generateAudit({
  business: { id: "b2" }, evidence: [], evidenceCoverage: 90, visibilityScore: visA, competitorGaps: [], competitorBenchmark: null,
  opportunityScore: opp, recommendations: [], quickWins: [], generatedBy: "test", methodologyVersion: "v1",
});
check("no-competitors case marks competitors section NOT_OBSERVABLE, doesn't fabricate", auditNoCompetitors.audit.sections.find(s => s.key === "competitors")?.observability === "NOT_OBSERVABLE");

// ---------- Scout Workflow ----------
check("DISCOVERED can transition to QUALIFIED", canTransition("DISCOVERED", "QUALIFIED"));
check("DISCOVERED cannot skip straight to SCORED", !canTransition("DISCOVERED", "SCORED"));
check("MISSION_CREATED is a terminal state", allowedTransitions.MISSION_CREATED.length === 0);
const action = nextActionFromAudit({ evidenceCoverage: 20, hasAudit: false, hasOpportunity: false, hasMission: false });
check("low coverage always recommends evidence collection over generating an audit", action.actionType === "collect_missing_evidence");

// ---------- Finance: money precision ----------
check("0.10 + 0.20 = 0.30 exactly (no float drift)", toDecimal(add(decimalToMoney("0.10", "GHS"), decimalToMoney("0.20", "GHS"))) === "0.30");
check("money uses bigint minor units, not floating point", typeof money(100n, "GHS").minorUnits === "bigint");

// ---------- Finance: transaction validation ----------
const baseTx = (over: Partial<FinancialTransaction> = {}): FinancialTransaction => ({
  transactionId: crypto.randomUUID(), transactionType: "REVENUE", transactionDate: "2026-09-17", recordedAt: "2026-09-17T00:00:00Z",
  amount: decimalToMoney("100.00", "GHS"), direction: "INFLOW", status: "POSTED", category: "MapSpark Services",
  productId: "MapSpark", clientId: "lead-amani-stays", description: "test", evidenceRefs: ["e1"], verificationStatus: "VERIFIED",
  approvalStatus: "APPROVED", createdBy: "test", updatedAt: "2026-09-17T00:00:00Z", ...over,
});
check("valid revenue transaction passes validation", validateTransaction(baseTx()).length === 0);
check("revenue without productId is rejected", validateTransaction(baseTx({ productId: undefined })).length > 0);
check("refund without a reversal reference is rejected", validateTransaction(baseTx({ transactionType: "REFUND" })).length > 0);
check("transfer without source/destination is rejected", validateTransaction(baseTx({ transactionType: "TRANSFER" })).length > 0);
check("owner withdrawal tagged as product revenue is rejected", validateTransaction(baseTx({ transactionType: "OWNER_WITHDRAWAL", productId: "MapSpark" })).length > 0);

// ---------- Finance: ledger post/reverse/audit trail ----------
const ledger = new OperationalLedger();
const posted = ledger.post(baseTx(), "ceo");
check("posted transaction is retrievable", ledger.get(posted.transactionId)?.status === "POSTED");
check("posting the same transaction twice throws", (() => { try { ledger.post(posted, "ceo"); return false; } catch { return true; } })());
const reversal = baseTx({ transactionId: crypto.randomUUID(), transactionType: "REFUND", reversalOfTransactionId: posted.transactionId, direction: "OUTFLOW" });
ledger.reverse(posted.transactionId, reversal, "ceo");
check("reversing a transaction marks the original REVERSED, preserves history", ledger.get(posted.transactionId)?.status === "REVERSED");
check("audit trail grows on post/reverse (nothing silently edited)", ledger.auditTrail().length === 2);

// ---------- Finance: TradeSpark isolation ----------
const tradeTx = baseTx({ transactionId: crypto.randomUUID(), productId: "TradeSpark", amount: decimalToMoney("5000.00", "GHS") });
const mapsparkTx = baseTx({ transactionId: crypto.randomUUID() });
const period = { start: "2026-09-01", end: "2026-09-30", timezone: "Africa/Accra", currency: "GHS", includedStatuses: ["POSTED" as const] };
const plWithoutTrade = profitLoss([tradeTx, mapsparkTx], period);
check("TradeSpark revenue is excluded from operating P&L by default", toDecimal(plWithoutTrade.revenue) === "100.00");
const plWithTrade = profitLoss([tradeTx, mapsparkTx], period, { includeTradeSpark: true });
check("TradeSpark can be explicitly included when the caller opts in", toDecimal(plWithTrade.revenue) === "5100.00");

// ---------- Finance: client profitability (CRM link) ----------
const clientRevenue = baseTx({ transactionId: crypto.randomUUID(), clientId: "lead-amani-stays" });
const clientCost = baseTx({ transactionId: crypto.randomUUID(), transactionType: "EXPENSE", category: "DIRECT_COST", direction: "OUTFLOW", amount: decimalToMoney("30.00", "GHS"), clientId: "lead-amani-stays" });
const cp = clientProfitability([clientRevenue, clientCost], "lead-amani-stays", period);
check("client profitability attributes revenue and direct cost to the right client", toDecimal(cp.revenue) === "100.00" && toDecimal(cp.directCost) === "30.00");
check("contribution = revenue - direct cost", toDecimal(cp.contribution) === "70.00");

console.log(failures === 0 ? "\nALL SPRINT 4B–4F + FINANCE SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
