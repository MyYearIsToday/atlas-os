import type { AutonomousWorkforce, MissionLifecycleDispatcher, MissionRunResult } from "./autonomous-workforce";
import type { MissionQueueRepository, Task } from "../services/mission-queue";
import type { OperationalLedger } from "../services/finance/ledger";
import type { PipelineStore } from "./atlas-pipeline";

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
}

export interface MissionRunSummary {
  taskId: string;
  executed: boolean;
  outcome: MissionRunResult["outcome"] | "DISABLED" | "NOT_FOUND";
  reason?: string;
  costUsd?: number;
  completedEventDispatched?: boolean;
}

export class MissionRunner {
  constructor(private options: MissionRunnerOptions) {}

  /** Hook for the MissionCreated handler: only Auto missions may start themselves. */
  async autoExecute(task: Task): Promise<void> {
    if (task.approvalRequired !== "Auto") {
      this.options.store.record({ stage: "execution", event: "MissionCreated", businessId: task.clientId, handler: "mission-runner", state: `waiting for human approval (${task.approvalRequired})` });
      return;
    }
    if (!this.options.executionEnabled) {
      this.options.store.record({ stage: "execution", event: "MissionCreated", businessId: task.clientId, handler: "mission-runner", state: "Auto mission not executed: mission execution is disabled" });
      return;
    }
    await this.run(task.taskId, {});
  }

  async run(taskId: string, approval: { approvedByHuman?: boolean; approvedByCeo?: boolean }): Promise<MissionRunSummary> {
    const { store, missionQueue, ledger, dispatcher, workforce } = this.options;
    const task = missionQueue.getSnapshot().find((t) => t.taskId === taskId);
    if (!task) return { taskId, executed: false, outcome: "NOT_FOUND", reason: "Task not found" };
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
    if (providerResult) {
      // Model output is a work product, never evidence: it is stored apart and flagged accordingly.
      store.missionOutputs.set(taskId, { generatedBy: `${providerResult.provider}/${providerResult.model}`, text: providerResult.text, isEvidence: false });
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
