import { createHash } from "node:crypto";
import type { MissionQueueRepository } from "../mission-queue";
import type { OperationalLedger } from "../finance/ledger";
import type { PipelineStore } from "../../orchestrator/atlas-pipeline";
import { applyScoringGate, buildAuditInput, buildOpportunityInput } from "../../orchestrator/atlas-pipeline";
import { calculateOpportunityScore } from "../scoring/opportunity-score";
import { acquireEvidence, type EvidenceCollector } from "../evidence/acquisition";
import type { EvidenceRecord } from "../evidence/evidence";
import type { AutonomyPolicy } from "./policy";
import type { LifecycleStore } from "./lifecycle-store";
import { buildAutonomyState, evaluateAutonomy, recordDecisions, type Decision } from "./controller";
import { applyMetricPriority, computeMetrics, type MetricInputs } from "./metrics";
import type { ProspectService } from "./prospects";
import type { DeliveryService } from "./delivery";
import type { RevenueService } from "./revenue";

/**
 * Continuous autonomy loop (Objective 8): a deterministic orchestration layer AROUND the existing controller.
 * It adds no second mission executor and no second retry system: internal work is done by the existing
 * orchestrator handlers and lifecycle services (approval-required missions are still run only through the
 * existing MissionRunner after a typed human approval; auto-safe missions still start themselves through the
 * existing MissionCreated hook when mission execution is enabled).
 *
 * Per cycle: check the circuit breaker -> load durable state -> evaluate the controller -> apply metric ordering
 * -> pick the next PERMITTED decision (internal only, never executed before, within every limit) -> execute it ->
 * persist -> re-evaluate -> stop when nothing legitimate remains or a limit is reached.
 */
export interface BreakerState { state: "CLOSED" | "OPEN" | "HALF_OPEN"; consecutiveFailures: number; openedAt: string | null; lastFailureAt: string | null }
export interface DecisionExecution { decisionId: string; cycleId: string; type: string; businessId: string | null; outcome: "EXECUTED" | "FAILED"; attempts: number; at: string; error?: string }
export type CycleStatus = "RUNNING" | "COMPLETED" | "STOPPED_LIMIT" | "STOPPED_CIRCUIT_OPEN" | "FAILED";
export interface CycleStep {
  stepId: string; at: string; decisionId: string; type: string; businessId: string | null; ruleId: string; action: "EXECUTED" | "FAILED" | "SKIPPED";
  reason: string; missionIds: string[]; sideEffects: string[]; finance: { aiCostTransactionIds: string[]; spendUsd: number }; error?: string;
}
export interface AutonomyCycle {
  cycleId: string; trigger: string; startedAt: string; completedAt: string | null; status: CycleStatus; stopReason: string | null; policyHash: string;
  stateSnapshot: { hash: string; at: string; businesses: number; spentTodayUsd: number; decisionIds: string[]; breaker: BreakerState } | null;
  steps: CycleStep[]; missionsCreated: number; spendUsd: number; failure: string | null;
  nextEvaluation: { pendingInternal: number; awaitingHuman: number; awaitingExternal: number } | null;
}

const sha = (...p: unknown[]) => createHash("sha256").update(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).digest("hex");

export interface ExecResult { sideEffects: string[]; skipped?: boolean; note?: string }
export type DecisionExecutor = (decision: Decision) => Promise<ExecResult>;

export interface LoopDeps {
  policy: AutonomyPolicy; lifecycle: LifecycleStore; pipeline: PipelineStore; missionQueue: MissionQueueRepository; ledger: OperationalLedger;
  execute: DecisionExecutor; metricInputs: () => MetricInputs; now?: () => string; persistenceHealthy?: () => boolean;
}

/** USD AI cost recorded in the ledger (optionally only entries recorded at/after a UTC day prefix). */
export function aiCostUsd(ledger: OperationalLedger, dayPrefix?: string): { usd: number; ids: string[] } {
  const rows = ledger.list().filter((t) => t.category === "AI_COST" && t.direction === "OUTFLOW" && t.amount.currency === "USD" && (!dayPrefix || t.recordedAt.startsWith(dayPrefix)));
  return { usd: rows.reduce((n, t) => n + Number(t.amount.minorUnits) / 10 ** t.amount.scale, 0), ids: rows.map((t) => t.transactionId) };
}

/** Builds the executor that performs the INTERNAL decisions by calling existing handlers/services. Anything else is refused. */
export function createInternalExecutor(env: {
  pipeline: PipelineStore; collectors: EvidenceCollector[]; missionQueue: MissionQueueRepository; lifecycle: LifecycleStore;
  dispatcher: { dispatch(type: any, payload: any): Promise<unknown> }; prospects: ProspectService; delivery: DeliveryService; revenue: RevenueService; now?: () => string;
}): DecisionExecutor {
  const { pipeline: store } = env;
  const business = (d: Decision) => {
    const b = d.businessId ? store.businesses.get(d.businessId) : undefined;
    if (!b) throw new Error(`business ${d.businessId} is not in the pipeline store`);
    return b;
  };
  const owns = (source: string, r: EvidenceRecord) => (source === "website" ? r.collector === "website_http" : source === "peers" ? r.field.startsWith("peers.") : false);
  const scoreOutcome = (id: string) => {
    const b = store.businesses.get(id)!;
    return applyScoringGate(calculateOpportunityScore(buildOpportunityInput(b, store.evidence.get(id) ?? [], store.observations.get(id) ?? [])));
  };
  return async (d) => {
    const id = d.businessId ?? "";
    switch (d.type) {
      case "COLLECT_EVIDENCE": {
        const b = business(d);
        const acquired = await acquireEvidence(b, env.collectors);
        const refreshed = acquired.outcomes.filter((o) => o.status === "COLLECTED");
        if (!refreshed.length) {
          const failed = acquired.outcomes.filter((o) => o.status === "FAILED");
          if (failed.length) throw new Error(`evidence refresh failed: ${failed.map((o) => `${o.source}:${o.failure?.code}`).join(", ")}`);
          return { sideEffects: [], skipped: true, note: "no evidence source could be read" };
        }
        // Replace only what the refreshed sources own; evidence from sources that did not refresh is kept.
        const kept = (store.observations.get(id) ?? []).filter((r) => !refreshed.some((o) => owns(o.source, r)));
        store.observations.set(id, [...kept, ...refreshed.flatMap((o) => o.records)]);
        // Rescore with the existing pure functions. The audit and its missions are NOT regenerated (no duplicate missions).
        store.scores.set(id, scoreOutcome(id).score);
        store.record({ stage: "evidence", event: "AutonomyRefresh", businessId: id, handler: "autonomy:collect-evidence", state: `refreshed ${refreshed.map((o) => o.source).join(",")}; rescored` });
        return { sideEffects: [`evidence:${id}`, `score:${id}`] };
      }
      case "ANALYZE_OPPORTUNITY": {
        const b = business(d);
        await env.dispatcher.dispatch("EvidenceUpdated", { businessId: id, opportunityInput: buildOpportunityInput(b, store.evidence.get(id) ?? [], store.observations.get(id) ?? []) });
        if (!store.scores.has(id)) throw new Error("scoring produced no score");
        return { sideEffects: [`score:${id}`, ...(store.audits.has(id) ? [`audit:${id}`] : [])] };
      }
      case "GENERATE_AUDIT": {
        const b = business(d);
        const outcome = scoreOutcome(id);
        await env.dispatcher.dispatch("ScoreCalculated", { businessId: id, opportunityScore: outcome.score, auditInput: buildAuditInput(b, store.evidence.get(id) ?? [], outcome, store.observations.get(id) ?? []) });
        if (!store.audits.has(id)) throw new Error("audit generation produced no audit");
        return { sideEffects: [`audit:${id}`] };
      }
      case "CREATE_OUTREACH_MISSION": {
        const b = business(d);
        const open = env.missionQueue.getSnapshot().find((t) => t.clientId === id && t.missionType === "outreach_draft" && t.status !== "Completed" && t.status !== "Failed");
        if (open) return { sideEffects: [], skipped: true, note: "an outreach_draft mission is already open" };
        const effects: string[] = [];
        if (!env.lifecycle.prospects.has(`prospect:${id}`)) { env.prospects.create(id, "system:atlas", `qualified by controller decision ${d.decisionId.slice(0, 12)}`); effects.push(`prospect:${id}`); }
        const score = store.scores.get(id);
        const observed = (store.observations.get(id) ?? []).map((o) => o.field).join(", ") || "none";
        const task = await env.missionQueue.create({
          title: `${d.proposedMission?.title ?? "Prepare outreach draft"} — ${b.canonicalName}`,
          description: `Draft a short, factual first message to the owner of "${b.canonicalName}" (${b.category ?? "business"}, ${b.address ?? "address unknown"}). Begin the output with one line "Subject: <subject>". Use ONLY these facts and invent nothing (no claims, prices, results or contact details): opportunity score ${score?.overallScore ?? "withheld"}/100; observed website/peer evidence fields: ${observed}.`,
          assignedAI: "builder", clientId: id, priority: "Medium", approvalRequired: "Approval Required", dueDate: (env.now?.() ?? new Date().toISOString()).slice(0, 10), estimatedCost: 0, estimatedTime: "unspecified", missionType: d.proposedMission?.missionType ?? "outreach_draft",
        });
        return { sideEffects: [...effects, `mission:${task.taskId}`] };
      }
      case "PREPARE_DELIVERY": {
        const prospect = env.lifecycle.prospects.get(`prospect:${id}`);
        const engagement = [...env.lifecycle.engagements.values()].find((e) => e.businessId === id);
        if (prospect?.state === "WON" && !engagement) {
          const e = env.delivery.startEngagement(prospect.prospectId, "system:atlas");
          env.delivery.beginOnboarding(e.engagementId, "system:atlas");
          return { sideEffects: [`engagement:${e.engagementId}`] };
        }
        if (engagement?.state === "CUSTOMER_WON") { env.delivery.beginOnboarding(engagement.engagementId, "system:atlas"); return { sideEffects: [`engagement:${engagement.engagementId}`] }; }
        if (engagement?.state === "DELIVERY_PLAN") { await env.delivery.createDeliveryMissions(engagement.engagementId); return { sideEffects: [`engagement:${engagement.engagementId}`] }; }
        return { sideEffects: [], skipped: true, note: "no autonomous delivery step at this stage (assembling artifacts is human work)" };
      }
      case "REQUEST_PAYMENT": {
        const engagement = [...env.lifecycle.engagements.values()].find((e) => e.businessId === id);
        if (!engagement) throw new Error("no engagement for this business");
        const invoice = env.revenue.createEligible(engagement, "system:atlas"); // internal eligibility record only
        return { sideEffects: [`invoice:${invoice.invoiceId}`] };
      }
      default: throw new Error(`no internal executor for ${d.type}`);
    }
  };
}

const MISSION_CREATING = new Set(["CREATE_OUTREACH_MISSION", "PREPARE_DELIVERY", "ANALYZE_OPPORTUNITY", "GENERATE_AUDIT"]);

export async function runAutonomyCycle(deps: LoopDeps, trigger: string): Promise<AutonomyCycle> {
  const { policy, lifecycle } = deps;
  const L = policy.loop;
  const nowIso = () => (deps.now ?? (() => new Date().toISOString()))();
  const startedAt = nowIso();
  let cycleId = `cycle:${startedAt}`;
  for (let n = 1; lifecycle.cycles.has(cycleId); n++) cycleId = `cycle:${startedAt}#${n}`;
  let cycle: AutonomyCycle = { cycleId, trigger, startedAt, completedAt: null, status: "RUNNING", stopReason: null, policyHash: sha(policy), stateSnapshot: null, steps: [], missionsCreated: 0, spendUsd: 0, failure: null, nextEvaluation: null };
  const save = (patch: Partial<AutonomyCycle> = {}) => { cycle = { ...cycle, ...patch }; lifecycle.cycles.set(cycleId, cycle); };
  const finish = (status: CycleStatus, stopReason: string, patch: Partial<AutonomyCycle> = {}) => save({ status, stopReason, completedAt: nowIso(), ...patch });
  save();

  const evaluate = () => {
    const spentToday = aiCostUsd(deps.ledger, nowIso().slice(0, 10)).usd;
    const state = buildAutonomyState({ now: nowIso(), pipeline: deps.pipeline, missions: deps.missionQueue.getSnapshot(), lifecycle, spentTodayUsd: spentToday });
    return { state, spentToday, decisions: evaluateAutonomy(state, policy) };
  };

  try {
    // --- circuit breaker ---
    let breaker = lifecycle.breaker;
    if (breaker.state !== "CLOSED") {
      const reopenAt = Date.parse(breaker.openedAt ?? startedAt) + L.circuitBreaker.openForMs;
      if (breaker.state === "OPEN" && Date.parse(startedAt) < reopenAt) {
        return finish("STOPPED_CIRCUIT_OPEN", `circuit breaker is open until ${new Date(reopenAt).toISOString()}`), cycle;
      }
      // Cool-down elapsed: reset ONLY after a successful health/eligibility evaluation.
      let healthy = deps.persistenceHealthy?.() ?? true;
      if (healthy) { try { evaluate(); } catch { healthy = false; } }
      if (!healthy) {
        lifecycle.saveBreaker({ ...breaker, state: "OPEN", openedAt: startedAt });
        return finish("STOPPED_CIRCUIT_OPEN", "health/eligibility evaluation failed; breaker stays open", {}), cycle;
      }
      breaker = { state: "CLOSED", consecutiveFailures: 0, openedAt: null, lastFailureAt: breaker.lastFailureAt };
      lifecycle.saveBreaker(breaker);
    }

    const metrics = computeMetrics(deps.metricInputs(), startedAt, policy, startedAt);
    const executedThisCycle = new Set<string>();
    const missionActionsByBusiness = new Map<string, number>();
    const taskIds = () => new Set(deps.missionQueue.getSnapshot().map((t) => t.taskId));
    let actions = 0, limitBlocked = 0, firstPass = true;

    for (;;) {
      const { state, spentToday, decisions } = evaluate();
      recordDecisions(lifecycle, decisions);
      if (firstPass) save({ stateSnapshot: { hash: sha(state), at: state.now, businesses: state.businesses.length, spentTodayUsd: spentToday, decisionIds: decisions.map((d) => d.decisionId), breaker: lifecycle.breaker } });
      const ordered = applyMetricPriority(decisions, metrics.last_30d, policy);
      const skip = (d: Decision, reason: string) => { if (firstPass) save({ steps: [...cycle.steps, { stepId: `${cycleId}/skip/${d.decisionId.slice(0, 12)}`, at: nowIso(), decisionId: d.decisionId, type: d.type, businessId: d.businessId, ruleId: d.ruleId, action: "SKIPPED", reason, missionIds: [], sideEffects: [], finance: { aiCostTransactionIds: [], spendUsd: 0 } }] }); };
      let chosen: Decision | null = null;
      limitBlocked = 0;
      for (const d of ordered) {
        if (L.externalDecisionTypes.includes(d.type)) { skip(d, "external action: needs its human approval boundary; the loop never performs it"); continue; }
        if (!L.internalDecisionTypes.includes(d.type)) continue;
        if (d.expiresAt && Date.parse(nowIso()) > Date.parse(d.expiresAt)) { skip(d, "decision expired"); continue; }
        const prior = lifecycle.executions.get(d.decisionId);
        if (executedThisCycle.has(d.decisionId) || prior?.outcome === "EXECUTED") continue; // never execute the same deterministic decision twice
        if (prior?.outcome === "FAILED") {
          if (prior.attempts >= policy.maxRetries) { skip(d, `retries exhausted (${prior.attempts})`); continue; }
          if (Date.parse(nowIso()) - Date.parse(prior.at) < L.failureCooldownMs) { skip(d, "cooling down after a failed attempt"); continue; }
        }
        const biz = d.businessId ?? "";
        const spendNow = cycle.spendUsd + d.budgetImpactUsd;
        if (actions >= L.maxActionsPerCycle) { limitBlocked++; continue; }
        if (MISSION_CREATING.has(d.type) && (cycle.missionsCreated >= L.maxMissionsPerCycle || (missionActionsByBusiness.get(biz) ?? 0) >= L.maxMissionsPerBusinessPerCycle)) { limitBlocked++; skip(d, "mission limit for this cycle/business reached"); continue; }
        if (spendNow > L.maxSpendPerCycleUsd || spentToday + d.budgetImpactUsd > L.maxSpendPerDayUsd) { limitBlocked++; skip(d, "autonomous spend limit reached"); continue; }
        chosen = d;
        break;
      }
      firstPass = false;
      if (!chosen) {
        const nextEvaluation = { pendingInternal: limitBlocked, awaitingHuman: decisions.filter((d) => d.type === "WAIT_FOR_HUMAN" || (L.externalDecisionTypes.includes(d.type))).length, awaitingExternal: decisions.filter((d) => d.type === "WAIT_FOR_EXTERNAL_EVENT").length };
        return finish(limitBlocked ? "STOPPED_LIMIT" : "COMPLETED", limitBlocked ? "LIMIT_REACHED" : "NO_LEGITIMATE_ACTION", { nextEvaluation }), cycle;
      }

      // --- execute exactly one permitted internal decision ---
      actions++;
      const before = taskIds();
      const costBefore = aiCostUsd(deps.ledger);
      const prior = lifecycle.executions.get(chosen.decisionId);
      const at = nowIso();
      let step: CycleStep = { stepId: `${cycleId}/${actions}`, at, decisionId: chosen.decisionId, type: chosen.type, businessId: chosen.businessId, ruleId: chosen.ruleId, action: "EXECUTED", reason: chosen.reason, missionIds: [], sideEffects: [], finance: { aiCostTransactionIds: [], spendUsd: 0 } };
      let failed: string | null = null;
      try {
        const r = await deps.execute(chosen);
        step = { ...step, sideEffects: r.sideEffects, action: r.skipped ? "SKIPPED" : "EXECUTED", reason: r.skipped ? `${chosen.reason} — ${r.note ?? "nothing to do"}` : chosen.reason };
      } catch (e) { failed = e instanceof Error ? e.message : String(e); }
      const created = deps.missionQueue.getSnapshot().filter((t) => !before.has(t.taskId));
      const costAfter = aiCostUsd(deps.ledger);
      const newCostIds = costAfter.ids.filter((x) => !costBefore.ids.includes(x));
      const spend = costAfter.usd - costBefore.usd;
      const autoFailure = created.find((t) => t.status === "Failed");
      if (!failed && autoFailure) failed = `auto-started mission ${autoFailure.taskId} failed`;
      step = { ...step, missionIds: created.map((t) => t.taskId), finance: { aiCostTransactionIds: newCostIds, spendUsd: spend }, ...(failed ? { action: "FAILED" as const, error: failed } : {}) };
      executedThisCycle.add(chosen.decisionId);
      if (created.length) missionActionsByBusiness.set(chosen.businessId ?? "", (missionActionsByBusiness.get(chosen.businessId ?? "") ?? 0) + 1);
      if (step.action !== "SKIPPED") lifecycle.executions.set(chosen.decisionId, { decisionId: chosen.decisionId, cycleId, type: chosen.type, businessId: chosen.businessId, outcome: failed ? "FAILED" : "EXECUTED", attempts: (prior?.attempts ?? 0) + 1, at, ...(failed ? { error: failed } : {}) });
      save({ steps: [...cycle.steps, step], missionsCreated: cycle.missionsCreated + created.length, spendUsd: cycle.spendUsd + spend });

      // --- circuit breaker accounting ---
      if (failed) {
        const b = lifecycle.breaker;
        const consecutive = b.consecutiveFailures + 1;
        const trip = consecutive >= L.circuitBreaker.tripAfterConsecutiveFailures;
        lifecycle.saveBreaker({ state: trip ? "OPEN" : b.state, consecutiveFailures: consecutive, openedAt: trip ? nowIso() : b.openedAt, lastFailureAt: nowIso() });
        if (trip) return finish("STOPPED_CIRCUIT_OPEN", `circuit breaker tripped after ${consecutive} consecutive failures`), cycle;
      } else if (step.action === "EXECUTED" && lifecycle.breaker.consecutiveFailures) {
        lifecycle.saveBreaker({ ...lifecycle.breaker, consecutiveFailures: 0 });
      }
    }
  } catch (e) {
    return finish("FAILED", "cycle error", { failure: e instanceof Error ? e.message : String(e) }), cycle;
  }
}

/** Starts cycles on a timer. Start/stop controllable, never overlaps: a wake-up during a running cycle is refused. */
export class AutonomyScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private runCycle: (trigger: string) => Promise<AutonomyCycle>, private onError: (e: unknown) => void = () => undefined) {}
  start(intervalMs: number) {
    if (this.timer) return;
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error("autonomy interval must be at least 1000ms");
    this.timer = setInterval(() => { void this.wake("scheduled"); }, intervalMs);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  isStarted() { return this.timer !== null; }
  isCycleRunning() { return this.running; }
  async wake(trigger: string): Promise<{ started: boolean; reason?: string; cycle?: AutonomyCycle }> {
    if (this.running) return { started: false, reason: "cycle_in_progress" };
    this.running = true;
    try { return { started: true, cycle: await this.runCycle(trigger) }; }
    catch (e) { this.onError(e); return { started: true, reason: "cycle_error" }; }
    finally { this.running = false; }
  }
}
