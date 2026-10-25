import type { AgentId } from "../agents";
import {
  localMissionQueueRepository,
  type MissionExecutionRecord,
  type MissionQueueRepository,
  type Task,
} from "../services/mission-queue";
import { checkApproval, type ApprovalContext } from "./approval-gateway";
import type {
  OrchestrationEventMap,
  OrchestrationEventType,
  WorkerRole,
} from "./orchestration-types";
import { recordAiCost } from "../workforce/cost-tracker";
import { runAiJob, type AiJobOutcome } from "../workforce/ai-job";
import type { OperationalLedger } from "../services/finance/ledger";
import type { ProviderRegistry } from "../workforce/provider-registry";
import type {
  AIJobRequest,
  AIProviderFailure,
  AIProviderResult,
  AIProviderSuccess,
} from "../workforce/provider-types";
import type { WorkforceConfig } from "../workforce/workforce-config";

/**
 * The lifecycle dispatcher is intentionally the existing Orchestrator seam.
 * AutonomousWorkforce owns mission state; AtlasOrchestrator owns event
 * validation, approval gates, idempotency, logging, and handler dispatch.
 */
export interface MissionLifecycleDispatcher {
  dispatch<T extends OrchestrationEventType>(
    type: T,
    payload: OrchestrationEventMap[T],
    options?: { eventId?: string; lineageId?: string },
  ): Promise<void>;
}

export type MissionJobExecutor = (
  request: AIJobRequest,
  registry: ProviderRegistry,
  config: WorkforceConfig,
  ledger: OperationalLedger,
) => Promise<AiJobOutcome>;

export interface AutonomousWorkforceOptions {
  missionQueue?: MissionQueueRepository;
  providerRegistry: ProviderRegistry;
  workforceConfig: WorkforceConfig;
  ledger: OperationalLedger;
  orchestrator: MissionLifecycleDispatcher;
  /** Mission-level retries. Provider/model retries remain owned by runAiJob. */
  maxRetries?: number;
  now?: () => Date;
  executeJob?: MissionJobExecutor;
  /** Extra, read-only context for a mission (business record, approved evidence, prior stage outputs). */
  contextProvider?: (task: Task) => string | undefined;
  /** Optional routing hints for a mission (e.g. models to avoid on a recovery attempt). */
  hintsProvider?: (task: Task) => { excludeModels?: string[] } | undefined;
}

export interface MissionExecutionOptions {
  approval?: Pick<ApprovalContext, "approvedByHuman" | "approvedByCeo">;
  budgetLimitUsd?: number;
}

export type MissionRunOutcome = "COMPLETED" | "FAILED" | "BLOCKED";

export interface MissionRunResult {
  outcome: MissionRunOutcome;
  task: Task;
  attempts: number;
  lineageId: string;
  result?: AIProviderResult;
  reason?: string;
}

const agentToWorkerRole: Record<AgentId, WorkerRole> = {
  scout: "researcher",
  builder: "analyst",
  operator: "planner",
  closer: "writer",
  finance: "finance",
};

const priorityValue: Record<Task["priority"], number> = {
  Low: 25,
  Medium: 50,
  High: 75,
  Critical: 100,
};

let executionCounter = 0;

function nextExecutionId(taskId: string, lineageId: string): string {
  executionCounter += 1;
  return `${taskId}:${lineageId}:execution-${executionCounter}`;
}

function nextMissionLineage(taskId: string): string {
  executionCounter += 1;
  return `mission-${taskId}-${Date.now()}-${executionCounter}`;
}

/**
 * Which kind of thinking a mission needs. Used only by the Workforce router (employee/model selection); other providers ignore it.
 * Evidence evaluation and strategy go to the strongest reasoning employee, simple extraction stays on the cheaper research employee.
 */
export const MISSION_TASK_TYPE: Record<string, string> = {
  dossier_profile: "deep_research",
  dossier_audit: "business_analysis",
  dossier_competitors: "competitor_analysis",
  dossier_market: "market_analysis",
  dossier_campaign: "writing",
  dossier_swot: "business_analysis",
  dossier_growth: "strategy",
  dossier_plan: "strategy",
  dossier_followup: "research",
  // Implementation work: routed to the coding employee, never to the research employee.
  website_prototype: "website_prototype",
};

function isProviderSuccess(result: AIProviderResult): result is AIProviderSuccess {
  return result.failed === false;
}

function taskOrThrow(repository: MissionQueueRepository, taskId: string): Task {
  const task = repository.getSnapshot().find((candidate) => candidate.taskId === taskId);
  if (!task) throw new Error(`Mission "${taskId}" not found`);
  return task;
}

export class AutonomousWorkforce {
  private readonly missionQueue: MissionQueueRepository;
  private readonly maxRetries: number;
  private readonly now: () => Date;
  private readonly executeJob: MissionJobExecutor;

  constructor(private readonly options: AutonomousWorkforceOptions) {
    this.missionQueue = options.missionQueue ?? localMissionQueueRepository;
    this.maxRetries = Math.max(0, options.maxRetries ?? options.workforceConfig.maxRetries);
    this.now = options.now ?? (() => new Date());
    this.executeJob =
      options.executeJob ??
      ((request, registry, config, ledger) => runAiJob(request, registry, config, ledger));
  }

  /**
   * Executes a queued mission and automatically retries failures up to the
   * mission-level bound. Provider/model routing and provider-level retries
   * remain entirely inside the existing runAiJob path.
   */
  async executeMission(taskId: string, options: MissionExecutionOptions = {}): Promise<MissionRunResult> {
    const initial = taskOrThrow(this.missionQueue, taskId);
    if (initial.status === "Completed") {
      return { outcome: "COMPLETED", task: initial, attempts: 0, lineageId: initial.lineageId ?? "unassigned" };
    }
    if (initial.status === "Failed") {
      return {
        outcome: "FAILED",
        task: initial,
        attempts: 0,
        lineageId: initial.lineageId ?? "unassigned",
        reason: "Mission is failed; call retryMission() for an explicit retry.",
      };
    }

    const remainingAttempts = Math.max(1, this.maxRetries - initial.retryCount + 1);
    return this.run(taskId, options, remainingAttempts);
  }

  /**
   * Explicit retry is a deliberate operator action and consumes one bounded
   * mission attempt. It never resets retryCount or bypasses the budget guard.
   */
  async retryMission(taskId: string, options: MissionExecutionOptions = {}): Promise<MissionRunResult> {
    const task = taskOrThrow(this.missionQueue, taskId);
    if (task.status !== "Failed") {
      throw new Error(`Mission "${taskId}" can only be explicitly retried from Failed status`);
    }
    if (task.retryCount >= this.maxRetries && task.lastFailureCode !== "BUDGET_EXCEEDED") {
      return {
        outcome: "FAILED",
        task,
        attempts: 0,
        lineageId: task.lineageId ?? "unassigned",
        reason: "Mission retry limit reached.",
      };
    }

    await this.missionQueue.requeue(taskId);
    return this.run(taskId, options, 1);
  }

  private async run(
    taskId: string,
    options: MissionExecutionOptions,
    maxAttemptsThisRun: number,
  ): Promise<MissionRunResult> {
    let attemptsThisRun = 0;

    while (attemptsThisRun < maxAttemptsThisRun) {
      let task = taskOrThrow(this.missionQueue, taskId);
      const lineageId = task.lineageId ?? nextMissionLineage(taskId);
      if (task.lineageId !== lineageId) {
        task = await this.missionQueue.update(taskId, { lineageId });
      }

      const workerRole = agentToWorkerRole[task.assignedAI];
      const approval = checkApproval({
        level: task.approvalRequired,
        approvedByHuman: options.approval?.approvedByHuman ?? false,
        approvedByCeo: options.approval?.approvedByCeo ?? false,
      });

      if (!approval.allowed) {
        const blockedAt = this.now().toISOString();
        const record: MissionExecutionRecord = {
          executionId: nextExecutionId(taskId, lineageId),
          lineageId,
          attempt: task.retryCount + 1,
          startedAt: blockedAt,
          completedAt: blockedAt,
          outcome: "BLOCKED",
          assignedAI: task.assignedAI,
          workerRole,
          estimatedCostUsd: 0,
          reason: approval.reason,
        };
        const updated = await this.missionQueue.update(taskId, {
          status: "Pending",
          completedAt: null,
          executionHistory: [...task.executionHistory, record],
        });
        await this.emit("MissionExecutionBlocked", {
          taskId,
          attempt: record.attempt,
          reason: approval.reason,
          requeued: true,
        }, lineageId, record.executionId);
        return { outcome: "BLOCKED", task: updated, attempts: attemptsThisRun, lineageId, reason: approval.reason };
      }

      const startedAt = this.now().toISOString();
      task = await this.missionQueue.update(taskId, {
        status: "In Progress",
        completedAt: null,
        lineageId,
      });
      const attempt = task.retryCount + 1;
      attemptsThisRun += 1;

      await this.emit("MissionExecutionStarted", {
        taskId,
        attempt,
        workerRole,
        assignedAI: task.assignedAI,
      }, lineageId, `${lineageId}:started:${attempt}`);

      const taskType = task.missionType ? MISSION_TASK_TYPE[task.missionType] : undefined;
      const request: AIJobRequest = {
        workerRole,
        ...(taskType ? { taskType } : {}),
        ...((() => { const h = this.options.hintsProvider?.(task); return h?.excludeModels?.length ? { excludeModels: h.excludeModels } : {}; })()),
        // Structured dossier stages return long JSON; the providers' default of 1024 tokens truncated it.
        ...(task.missionType && task.missionType.startsWith("dossier_") ? { maxTokens: 6000 } : {}),
        task: `${task.title}\n\n${task.description}${(() => { const c = this.options.contextProvider?.(task); return c ? `\n\n${c}` : ""; })()}`,
        priority: priorityValue[task.priority],
        confidenceTarget: this.options.workforceConfig.escalationConfidenceThreshold,
        budgetLimitUsd: options.budgetLimitUsd ?? this.options.workforceConfig.dailyCostLimitUsd,
        lineageId,
      };
      const outcome = await this.executeJob(
        request,
        this.options.providerRegistry,
        this.options.workforceConfig,
        this.options.ledger,
      );
      const completedAt = this.now().toISOString();

      const result = outcome.result;
      if (isProviderSuccess(result)) {
        recordAiCost(outcome.costRecord, this.options.ledger, this.options.workforceConfig);
        const record: MissionExecutionRecord = {
          executionId: nextExecutionId(taskId, lineageId),
          lineageId,
          attempt,
          startedAt,
          completedAt,
          outcome: "SUCCEEDED",
          assignedAI: task.assignedAI,
          workerRole,
          provider: result.provider,
          model: result.model,
          estimatedCostUsd: outcome.costRecord.estimatedCostUsd,
        };
        const updated = await this.missionQueue.update(taskId, {
          status: "Completed",
          completedAt,
          lastFailureReason: null,
          lastFailureCode: null,
          executionHistory: [...task.executionHistory, record],
        });
        await this.emit("MissionExecutionSucceeded", {
          taskId,
          attempt,
          provider: result.provider,
          model: result.model,
          estimatedCostUsd: outcome.costRecord.estimatedCostUsd,
        }, lineageId, record.executionId);
        return { outcome: "COMPLETED", task: updated, attempts: attemptsThisRun, lineageId, result };
      }

      const failure: AIProviderFailure = result;
      const budgetDenied = failure.code === "BUDGET_EXCEEDED";
      const nextRetryCount = budgetDenied ? task.retryCount : task.retryCount + 1;
      const record: MissionExecutionRecord = {
        executionId: nextExecutionId(taskId, lineageId),
        lineageId,
        attempt,
        startedAt,
        completedAt,
        outcome: "FAILED",
        assignedAI: task.assignedAI,
        workerRole,
        provider: failure.provider,
        estimatedCostUsd: 0,
        reason: failure.reason,
      };
      const retryable = !budgetDenied && nextRetryCount <= this.maxRetries && attemptsThisRun < maxAttemptsThisRun;
      let updated = await this.missionQueue.update(taskId, {
        status: retryable ? "Pending" : "Failed",
        completedAt: null,
        retryCount: nextRetryCount,
        lastFailureReason: failure.reason,
        lastFailureCode: failure.code,
        executionHistory: [...task.executionHistory, record],
      });
      await this.emit("MissionExecutionFailed", {
        taskId,
        attempt,
        provider: failure.provider,
        reason: failure.reason,
        retryable,
      }, lineageId, record.executionId);

      if (!retryable) {
        return { outcome: "FAILED", task: updated, attempts: attemptsThisRun, lineageId, result: failure, reason: failure.reason };
      }

      updated = await this.missionQueue.requeue(taskId);
      task = updated;
    }

    const finalTask = taskOrThrow(this.missionQueue, taskId);
    return {
      outcome: finalTask.status === "Completed" ? "COMPLETED" : "FAILED",
      task: finalTask,
      attempts: attemptsThisRun,
      lineageId: finalTask.lineageId ?? "unassigned",
      reason: finalTask.lastFailureReason ?? undefined,
    };
  }

  private async emit<T extends OrchestrationEventType>(
    type: T,
    payload: OrchestrationEventMap[T],
    lineageId: string,
    eventId: string,
  ): Promise<void> {
    await this.options.orchestrator.dispatch(type, payload, { lineageId, eventId });
  }
}