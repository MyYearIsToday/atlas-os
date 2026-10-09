import { toDecimal } from "../finance/money";
import type { Money } from "../finance/finance-types";
import type { MissionQueueRepository } from "../mission-queue";
import type { OperationalLedger } from "../finance/ledger";
import type { PipelineStore } from "../../orchestrator/atlas-pipeline";
import type { AutonomyPolicy } from "./policy";
import type { LifecycleStore } from "./lifecycle-store";
import type { RevenueService } from "./revenue";
import { missionVersion, type ApprovalService } from "./approvals";
import { aiCostUsd, type AutonomyCycle, type AutonomyScheduler } from "./loop";
import { computeMetrics, type MetricInputs } from "./metrics";

/**
 * Read-only observability (Objective 10). Pure functions over durable state: GET only, no mutation, no debug or
 * destructive operations, no environment variables, keys or credentials, and no contact addresses or message bodies.
 * Lists use stable keyset pagination (newest first, ties broken by ID) and a hard page-size cap.
 */
export interface AutonomyRuntime {
  policy: AutonomyPolicy; lifecycle: LifecycleStore; pipeline: PipelineStore; missionQueue: MissionQueueRepository; ledger: OperationalLedger;
  revenue: RevenueService; approvals: ApprovalService; scheduler: AutonomyScheduler;
  autonomyEnabled: boolean; executionEnabled: boolean; persistenceHealth: () => unknown; metricInputs: () => MetricInputs; now: () => string;
}
export interface ApiResult { status: number; body: unknown }
export const PAGE_DEFAULT = 20, PAGE_MAX = 100;

const err = (status: number, code: string, message: string): ApiResult => ({ status, body: { error: { code, message } } });
const moneyView = (m: Money) => ({ amount: toDecimal(m), currency: m.currency });

function parsePaging(q: URLSearchParams): { limit: number; cursor: string | null } | ApiResult {
  const raw = q.get("limit");
  let limit = PAGE_DEFAULT;
  if (raw !== null) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return err(400, "invalid_limit", `limit must be an integer between 1 and ${PAGE_MAX}`);
    limit = Math.min(Number(raw), PAGE_MAX);
  }
  const c = q.get("cursor");
  if (c !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(c)) return err(400, "invalid_cursor", "cursor is not valid");
  return { limit, cursor: c };
}
const encodeCursor = (key: string) => Buffer.from(key, "utf8").toString("base64url");
const decodeCursor = (c: string) => Buffer.from(c, "base64url").toString("utf8");

/** Keyset pagination, newest first. The key is `${time}|${id}`, unique and stable, so pages never skip or repeat items. */
export function paginate<T>(items: T[], keyOf: (t: T) => string, paging: { limit: number; cursor: string | null }): { items: T[]; nextCursor: string | null } {
  const sorted = [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? 1 : keyOf(a) > keyOf(b) ? -1 : 0));
  const after = paging.cursor ? decodeCursor(paging.cursor) : null;
  const rest = after === null ? sorted : sorted.filter((t) => keyOf(t) < after);
  const page = rest.slice(0, paging.limit);
  return { items: page, nextCursor: rest.length > page.length ? encodeCursor(keyOf(page[page.length - 1])) : null };
}

const cycleSummary = (c: AutonomyCycle) => ({
  cycleId: c.cycleId, trigger: c.trigger, startedAt: c.startedAt, completedAt: c.completedAt, status: c.status, stopReason: c.stopReason,
  steps: c.steps.length, executed: c.steps.filter((s) => s.action === "EXECUTED").length, failed: c.steps.filter((s) => s.action === "FAILED").length,
  missionsCreated: c.missionsCreated, spendUsd: c.spendUsd, failure: c.failure,
});

export function readAutonomy(method: string, pathname: string, query: URLSearchParams, rt: AutonomyRuntime): ApiResult {
  if (method !== "GET") return err(405, "method_not_allowed", "autonomy observability endpoints are read-only (GET)");
  const route = pathname.replace(/\/+$/, "");
  const paging = parsePaging(query);
  if ("status" in paging) return paging;

  if (route === "/api/atlas/autonomy/status") {
    const cycles = [...rt.lifecycle.cycles.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const m24 = computeMetrics(rt.metricInputs(), rt.now(), rt.policy).last_24h;
    return { status: 200, body: {
      autonomy: { enabled: rt.autonomyEnabled, schedulerStarted: rt.scheduler.isStarted(), cycleRunning: rt.scheduler.isCycleRunning(), missionExecutionEnabled: rt.executionEnabled },
      circuitBreaker: rt.lifecycle.breaker, limits: rt.policy.loop, lastCycle: cycles[0] ? cycleSummary(cycles[0]) : null,
      spentTodayUsd: aiCostUsd(rt.ledger, rt.now().slice(0, 10)).usd,
      counts: { businesses: rt.pipeline.businesses.size, decisions: rt.lifecycle.decisions.size, cycles: rt.lifecycle.cycles.size, prospects: rt.lifecycle.prospects.size, engagements: rt.lifecycle.engagements.size, invoices: rt.lifecycle.invoices.size, approvals: rt.lifecycle.approvals.size },
      persistence: rt.persistenceHealth(), metrics24h: m24.map((m) => ({ id: m.id, value: m.value, denominator: m.denominator })),
    } };
  }

  if (route === "/api/atlas/autonomy/cycles") {
    const id = query.get("cycleId");
    if (id) { const c = rt.lifecycle.cycles.get(id); return c ? { status: 200, body: { cycle: c } } : err(404, "not_found", `unknown cycle ${id}`); }
    const page = paginate([...rt.lifecycle.cycles.values()], (c) => `${c.startedAt}|${c.cycleId}`, paging);
    return { status: 200, body: { items: page.items.map(cycleSummary), nextCursor: page.nextCursor } };
  }

  if (route === "/api/atlas/autonomy/decisions") {
    const business = query.get("businessId"), type = query.get("type");
    const list = [...rt.lifecycle.decisions.values()].filter((d) => (!business || d.businessId === business) && (!type || d.type === type));
    const page = paginate(list, (d) => `${d.createdAt}|${d.decisionId}`, paging);
    return { status: 200, body: { items: page.items.map((d) => ({ ...d, execution: rt.lifecycle.executions.get(d.decisionId) ? { outcome: rt.lifecycle.executions.get(d.decisionId)!.outcome, cycleId: rt.lifecycle.executions.get(d.decisionId)!.cycleId, attempts: rt.lifecycle.executions.get(d.decisionId)!.attempts } : null })), nextCursor: page.nextCursor } };
  }

  if (route === "/api/atlas/autonomy/missions") {
    const status = query.get("status"), business = query.get("businessId");
    const list = rt.missionQueue.getSnapshot().filter((t) => (!status || t.status === status) && (!business || t.clientId === business));
    const page = paginate(list, (t) => `${t.createdAt}|${t.taskId}`, paging);
    return { status: 200, body: { items: page.items.map((t) => ({ taskId: t.taskId, title: t.title, businessId: t.clientId, missionType: t.missionType ?? null, status: t.status, approvalRequired: t.approvalRequired, retryCount: t.retryCount, createdAt: t.createdAt, completedAt: t.completedAt, lastFailureReason: t.lastFailureReason, attempts: t.executionHistory.length, version: missionVersion(t) })), nextCursor: page.nextCursor } };
  }

  if (route === "/api/atlas/autonomy/finance") {
    const s = rt.revenue.summary();
    const page = paginate([...rt.lifecycle.invoices.values()], (i) => `${i.createdAt}|${i.invoiceId}`, paging);
    return { status: 200, body: {
      note: "Only recorded payments are revenue. Invoice states before PAYMENT_RECORDED are operational states and are reported under notRevenue.",
      receivedRevenue: { totals: s.receivedRevenue, paymentCount: s.paymentCount },
      notRevenue: s.notRevenue,
      aiCost: { todayUsd: aiCostUsd(rt.ledger, rt.now().slice(0, 10)).usd, allTimeUsd: aiCostUsd(rt.ledger).usd },
      invoices: { items: page.items.map((i) => ({ invoiceId: i.invoiceId, businessId: i.businessId, engagementId: i.engagementId, state: i.state, amount: moneyView(i.amount), payments: i.payments.map((p) => ({ paymentId: p.paymentId, amount: moneyView(p.amount), receivedAt: p.receivedAt, recordedBy: p.recordedBy, transactionId: p.transactionId, reconciliation: p.reconciliation?.status ?? null })), updatedAt: i.updatedAt })), nextCursor: page.nextCursor },
    } };
  }

  const biz = /^\/api\/atlas\/autonomy\/business\/([^/]+)$/.exec(route);
  if (biz) return businessTrace(decodeURIComponent(biz[1]), rt);
  return err(404, "not_found", "unknown autonomy endpoint");
}

/** Reconstructs one business's lifecycle: evidence -> score -> audit -> decisions -> cycle steps -> missions -> prospect -> delivery -> invoice. */
function businessTrace(id: string, rt: AutonomyRuntime): ApiResult {
  const b = rt.pipeline.businesses.get(id);
  if (!b) return err(404, "not_found", `unknown business ${id}`);
  const obs = rt.pipeline.observations.get(id) ?? [];
  const score = rt.pipeline.scores.get(id), audit = rt.pipeline.audits.get(id);
  const missions = rt.missionQueue.getSnapshot().filter((t) => t.clientId === id);
  const prospect = rt.lifecycle.prospects.get(`prospect:${id}`) ?? null;
  const engagement = [...rt.lifecycle.engagements.values()].find((e) => e.businessId === id) ?? null;
  const invoice = engagement ? rt.lifecycle.invoices.get(`invoice:${engagement.engagementId}`) ?? null : null;
  const decisions = [...rt.lifecycle.decisions.values()].filter((d) => d.businessId === id).sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1));
  const steps = [...rt.lifecycle.cycles.values()].flatMap((c) => c.steps.filter((s) => s.businessId === id).map((s) => ({ ...s, cycleId: c.cycleId })));

  type Ev = { at: string; kind: string; ref: string; summary: string };
  const timeline: Ev[] = [
    ...decisions.map((d) => ({ at: d.createdAt, kind: "decision", ref: d.decisionId, summary: `${d.type} (${d.ruleId}): ${d.reason}` })),
    ...steps.map((s) => ({ at: s.at, kind: "cycle_step", ref: s.stepId, summary: `${s.action} ${s.type}${s.missionIds.length ? ` -> missions ${s.missionIds.join(",")}` : ""}${s.finance.spendUsd ? ` ($${s.finance.spendUsd.toFixed(4)} AI cost)` : ""}${s.error ? ` ERROR: ${s.error}` : ""}` })),
    ...missions.map((t) => ({ at: t.createdAt, kind: "mission", ref: t.taskId, summary: `${t.missionType ?? "mission"} [${t.status}, ${t.approvalRequired}]` })),
    ...(prospect?.history ?? []).map((h) => ({ at: h.at, kind: "prospect", ref: h.idempotencyKey, summary: `${h.from ?? "-"} -> ${h.to} by ${h.actor}: ${h.reason}` })),
    ...(engagement?.history ?? []).map((h) => ({ at: h.at, kind: "engagement", ref: engagement!.engagementId, summary: `${h.from ?? "-"} -> ${h.to} by ${h.actor}: ${h.reason}` })),
    ...(invoice?.history ?? []).map((h) => ({ at: h.at, kind: "invoice", ref: invoice!.invoiceId, summary: `${h.from ?? "-"} -> ${h.to} by ${h.actor}: ${h.reason}` })),
    ...(invoice?.payments ?? []).map((p) => ({ at: p.recordedAt, kind: "payment", ref: p.paymentId, summary: `recorded ${toDecimal(p.amount)} ${p.amount.currency} (ref ${p.reference}) by ${p.recordedBy}` })),
  ].sort((a, c) => (a.at < c.at ? -1 : a.at > c.at ? 1 : a.kind < c.kind ? -1 : a.ref < c.ref ? -1 : 1)).slice(-200);

  return { status: 200, body: {
    business: { id: b.id, name: b.canonicalName, category: b.category ?? null, address: b.address ?? null, website: b.website ?? null, sources: b.sourceReferences },
    evidence: obs.map((o) => ({ evidenceId: o.evidenceId, field: o.field, sourceType: o.sourceType, sourceUrl: o.sourceUrl, observedAt: o.observedAt, confidence: o.confidence, verificationStatus: o.verificationStatus })),
    score: score ? { overall: score.overallScore, confidence: score.confidence.overall, blockers: score.blockers.map((x) => x.title) } : null,
    audit: audit ? { auditId: audit.auditId, generatedAt: audit.generatedAt, recommendations: audit.recommendations.length } : null,
    missions: missions.map((t) => ({ taskId: t.taskId, missionType: t.missionType ?? null, status: t.status, approvalRequired: t.approvalRequired, retryCount: t.retryCount })),
    prospect: prospect ? { prospectId: prospect.prospectId, state: prospect.state, followUps: prospect.followUps, lastContactAt: prospect.lastContactAt, outreach: prospect.outreach ? { subject: prospect.outreach.draft.subject, draftHash: prospect.outreach.draft.draftHash, approved: !!prospect.outreach.approval, contactChannel: prospect.outreach.contact ? { channel: prospect.outreach.contact.channel, source: prospect.outreach.contact.source } : null, sendAttempts: prospect.outreach.sends.map((s) => ({ at: s.at, status: s.status })) } : null, proposal: prospect.proposal ? { proposalId: prospect.proposal.proposalId, priceUsd: prospect.proposal.priceUsd, scopeItems: prospect.proposal.scope.length, approvedBy: prospect.proposal.approvedBy ?? null, acceptedBy: prospect.proposal.acceptedBy ?? null } : null } : null,
    engagement: engagement ? { engagementId: engagement.engagementId, state: engagement.state, plan: engagement.plan, artifacts: engagement.artifacts.map((a) => ({ artifactId: a.artifactId, scopeItemId: a.scopeItemId, title: a.title, state: a.state, producedBy: a.producedBy })) } : null,
    invoice: invoice ? { invoiceId: invoice.invoiceId, state: invoice.state, amount: moneyView(invoice.amount), payments: invoice.payments.length } : null,
    decisions: decisions.slice(0, 50).map((d) => ({ decisionId: d.decisionId, type: d.type, ruleId: d.ruleId, reason: d.reason, approvalRequirement: d.approvalRequirement, createdAt: d.createdAt, execution: rt.lifecycle.executions.get(d.decisionId)?.outcome ?? null })),
    timeline,
  } };
}
