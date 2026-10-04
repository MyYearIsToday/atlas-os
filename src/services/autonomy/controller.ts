import { createHash } from "node:crypto";
import type { Task } from "../mission-queue";
import type { OpportunityScore } from "../scoring/opportunity-types";
import type { PipelineStore } from "../../orchestrator/atlas-pipeline";
import { defaultAutonomyPolicy, type AutonomyPolicy } from "./policy";
import type { LifecycleStore } from "./lifecycle-store";
import type { ProspectRecord } from "./prospects";
import type { Engagement } from "./delivery";
import { assessInvoiceEligibility, type InvoiceState } from "./revenue";

/**
 * Autonomous Operations Controller (Objective 4): "what should Atlas work on next?"
 *
 * A pure, deterministic function from durable state + typed policy to a list of traceable decisions. It is
 * an ordered rule table, not a planner: the same state always yields the same decisions with the same IDs.
 * It only DECIDES. Executing a decision (creating missions, sending anything) belongs to the loop and to
 * the approval gates; every decision states the approval it needs. REQUEST_PAYMENT and RECONCILE_REVENUE
 * are part of the vocabulary but belong to the revenue objective and are never produced here.
 */
export type DecisionType =
  | "DISCOVER_MORE" | "COLLECT_EVIDENCE" | "ANALYZE_OPPORTUNITY" | "GENERATE_AUDIT" | "CREATE_OUTREACH_MISSION" | "FOLLOW_UP"
  | "PREPARE_DELIVERY" | "DELIVER" | "VERIFY_RESULT" | "REQUEST_PAYMENT" | "RECONCILE_REVENUE" | "WAIT_FOR_HUMAN" | "WAIT_FOR_EXTERNAL_EVENT" | "NO_ACTION";
export type ApprovalRequirement = "NONE" | "HUMAN" | "CEO";

export interface ProposedMission { title: string; missionType: string; approvalRequired: "Auto" | "Approval Required" | "CEO Only" }
export interface Decision {
  decisionId: string; type: DecisionType; businessId: string | null; clientId: string | null; reason: string; ruleId: string;
  stateRefs: string[]; proposedMission: ProposedMission | null; approvalRequirement: ApprovalRequirement;
  budgetImpactUsd: number; createdAt: string; expiresAt: string | null;
}

export interface MissionState { taskId: string; missionType?: string; status: Task["status"]; approvalRequired: Task["approvalRequired"]; retryCount: number; lastFailureAt: string | null }
export interface BusinessState {
  businessId: string; name: string; hasWebsite: boolean; pipelineStarted: boolean;
  observationCount: number; newestObservationAt: string | null; score: { scorable: boolean; overall: number | null } | null; auditId: string | null;
  missions: MissionState[]; prospect: ProspectRecord | null; engagement: Engagement | null;
  /** Present only for businesses with an engagement. Absent = revenue is not tracked for this business (Objective 4 behavior). */
  revenue?: { invoiceState: InvoiceState | null; eligible: boolean; reason: string | null };
}
export interface AutonomyState { now: string; businesses: BusinessState[]; spentTodayUsd: number }

/** Reads durable state into the controller's input. Pure reads; nothing is mutated. */
export function buildAutonomyState(input: { now: string; pipeline: PipelineStore; missions: Task[]; lifecycle: LifecycleStore; spentTodayUsd: number }): AutonomyState {
  const { pipeline, missions, lifecycle } = input;
  const businesses: BusinessState[] = [...pipeline.businesses.values()].map((b): BusinessState => {
    const obs = pipeline.observations.get(b.id) ?? [];
    const score: OpportunityScore | undefined = pipeline.scores.get(b.id);
    const newest = obs.map((o) => o.observedAt).sort().pop() ?? null;
    const base: BusinessState = {
      businessId: b.id, name: b.canonicalName, hasWebsite: !!b.website, pipelineStarted: pipeline.started.has(b.id), observationCount: obs.length, newestObservationAt: newest,
      score: score ? { scorable: score.overallScore !== null, overall: score.overallScore } : null, auditId: pipeline.audits.get(b.id)?.auditId ?? null,
      missions: missions.filter((t) => t.clientId === b.id).map((t) => ({ taskId: t.taskId, missionType: t.missionType, status: t.status, approvalRequired: t.approvalRequired, retryCount: t.retryCount, lastFailureAt: t.status === "Failed" ? t.executionHistory.at(-1)?.completedAt ?? null : null })),
      prospect: lifecycle.prospects.get(`prospect:${b.id}`) ?? null,
      engagement: [...lifecycle.engagements.values()].find((e) => e.businessId === b.id) ?? null,
    };
    return withRevenue(base, lifecycle);
  });
  return { now: input.now, businesses, spentTodayUsd: input.spentTodayUsd };
}

function withRevenue(base: BusinessState, lifecycle: LifecycleStore): BusinessState {
  const e = base.engagement;
  if (!e) return base;
  const invoice = lifecycle.invoices.get(`invoice:${e.engagementId}`) ?? null;
  const a = assessInvoiceEligibility(e, lifecycle.prospects.get(e.prospectId) ?? null);
  return { ...base, revenue: { invoiceState: invoice?.state ?? null, eligible: a.eligible, reason: a.eligible ? null : a.reason } };
}

interface Ctx { policy: AutonomyPolicy; nowMs: number }
interface Hit { type: DecisionType; ruleId: string; reason: string; refs: string[]; mission?: ProposedMission; approval?: ApprovalRequirement }
type Rule = (b: BusinessState, c: Ctx) => Hit | null;

const OUTREACH_MISSION: ProposedMission = { title: "Prepare outreach draft", missionType: "outreach_draft", approvalRequired: "Approval Required" };
const open = (m: MissionState) => m.status !== "Completed" && m.status !== "Failed";
const ref = {
  biz: (b: BusinessState) => `business:${b.businessId}`,
  evidence: (b: BusinessState) => `evidence:${b.businessId}@${b.newestObservationAt ?? "none"}#${b.observationCount}`,
  prospect: (p: ProspectRecord) => `prospect:${p.businessId}@${p.state}`,
  engagement: (e: Engagement) => `engagement:${e.engagementId}@${e.state}`,
};

/** Ordered: the first matching rule decides. Each rule is small, named, and independently testable. */
export const RULES: Array<{ id: string; rule: Rule }> = [
  { id: "R01_TERMINAL", rule: (b) => {
    if (b.engagement?.state === "COMPLETE" && (!b.revenue || b.revenue.invoiceState === "PAYMENT_RECONCILED")) return { type: "NO_ACTION", ruleId: "R01_TERMINAL", reason: "engagement complete", refs: [ref.engagement(b.engagement)] };
    if (b.prospect && ["LOST", "DORMANT"].includes(b.prospect.state)) return { type: "NO_ACTION", ruleId: "R01_TERMINAL", reason: `prospect is ${b.prospect.state}; only a human can reopen it`, refs: [ref.prospect(b.prospect)] };
    return null;
  } },
  { id: "R02_FAILURE_GUARD", rule: (b, c) => {
    const failed = b.missions.filter((m) => m.status === "Failed");
    if (!failed.length) return null;
    const exhausted = failed.find((m) => m.retryCount >= c.policy.maxRetries);
    const refs = failed.map((m) => `mission:${m.taskId}@Failed`);
    if (exhausted) return { type: "WAIT_FOR_HUMAN", ruleId: "R02_FAILURE_GUARD", reason: `mission ${exhausted.taskId} exhausted its ${c.policy.maxRetries} retries; a human must decide`, refs, approval: "HUMAN" };
    const cooling = failed.find((m) => m.lastFailureAt && c.nowMs - Date.parse(m.lastFailureAt) < c.policy.failureCooldownMs);
    return cooling ? { type: "NO_ACTION", ruleId: "R02_FAILURE_GUARD", reason: "recent mission failure; cooling down", refs } : null;
  } },
  { id: "R03R_REVENUE", rule: (b) => {
    const e = b.engagement, r = b.revenue;
    if (!e || e.state !== "COMPLETE" || !r) return null;
    const refs = [ref.engagement(e), `invoice:${e.engagementId}@${r.invoiceState ?? "none"}`];
    switch (r.invoiceState) {
      case null: return r.eligible
        ? { type: "REQUEST_PAYMENT", ruleId: "R03R_REVENUE", reason: "engagement complete and the accepted proposal has a price: an invoice record is eligible (internal; a human prepares and sends it)", refs, approval: "NONE" }
        : { type: "WAIT_FOR_HUMAN", ruleId: "R03R_REVENUE", reason: r.reason ?? "invoice is not eligible", refs, approval: "HUMAN" };
      case "INVOICE_ELIGIBLE": return { type: "WAIT_FOR_HUMAN", ruleId: "R03R_REVENUE", reason: "a human must prepare the invoice", refs, approval: "HUMAN" };
      case "PREPARED": return { type: "WAIT_FOR_HUMAN", ruleId: "R03R_REVENUE", reason: "a human must send the prepared invoice and record it", refs, approval: "HUMAN" };
      case "SENT": case "PAYMENT_PENDING": return { type: "WAIT_FOR_EXTERNAL_EVENT", ruleId: "R03R_REVENUE", reason: "waiting for the customer's payment; only a human-recorded payment counts as revenue", refs };
      case "PAYMENT_RECORDED": return { type: "RECONCILE_REVENUE", ruleId: "R03R_REVENUE", reason: "a payment is recorded and awaits human reconciliation against the external statement", refs, approval: "HUMAN" };
      default: return null;
    }
  } },
  { id: "R03_ENGAGEMENT", rule: (b) => {
    const e = b.engagement;
    if (!e) return null;
    const refs = [ref.engagement(e)];
    switch (e.state) {
      case "CUSTOMER_WON": case "ONBOARDING": return { type: "WAIT_FOR_HUMAN", ruleId: "R03_ENGAGEMENT", reason: "customer requirements must be recorded by a human", refs, approval: "HUMAN" };
      case "DELIVERY_PLAN": return { type: "PREPARE_DELIVERY", ruleId: "R03_ENGAGEMENT", reason: "plan is derived from the accepted scope; delivery missions can be created", refs, approval: "NONE" };
      case "MISSIONS": case "WORK_IN_PROGRESS": {
        const waiting = b.missions.filter((m) => m.missionType === "delivery_work" && m.status === "Pending");
        return waiting.length
          ? { type: "WAIT_FOR_HUMAN", ruleId: "R03_ENGAGEMENT", reason: `${waiting.length} delivery mission(s) need human approval to run`, refs: [...refs, ...waiting.map((m) => `mission:${m.taskId}@Pending`)], approval: "HUMAN" }
          : { type: "PREPARE_DELIVERY", ruleId: "R03_ENGAGEMENT", reason: "delivery missions are running or done; artifacts must be assembled for internal review", refs };
      }
      case "INTERNAL_REVIEW": return { type: "WAIT_FOR_HUMAN", ruleId: "R03_ENGAGEMENT", reason: "artifacts await human internal approval", refs, approval: "HUMAN" };
      case "CUSTOMER_DELIVERY": return { type: "DELIVER", ruleId: "R03_ENGAGEMENT", reason: "internally approved artifacts are ready to deliver to the customer", refs, approval: "HUMAN" };
      case "RESULT_VERIFICATION": return e.artifacts.length && e.artifacts.every((a) => a.state === "accepted")
        ? { type: "VERIFY_RESULT", ruleId: "R03_ENGAGEMENT", reason: "every artifact is accepted; verify and close", refs, approval: "HUMAN" }
        : { type: "WAIT_FOR_EXTERNAL_EVENT", ruleId: "R03_ENGAGEMENT", reason: "waiting for the customer's decision on delivered artifacts", refs };
      default: return null;
    }
  } },
  { id: "R04_PROSPECT", rule: (b, c) => {
    const p = b.prospect;
    if (!p) return null;
    const refs = [ref.prospect(p)];
    switch (p.state) {
      case "PROSPECT": return open2(b, "outreach_draft") ? dup("R04_PROSPECT", "outreach_draft", b) : { type: "CREATE_OUTREACH_MISSION", ruleId: "R04_PROSPECT", reason: "prospect has no outreach draft", refs, mission: OUTREACH_MISSION, approval: "HUMAN" };
      case "OUTREACH_PREPARED": case "APPROVAL_REQUIRED": return { type: "WAIT_FOR_HUMAN", ruleId: "R04_PROSPECT", reason: "outreach needs human approval before anything is sent", refs, approval: "HUMAN" };
      case "OUTREACH_SENT": return { type: "WAIT_FOR_EXTERNAL_EVENT", ruleId: "R04_PROSPECT", reason: "outreach sent; waiting for a reply", refs };
      case "RESPONSE_PENDING": {
        const waited = p.lastContactAt ? c.nowMs - Date.parse(p.lastContactAt) : 0;
        if (waited < c.policy.followUpAfterMs) return { type: "WAIT_FOR_EXTERNAL_EVENT", ruleId: "R04_PROSPECT", reason: "waiting for a reply within the follow-up window", refs };
        return p.followUps < c.policy.maxFollowUps
          ? { type: "FOLLOW_UP", ruleId: "R04_PROSPECT", reason: `no reply after ${Math.floor(waited / 3_600_000)}h; follow-up ${p.followUps + 1} of ${c.policy.maxFollowUps}`, refs, approval: "HUMAN" }
          : { type: "WAIT_FOR_HUMAN", ruleId: "R04_PROSPECT", reason: "follow-up limit reached; a human should mark the prospect dormant or lost", refs, approval: "HUMAN" };
      }
      case "ENGAGED": return { type: "WAIT_FOR_HUMAN", ruleId: "R04_PROSPECT", reason: "a proposal needs scope from the customer's requirements", refs, approval: "HUMAN" };
      case "PROPOSAL_PREPARED": case "PROPOSAL_APPROVAL": return { type: "WAIT_FOR_HUMAN", ruleId: "R04_PROSPECT", reason: "proposal awaits human approval or the customer's decision", refs, approval: "HUMAN" };
      case "WON": return { type: "PREPARE_DELIVERY", ruleId: "R04_PROSPECT", reason: "proposal accepted; start the engagement from the accepted scope", refs, approval: "NONE" };
      default: return null;
    }
  } },
  { id: "R05_EVIDENCE", rule: (b, c) => {
    const refs = [ref.biz(b), ref.evidence(b)];
    const stale = b.newestObservationAt !== null && c.nowMs - Date.parse(b.newestObservationAt) > c.policy.evidenceMaxAgeMs;
    if (b.hasWebsite && b.observationCount === 0) return { type: "COLLECT_EVIDENCE", ruleId: "R05_EVIDENCE", reason: "the business lists a website but no evidence has been collected", refs };
    if (stale) return { type: "COLLECT_EVIDENCE", ruleId: "R05_EVIDENCE", reason: "evidence is older than the freshness limit", refs };
    return null;
  } },
  { id: "R06_ANALYSIS", rule: (b) => {
    const refs = [ref.biz(b), ref.evidence(b)];
    if (!b.score) return { type: "ANALYZE_OPPORTUNITY", ruleId: "R06_ANALYSIS", reason: "no opportunity score exists for this business", refs };
    if (!b.auditId) return { type: "GENERATE_AUDIT", ruleId: "R06_ANALYSIS", reason: "scored but not audited", refs: [...refs, `score:${b.businessId}`] };
    return null;
  } },
  { id: "R07_OPPORTUNITY", rule: (b, c) => {
    const refs = [ref.biz(b), `score:${b.businessId}`, `audit:${b.businessId}`];
    if (!b.score?.scorable) return { type: "NO_ACTION", ruleId: "R07_OPPORTUNITY", reason: "score withheld and evidence is fresh; nothing further can be collected", refs };
    if (b.score.overall! > c.policy.maxScoreForOutreach) return { type: "NO_ACTION", ruleId: "R07_OPPORTUNITY", reason: `score ${b.score.overall} is above the outreach threshold ${c.policy.maxScoreForOutreach}`, refs };
    if (open2(b, "outreach_draft")) return dup("R07_OPPORTUNITY", "outreach_draft", b);
    if (b.missions.length >= c.policy.maxMissionsPerBusiness) return { type: "NO_ACTION", ruleId: "R07_OPPORTUNITY", reason: `business already has ${b.missions.length} missions (limit ${c.policy.maxMissionsPerBusiness})`, refs };
    return { type: "CREATE_OUTREACH_MISSION", ruleId: "R07_OPPORTUNITY", reason: `score ${b.score.overall} is at or below ${c.policy.maxScoreForOutreach}: a qualified opportunity`, refs, mission: OUTREACH_MISSION, approval: "HUMAN" };
  } },
];
const open2 = (b: BusinessState, type: string) => b.missions.some((m) => m.missionType === type && open(m));
const dup = (ruleId: string, type: string, b: BusinessState): Hit => ({ type: "NO_ACTION", ruleId, reason: `a ${type} mission is already open (duplicate work avoided)`, refs: b.missions.filter((m) => m.missionType === type && open(m)).map((m) => `mission:${m.taskId}@${m.status}`) });

const PRIORITY: Record<DecisionType, number> = {
  DELIVER: 1, VERIFY_RESULT: 2, PREPARE_DELIVERY: 3, FOLLOW_UP: 4, CREATE_OUTREACH_MISSION: 5, GENERATE_AUDIT: 6, ANALYZE_OPPORTUNITY: 7, COLLECT_EVIDENCE: 8,
  DISCOVER_MORE: 9, REQUEST_PAYMENT: 10, RECONCILE_REVENUE: 11, WAIT_FOR_HUMAN: 12, WAIT_FOR_EXTERNAL_EVENT: 13, NO_ACTION: 14,
};
const ACTIONABLE = new Set<DecisionType>(["REQUEST_PAYMENT", "RECONCILE_REVENUE", "COLLECT_EVIDENCE", "ANALYZE_OPPORTUNITY", "GENERATE_AUDIT", "CREATE_OUTREACH_MISSION", "FOLLOW_UP", "PREPARE_DELIVERY", "DELIVER", "VERIFY_RESULT", "DISCOVER_MORE"]);

export function evaluateAutonomy(state: AutonomyState, policy: AutonomyPolicy = defaultAutonomyPolicy): Decision[] {
  const ctx: Ctx = { policy, nowMs: Date.parse(state.now) };
  const make = (hit: Hit, business: BusinessState | null, cost: number): Decision => {
    const stateRefs = [...new Set(hit.refs)].sort();
    const actionable = ACTIONABLE.has(hit.type);
    return {
      decisionId: createHash("sha256").update(JSON.stringify([hit.ruleId, hit.type, business?.businessId ?? null, stateRefs])).digest("hex"),
      type: hit.type, businessId: business?.businessId ?? null, clientId: business?.engagement || business?.prospect ? business.businessId : null,
      reason: hit.reason, ruleId: hit.ruleId, stateRefs, proposedMission: hit.mission ?? null, approvalRequirement: hit.approval ?? "NONE",
      budgetImpactUsd: cost, createdAt: state.now, expiresAt: actionable ? new Date(ctx.nowMs + policy.decisionTtlMs).toISOString() : null,
    };
  };
  const decisions: Decision[] = [];
  const sorted = [...state.businesses].sort((a, b) => a.businessId.localeCompare(b.businessId));
  for (const b of sorted) {
    const hit = RULES.map((r) => r.rule(b, ctx)).find((h): h is Hit => h !== null)
      ?? { type: "NO_ACTION" as const, ruleId: "R99_DEFAULT", reason: "no rule applies", refs: [ref.biz(b)] };
    decisions.push(make(hit, b, policy.estimatedCostUsd[hit.type] ?? 0));
  }
  const active = sorted.filter((b) => !(b.engagement?.state === "COMPLETE" || (b.prospect && ["LOST", "DORMANT"].includes(b.prospect.state)))).length;
  if (active < policy.minActivePipeline) {
    decisions.push(make({ type: "DISCOVER_MORE", ruleId: "R08_PIPELINE", reason: `only ${active} active businesses (minimum ${policy.minActivePipeline})`, refs: [`pipeline:active=${active}`] }, null, 0));
  }
  // Budget gate: in priority order, autonomous spend is capped for the day. Over-budget work is not silently dropped; it becomes an explicit NO_ACTION.
  let spent = state.spentTodayUsd;
  const ordered = decisions.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || (a.businessId ?? "").localeCompare(b.businessId ?? ""));
  return ordered.map((d) => {
    if (d.budgetImpactUsd > 0 && d.approvalRequirement === "NONE" && spent + d.budgetImpactUsd > policy.dailyAutonomousSpendLimitUsd) {
      return { ...d, type: "NO_ACTION" as const, ruleId: "R90_BUDGET", reason: `autonomous daily budget ($${policy.dailyAutonomousSpendLimitUsd}) would be exceeded; was ${d.type}`, proposedMission: null, expiresAt: null, budgetImpactUsd: 0 };
    }
    if (d.approvalRequirement === "NONE") spent += d.budgetImpactUsd;
    return d;
  });
}

/** Persists decisions idempotently: the same state yields the same ID, so re-evaluating never duplicates a record. */
export function recordDecisions(store: LifecycleStore, decisions: Decision[]): number {
  let added = 0;
  for (const d of decisions) {
    if (store.decisions.has(d.decisionId)) continue;
    store.decisions.set(d.decisionId, d);
    added++;
  }
  return added;
}

/** Base ordering tier of a decision type (lower runs first). Exposed so bounded metric influence can be applied explicitly elsewhere. */
export const decisionPriority = (type: DecisionType): number => PRIORITY[type];
