import type { Task } from "../mission-queue";
import type { FinancialTransaction } from "../finance/finance-types";
import { toDecimal } from "../finance/money";
import type { EvidenceRecord } from "../evidence/evidence";
import type { ProspectRecord } from "./prospects";
import type { Engagement } from "./delivery";
import { sumMoney, type Invoice } from "./revenue";
import type { ApprovalRecord } from "./approvals";
import type { Decision } from "./controller";
import { decisionPriority } from "./controller";
import type { AutonomyPolicy } from "./policy";

/**
 * Operational metrics (Objective 9). Every metric is a PURE function of durable records (never a counter that can
 * drift) with an explicit numerator, denominator, window and zero-denominator rule (value is null, never 0 or NaN).
 * Metrics inform reporting and, through `applyMetricPriority` only, the ORDER in which already-permitted decisions
 * are considered. Nothing in this module writes anything: it cannot change policy, budgets, permissions, approval
 * rules, circuit-breaker rules or safety gates, and it creates no financial authority.
 */
export type WindowId = "current_cycle" | "last_24h" | "last_7d" | "last_30d" | "all_time";
export interface MetricWindow { id: WindowId; start: string | null; end: string }
export interface MetricInputs {
  prospects: ProspectRecord[]; engagements: Engagement[]; invoices: Invoice[]; tasks: Task[]; ledger: FinancialTransaction[]; approvals: ApprovalRecord[];
  businesses: Array<{ id: string; website?: string; createdAt: string }>; observations: Map<string, EvidenceRecord[]>;
  audits: Array<{ businessId: string; generatedAt: string }>; scores: Map<string, { overallScore: number | null }>;
}
export interface Metric {
  id: string; name: string; window: WindowId;
  numerator: number | Record<string, string>; denominator: number | null; value: number | Record<string, string> | null;
  definition: { numerator: string; denominator: string; timestamp: string; zeroDenominator: string };
}

const H = 3_600_000, D = 24 * H;
export function metricWindows(nowIso: string, currentCycleStart?: string): MetricWindow[] {
  const now = Date.parse(nowIso);
  const w = (id: WindowId, ms: number | null): MetricWindow => ({ id, start: ms === null ? null : new Date(now - ms).toISOString(), end: nowIso });
  return [
    ...(currentCycleStart ? [{ id: "current_cycle" as const, start: currentCycleStart, end: nowIso }] : []),
    w("last_24h", D), w("last_7d", 7 * D), w("last_30d", 30 * D), w("all_time", null),
  ];
}
const inWin = (ts: string | null | undefined, w: MetricWindow) => !!ts && (w.start === null || Date.parse(ts) >= Date.parse(w.start)) && Date.parse(ts) <= Date.parse(w.end);

const ZERO = "value is null (not 0) when the denominator is 0";
const ratio = (id: string, name: string, w: MetricWindow, num: number, den: number, d: { numerator: string; denominator: string; timestamp: string }): Metric =>
  ({ id, name, window: w.id, numerator: num, denominator: den, value: den === 0 ? null : num / den, definition: { ...d, zeroDenominator: ZERO } });

const WEBSITE_FIELDS = new Set(["title", "meta_description", "primary_heading", "page_text"]);
const everReached = (p: ProspectRecord, state: string) => p.history.some((h) => h.to === state);
const reachedAt = (p: ProspectRecord, state: string) => p.history.find((h) => h.to === state)?.at;

export function computeMetrics(i: MetricInputs, nowIso: string, policy: AutonomyPolicy, currentCycleStart?: string): Record<WindowId, Metric[]> {
  const out = {} as Record<WindowId, Metric[]>;
  for (const w of metricWindows(nowIso, currentCycleStart)) {
    const m: Metric[] = [];
    // 1. qualification rate
    const evaluated = i.audits.filter((a) => inWin(a.generatedAt, w) && i.scores.get(a.businessId)?.overallScore != null);
    m.push(ratio("qualification_rate", "Qualification rate", w, evaluated.filter((a) => (i.scores.get(a.businessId)!.overallScore as number) <= policy.maxScoreForOutreach).length, evaluated.length,
      { numerator: `evaluated businesses with a numeric score <= policy.maxScoreForOutreach (${policy.maxScoreForOutreach})`, denominator: "businesses audited in the window with a numeric opportunity score", timestamp: "audit.generatedAt" }));
    // 2. evidence completion
    const withSite = i.businesses.filter((b) => !!b.website && inWin(b.createdAt, w));
    m.push(ratio("evidence_completion", "Evidence completion", w, withSite.filter((b) => (i.observations.get(b.id) ?? []).some((o) => WEBSITE_FIELDS.has(o.field))).length, withSite.length,
      { numerator: "businesses with at least one collected website evidence field", denominator: "businesses that list a website, created in the window", timestamp: "business.createdAt" }));
    // 3. mission success
    const attempted = i.tasks.filter((t) => t.executionHistory.length && inWin(t.executionHistory.at(-1)!.startedAt, w));
    m.push(ratio("mission_success_rate", "Mission success rate", w, attempted.filter((t) => t.status === "Completed").length, attempted.length,
      { numerator: "attempted missions currently Completed", denominator: "missions whose latest execution attempt started in the window", timestamp: "latest executionHistory.startedAt" }));
    // 4. outreach response
    const delivered = i.prospects.filter((p) => p.outreach?.sends.some((s) => s.status === "SENT" && inWin(s.at, w)));
    m.push(ratio("outreach_response_rate", "Outreach response rate", w, delivered.filter((p) => everReached(p, "ENGAGED")).length, delivered.length,
      { numerator: "delivered outreach whose prospect reached ENGAGED (a positive reply)", denominator: "prospects with a SENT outreach attempt in the window", timestamp: "send attempt time (status SENT)" }));
    // 5. proposal conversion
    const issued = i.prospects.filter((p) => inWin(reachedAt(p, "PROPOSAL_APPROVAL"), w));
    m.push(ratio("proposal_conversion", "Proposal conversion", w, issued.filter((p) => p.state === "WON").length, issued.length,
      { numerator: "issued proposals whose prospect is WON", denominator: "prospects whose proposal was approved for presentation in the window", timestamp: "history entry into PROPOSAL_APPROVAL" }));
    // 6. delivery completion
    const won = i.engagements.filter((e) => inWin(e.createdAt, w));
    m.push(ratio("delivery_completion", "Delivery completion", w, won.filter((e) => e.state === "COMPLETE").length, won.length,
      { numerator: "won engagements currently COMPLETE", denominator: "engagements created (customer won) in the window", timestamp: "engagement.createdAt" }));
    // 7. customer acceptance
    const deliveredArtifacts = i.engagements.flatMap((e) => e.artifacts).filter((a) => a.history.some((h) => h.to === "customer_delivered" && inWin(h.at, w)));
    m.push(ratio("customer_acceptance_rate", "Customer acceptance rate", w, deliveredArtifacts.filter((a) => a.state === "accepted").length, deliveredArtifacts.length,
      { numerator: "artifacts delivered in the window that are currently accepted", denominator: "artifacts with a customer_delivered event in the window", timestamp: "artifact history entry into customer_delivered" }));
    // 8. revenue (recorded payments only)
    const payments = i.invoices.flatMap((inv) => inv.payments).filter((p) => inWin(p.receivedAt, w));
    const revenue = sumMoney(payments.map((p) => p.amount));
    m.push({ id: "revenue", name: "Revenue (recorded payments only)", window: w.id, numerator: revenue, denominator: null, value: revenue, definition: { numerator: "sum of human-recorded payments, per currency (no conversion)", denominator: "not applicable", timestamp: "payment.receivedAt", zeroDenominator: "an empty window yields {} (no currencies), never an invented 0" } });
    // 9. delivery time
    const done = i.engagements.filter((e) => e.completedAt && inWin(e.completedAt, w));
    const totalMs = done.reduce((n, e) => n + (Date.parse(e.completedAt!) - Date.parse(e.history[0]?.at ?? e.createdAt)), 0);
    m.push({ id: "delivery_time_ms", name: "Mean delivery time (ms)", window: w.id, numerator: totalMs, denominator: done.length, value: done.length ? totalMs / done.length : null, definition: { numerator: "sum of (completedAt - customer-won timestamp)", denominator: "engagements completed in the window", timestamp: "engagement.completedAt", zeroDenominator: ZERO } });
    // 10. AI cost
    const costs = i.ledger.filter((t) => t.category === "AI_COST" && t.direction === "OUTFLOW" && inWin(t.recordedAt, w));
    const cost = sumMoney(costs.map((t) => t.amount));
    m.push({ id: "ai_cost", name: "AI cost (recorded ledger entries)", window: w.id, numerator: cost, denominator: null, value: cost, definition: { numerator: "sum of AI_COST outflow ledger entries, per currency", denominator: "not applicable", timestamp: "ledger recordedAt", zeroDenominator: "an empty window yields {}" } });
    // 11. failure rate
    const attempts = i.tasks.flatMap((t) => t.executionHistory).filter((r) => (r.outcome === "SUCCEEDED" || r.outcome === "FAILED") && inWin(r.startedAt, w));
    m.push(ratio("failure_rate", "Execution failure rate", w, attempts.filter((r) => r.outcome === "FAILED").length, attempts.length,
      { numerator: "execution attempts with outcome FAILED", denominator: "execution attempts with outcome SUCCEEDED or FAILED (BLOCKED excluded)", timestamp: "executionHistory.startedAt" }));
    // 12. human approval rate
    const resolved = i.approvals.filter((a) => inWin(a.at, w));
    m.push(ratio("human_approval_rate", "Human approval rate", w, resolved.filter((a) => a.outcome === "APPROVED").length, resolved.length,
      { numerator: "resolved human-required actions recorded as APPROVED", denominator: "resolved human-required actions (APPROVED + REJECTED); requests still waiting are not counted", timestamp: "approval.at" }));
    out[w.id] = m;
  }
  return out;
}

/** Human-readable money total helper for reports. */
export const formatTotals = (t: Record<string, string>) => Object.entries(t).map(([c, v]) => `${v} ${c}`).join(", ") || "none";
export { toDecimal };

/**
 * Bounded, explicit metric influence on ordering. Returns the same decisions (same IDs, approvals, budgets, reasons),
 * only reordered, and a decision can move up by at most policy.metricPriority.maxBoost tiers. A rule is ignored until
 * its metric has policy.metricPriority.minSample observations. Gating (approvals, budget, limits, circuit breaker)
 * happens elsewhere and is never touched here.
 */
export function applyMetricPriority(decisions: Decision[], last30d: Metric[], policy: AutonomyPolicy): Decision[] {
  const get = (id: string) => last30d.find((m) => m.id === id);
  const enough = (m?: Metric) => !!m && (m.denominator ?? 0) >= policy.metricPriority.minSample && typeof m.value === "number";
  const evidence = get("evidence_completion"), conversion = get("proposal_conversion");
  const boostFor = (d: Decision): number => {
    let boost = 0;
    if (d.type === "COLLECT_EVIDENCE" && enough(evidence) && (evidence!.value as number) < policy.metricPriority.lowEvidenceCompletion) boost = 1;
    if (d.type === "CREATE_OUTREACH_MISSION" && enough(conversion) && (conversion!.value as number) >= policy.metricPriority.goodProposalConversion) boost = 1;
    return Math.min(boost, Math.max(0, policy.metricPriority.maxBoost));
  };
  return decisions.map((d, index) => ({ d, index, tier: decisionPriority(d.type) - boostFor(d) })).sort((a, b) => a.tier - b.tier || a.index - b.index).map((x) => x.d);
}
