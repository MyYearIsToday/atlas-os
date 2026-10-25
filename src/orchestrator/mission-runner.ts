import { MISSION_TASK_TYPE, type AutonomousWorkforce, type MissionLifecycleDispatcher, type MissionRunResult } from "./autonomous-workforce";
import type { MissionQueueRepository, Task } from "../services/mission-queue";
import type { OperationalLedger } from "../services/finance/ledger";
import type { PipelineStore, RoutingRecord } from "./atlas-pipeline";
import { INTERNAL_AUDIT_SUMMARY, DOSSIER_MISSION_TYPES } from "./atlas-pipeline";

/**
 * Mission types that may start themselves. Allowlist, not denylist: anything unlisted (including a
 * mission with no type) can only run after explicit human approval. A type earns a place here only if it
 * reads Atlas-owned data and has no external side effect, financial commitment, messaging, publishing,
 * purchasing or mutation of an outside system.
 */
export const AUTONOMOUS_SAFE_MISSION_TYPES: ReadonlySet<string> = new Set<string>([INTERNAL_AUDIT_SUMMARY, ...DOSSIER_MISSION_TYPES]);

/**
 * Connects mission execution to the existing AutonomousWorkforce and closes the loop with a
 * real MissionCompleted event.
 *
 * Three separate things stay separate:
 *  - automatic chaining: Auto-approval missions may start themselves when execution is enabled;
 *  - human approval: Approval Required / CEO Only missions run only with an explicit approval flag
 *    that AutonomousWorkforce's existing approval gate checks (this class never fabricates one);
 *  - execution: always off unless explicitly enabled, because it calls paid/rate-limited AI providers.
 *
 * MissionCompleted carries only the real ledger entries the workforce posted for that run's lineage
 * (AI cost). PaymentRecorded is never emitted here: nothing in this loop receives money.
 */
export interface MissionRunnerOptions {
  workforce: Pick<AutonomousWorkforce, "executeMission">;
  missionQueue: MissionQueueRepository;
  ledger: OperationalLedger;
  dispatcher: MissionLifecycleDispatcher;
  store: PipelineStore;
  executionEnabled: boolean;
  now?: () => Date;
  /** Returns a reason when a prerequisite (e.g. source approval) is incomplete; the mission then does not execute. */
  blockedBy?: (task: Task) => string | null;
  /** Called after a run settles (success or failure), including runs that outlive the HTTP request. */
  afterRun?: () => Promise<void>;
  /**
   * Implementation missions (website prototypes) are not text answers. When present, such a mission is handed to this handler,
   * which stores real files and sets the mission status itself. Without it the mission is blocked, never "completed" by prose.
   */
  implementationHandler?: (task: Task) => Promise<{ outcome: "RUNNING" | "BLOCKED" | "FAILED"; reason?: string }>;
  /** Mission types that need the implementationHandler. */
  implementationTypes?: (task: Task) => boolean;
}

export interface MissionRunSummary {
  taskId: string;
  executed: boolean;
  outcome: MissionRunResult["outcome"] | "DISABLED" | "NOT_FOUND" | "RUNNING";
  reason?: string;
  costUsd?: number;
  completedEventDispatched?: boolean;
}

type WfMeta = { employee?: string; routedBy?: string; usedFallback?: boolean; taskType?: string | null; selected?: { providerId: string; model: string } | null; attempts?: Array<{ providerId: string; model: string; outcome: string; status?: number; ms: number }> };

/** Builds the persisted routing record and a label that always names the model that ACTUALLY answered. */
export function describeRouting(r: { provider: string; model: string }, taskType: string | null): { label: string; record: RoutingRecord } {
  const x = r as unknown as { workforce?: WfMeta; routing?: { trail?: Array<{ tier: number; providerId: string; ok: boolean; model?: string; code?: string; reason?: string }> } };
  const wf = x.workforce;
  const attempts = (wf?.attempts ?? []).map((a) => ({ provider: a.providerId, model: a.model, outcome: a.outcome, ...(a.status ? { status: a.status } : {}), ms: a.ms }));
  const failed = attempts.filter((a) => a.outcome !== "ok");
  const record: RoutingRecord = {
    taskType: wf?.taskType ?? taskType, employee: wf?.employee ?? null, routedBy: wf?.routedBy ?? null,
    selected: wf?.selected ? { provider: wf.selected.providerId, model: wf.selected.model } : null,
    actual: { provider: r.provider, model: r.model }, usedFallback: Boolean(wf?.usedFallback) || (x.routing?.trail ?? []).some((t) => !t.ok),
    succeeded: true, attempts,
    tiers: (x.routing?.trail ?? []).map((t) => ({ tier: t.tier, provider: t.providerId, ok: t.ok, ...(t.model ? { model: t.model } : {}), ...(t.code ? { code: t.code } : {}), ...(t.reason ? { reason: t.reason.slice(0, 300) } : {}) })),
  };
  const base = `${r.provider}/${r.model}${wf?.employee ? ` via workforce:${wf.employee}` : ""}`;
  const label = record.usedFallback ? `${base} (FALLBACK${record.selected ? `; first choice was ${record.selected.provider}/${record.selected.model}` : ""}${failed.length ? `; ${failed.length} failed attempt${failed.length === 1 ? "" : "s"}` : ""})` : base;
  return { label, record };
}

export class MissionRunner {
  constructor(private options: MissionRunnerOptions) {}

  /** Hook for the MissionCreated handler. Never throws: a failure here must not retry the audit handler and duplicate missions. */
  async autoExecute(task: Task): Promise<void> {
    const { store } = this.options;
    const note = (state: string, error?: string) => store.record({ stage: "execution", event: "MissionCreated", businessId: task.clientId, handler: "mission-runner", state, ...(error ? { error } : {}) });
    try {
      if (task.approvalRequired !== "Auto") return note(`waiting for human approval (${task.approvalRequired})`);
      if (!task.missionType || !AUTONOMOUS_SAFE_MISSION_TYPES.has(task.missionType)) return note(`not auto-executed: mission type ${task.missionType ? `"${task.missionType}"` : "(none)"} is not on the autonomous-safe allowlist; needs human approval`);
      if (!this.options.executionEnabled) return note("eligible for autonomous execution but mission execution is disabled");
      await this.run(task.taskId, {}, { autonomous: true });
    } catch (error) {
      note("autonomous execution errored", error instanceof Error ? error.message : String(error));
    }
  }

  private inFlight = new Map<string, Promise<MissionRunSummary>>();

  /** One execution per mission at a time: repeated approvals, retries and scheduler overlap join nothing and start nothing. */
  async run(taskId: string, approval: { approvedByHuman?: boolean; approvedByCeo?: boolean }, mode: { autonomous?: boolean } = {}): Promise<MissionRunSummary> {
    if (this.inFlight.has(taskId)) return { taskId, executed: false, outcome: "RUNNING", reason: "this mission is already running; no second execution was started" };
    const p = this.execute(taskId, approval, mode).finally(async () => { this.inFlight.delete(taskId); try { await this.options.afterRun?.(); } catch { /* persistence errors are reported by the persistence layer */ } });
    this.inFlight.set(taskId, p);
    return p;
  }

  /** Starts the run and answers within waitMs. A slower run keeps going on the server; the result is persisted and viewable. */
  async runBounded(taskId: string, approval: { approvedByHuman?: boolean; approvedByCeo?: boolean }, waitMs = 15_000): Promise<MissionRunSummary> {
    const started = this.inFlight.has(taskId);
    const run = this.run(taskId, approval);
    const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), waitMs));
    const first = await Promise.race([run, timer]);
    if (first !== "timeout") return first;
    return { taskId, executed: false, outcome: "RUNNING", reason: started ? "already running" : "running on the server; open View results to follow it" };
  }

  private async execute(taskId: string, approval: { approvedByHuman?: boolean; approvedByCeo?: boolean }, mode: { autonomous?: boolean } = {}): Promise<MissionRunSummary> {
    const { store, missionQueue, ledger, dispatcher, workforce } = this.options;
    const task = missionQueue.getSnapshot().find((t) => t.taskId === taskId);
    if (!task) return { taskId, executed: false, outcome: "NOT_FOUND", reason: "Task not found" };
    if (task.status === "Completed") {
      // Idempotent: a finished mission is never re-run, re-billed, or re-announced.
      store.record({ stage: "execution", event: "MissionExecution", businessId: task.clientId, handler: "mission-runner", state: "already completed; no re-execution" });
      return { taskId, executed: false, outcome: "COMPLETED", reason: "already completed", completedEventDispatched: false };
    }
    if (mode.autonomous && (task.approvalRequired !== "Auto" || !task.missionType || !AUTONOMOUS_SAFE_MISSION_TYPES.has(task.missionType))) {
      return { taskId, executed: false, outcome: "BLOCKED", reason: "mission is not eligible for autonomous execution" };
    }
    if (this.options.implementationTypes?.(task)) {
      if (task.approvalRequired !== "Auto" && !approval.approvedByHuman && !approval.approvedByCeo) return { taskId, executed: false, outcome: "BLOCKED", reason: `waiting for human approval (${task.approvalRequired})` };
      if (!this.options.implementationHandler || !this.options.executionEnabled) {
        store.record({ stage: "execution", event: "MissionExecution", businessId: task.clientId, handler: "mission-runner", state: "refused: implementation mission needs website generation, which is not enabled", error: "implementation handler unavailable" });
        return { taskId, executed: false, outcome: "BLOCKED", reason: "This mission needs website generation, which is not enabled on this server. It was not run and was not marked complete." };
      }
      const r = await this.options.implementationHandler(task);
      store.record({ stage: "execution", event: "MissionExecution", businessId: task.clientId, handler: "prototype-service", state: r.outcome.toLowerCase(), ...(r.reason ? { error: r.reason } : {}) });
      return { taskId, executed: false, outcome: r.outcome === "RUNNING" ? "RUNNING" : r.outcome, ...(r.reason ? { reason: r.reason } : {}) };
    }
    const blocker = this.options.blockedBy?.(task);
    if (blocker) {
      store.record({ stage: "execution", event: "MissionExecution", businessId: task.clientId, handler: "mission-runner", state: "blocked by dependency", error: blocker });
      return { taskId, executed: false, outcome: "BLOCKED", reason: blocker };
    }
    if (!this.options.executionEnabled) {
      store.record({ stage: "execution", event: "MissionExecution", businessId: task.clientId, handler: "mission-runner", state: "refused: mission execution is disabled", error: "ATLAS_MISSION_EXECUTION_ENABLED is not true" });
      return { taskId, executed: false, outcome: "DISABLED", reason: "Mission execution is disabled" };
    }

    const result = await workforce.executeMission(taskId, { approval: { approvedByHuman: approval.approvedByHuman === true, approvedByCeo: approval.approvedByCeo === true } });
    const base = { stage: "execution" as const, event: "MissionExecution", businessId: task.clientId, handler: "autonomous-workforce" };
    if (result.outcome !== "COMPLETED") {
      store.record({ ...base, state: result.outcome, error: result.reason });
      return { taskId, executed: false, outcome: result.outcome, reason: result.reason };
    }

    const providerResult = result.result && "text" in result.result ? result.result : undefined;
    if (!providerResult?.text?.trim() || providerResult.text.trim().length < 20) {
      // "Completed" must mean a real output exists. Nothing usable was produced, so the mission is Failed, not Completed.
      const reason = "the provider returned no usable output";
      await missionQueue.update(taskId, { status: "Failed", completedAt: null, lastFailureReason: reason });
      store.record({ ...base, state: "failed: no usable output", error: reason });
      return { taskId, executed: false, outcome: "FAILED", reason };
    }
    if (providerResult) {
      // Model output is a work product, never evidence: it is stored apart and flagged accordingly.
      const routing = describeRouting(providerResult, result.task.missionType ? MISSION_TASK_TYPE[result.task.missionType] ?? null : null);
      store.missionOutputs.set(taskId, { generatedBy: routing.label, text: providerResult.text, isEvidence: false, routing: routing.record });
    }
    const transactions = ledger.list().filter((t) => t.evidenceRefs.includes(`lineage:${result.lineageId}`));
    const day = (this.options.now?.() ?? new Date()).toISOString().slice(0, 10);
    await dispatcher.dispatch("MissionCompleted", {
      businessId: task.clientId ?? "unassigned",
      taskId,
      transactions,
      period: { start: day, end: day, timezone: "UTC", currency: "USD", includedStatuses: ["POSTED"] },
    } as never, { eventId: `mission-completed:${taskId}:${result.lineageId}`, lineageId: result.lineageId });
    const costUsd = result.task.executionHistory.reduce((n, record) => n + (record.estimatedCostUsd ?? 0), 0);
    store.record({ ...base, state: `completed; ${transactions.length} ledger entr${transactions.length === 1 ? "y" : "ies"}`, nextEvent: "MissionCompleted" });
    return { taskId, executed: true, outcome: "COMPLETED", costUsd, completedEventDispatched: true };
  }
}
