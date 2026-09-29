import type { ScoutWorkflowState } from "../services/scout/workflow";
import type { ScoutIntake } from "../services/scout/intake";
import type { OpportunityInput } from "../services/scoring/opportunity-score";
import type { OpportunityScore } from "../services/scoring/opportunity-types";
import type { AuditGeneratorInput } from "../services/audit/audit-inputs";
import type { AuditRecommendation, AuditQuickWin } from "../services/audit/audit-types";
import type { FinancialTransaction, FinancialSnapshot } from "../services/finance/finance-types";
import type { ReportPeriod } from "../services/finance/metrics";
import type { TaskPriority } from "../services/mission-queue";
import type { ApprovalLevel } from "../services/mission-queue";

/**
 * Sprint 5A/5B — Atlas Orchestrator types.
 *
 * Event payloads carry the *real* input each downstream service actually
 * needs (ScoutIntake, OpportunityInput, AuditGeneratorInput, ...) rather
 * than a bare id the orchestrator would have to reconstruct data around.
 * This is deliberate: an orchestrator that fabricated Business/Evidence/
 * Score inputs from a thin event would violate "never fabricate data" —
 * see DECISION_LOG.md, 2026-09-19.
 */

// ---------- Events ----------

export type OrchestrationEventType =
  | "BusinessDiscovered"
  | "EvidenceUpdated"
  | "ScoreCalculated"
  | "AuditGenerated"
  | "MissionCreated"
  | "MissionExecutionStarted"
  | "MissionExecutionSucceeded"
  | "MissionExecutionFailed"
  | "MissionExecutionBlocked"
  | "MissionCompleted"
  | "PaymentRecorded"
  | "WorkflowBlocked";

export interface OrchestrationEventMap {
  BusinessDiscovered: ScoutIntake & { businessId: string };
  EvidenceUpdated: { businessId: string; opportunityInput: OpportunityInput };
  ScoreCalculated: { businessId: string; opportunityScore: OpportunityScore; auditInput: AuditGeneratorInput };
  AuditGenerated: { businessId: string; auditId: string; recommendations: AuditRecommendation[]; quickWins: AuditQuickWin[] };
  MissionCreated: { businessId: string; taskId: string };
  MissionExecutionStarted: { taskId: string; attempt: number; workerRole: WorkerRole; assignedAI: string };
  MissionExecutionSucceeded: { taskId: string; attempt: number; provider: string; model: string; estimatedCostUsd: number };
  MissionExecutionFailed: { taskId: string; attempt: number; provider: string; reason: string; retryable: boolean };
  MissionExecutionBlocked: { taskId: string; attempt: number; reason: string; requeued: true };
  MissionCompleted: { businessId: string; taskId: string; transactions: FinancialTransaction[]; period: ReportPeriod };
  PaymentRecorded: { transactionId: string; snapshotInput: Omit<FinancialSnapshot, "snapshotId">; productId?: string };
  WorkflowBlocked: { businessId: string; fromState: ScoutWorkflowState; attemptedState: ScoutWorkflowState; reason: string };
}

export type OrchestrationEvent<T extends OrchestrationEventType = OrchestrationEventType> = {
  type: T;
  payload: OrchestrationEventMap[T];
  /** Caller-supplied idempotency key. Falls back to a deterministic hash of type+payload if omitted — see idempotency.ts. */
  eventId: string;
  lineageId: string;
  emittedAt: string;
};

export type EventHandler<T extends OrchestrationEventType = OrchestrationEventType> = (
  event: OrchestrationEvent<T>,
) => void | Promise<void>;

// ---------- Workforce ----------

/**
 * Task-execution roles for the orchestrator's worker abstraction. Distinct
 * from the Atlas AI Employee hierarchy (AgentId: scout/builder/operator/
 * closer/finance in src/agents/index.ts) — that hierarchy answers "which
 * Atlas employee owns this work"; WorkerRole answers "which kind of model
 * call does this specific step need." See workforce-manager.ts for the
 * mapping between the two, so this is a composition, not a duplicate
 * employee system.
 */
export type WorkerRole = "planner" | "researcher" | "reviewer" | "analyst" | "finance" | "writer";

export type ProviderId = "openrouter" | "nvidia" | (string & {});

export interface ProviderConfig {
  providerId: ProviderId;
  costTier: "cheap" | "standard" | "premium";
  confidenceThreshold: number; // 0..1 — below this, escalate
  /**
   * Sprint 5D fix for the confidence/acceptance mismatch (DECISION_LOG.md,
   * 2026-09-20, 5C-04): real chat-completion providers honestly report
   * "unknown" confidence rather than a fabricated number. When true, a
   * structurally successful run with unknown confidence is accepted
   * without ever comparing against confidenceThreshold — this is a
   * distinct, logged acceptance path, not a bypassed or lowered threshold.
   * Defaults to false so existing confidence-scored providers (or tests)
   * keep requiring a real threshold match.
   */
  acceptUnknownConfidenceOnSuccess?: boolean;
}

export interface WorkforceAssignment {
  role: WorkerRole;
  provider: ProviderConfig;
  attempt: number;
  escalated: boolean;
}

// ---------- Retry ----------

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  backoffFactor: number;
}

export interface RetryOutcome {
  attempt: number;
  delayMs: number;
  exhausted: boolean;
}

// ---------- Execution log ----------

export interface ExecutionLogEntry {
  eventId: string;
  lineageId: string;
  timestamp: string;
  event: OrchestrationEventType;
  worker: WorkerRole | null;
  serviceInvoked: string;
  outcome: "SUCCESS" | "FAILURE" | "BLOCKED" | "RETRIED" | "DEAD_LETTERED" | "DUPLICATE" | "INVALID_PAYLOAD" | "DISABLED";
  retryCount: number;
  /** Wall-clock ms for the handler call, measured with performance.now() — never a fabricated or estimated value. Omitted (not zero) when the handler never ran. */
  durationMs: number | null;
}

// ---------- Task priority ----------

export interface TaskPriorityInput {
  opportunityScore: number | null;
  commercialValue: number | null;
  missionUrgency: TaskPriority;
  dueDate: string | null;
  now?: string;
}

// ---------- Approval ----------

export interface ApprovalCheck {
  level: ApprovalLevel;
  allowed: boolean;
  reason: string;
}

// ---------- Config ----------

export interface FeatureFlags {
  enableAuditAutoMission: boolean;
  enableFinanceEscalation: boolean;
  /** When true, event chaining may include TradeSpark-tagged finance events. Default false — TradeSpark stays isolated unless explicitly enabled, per ATLAS.md. */
  includeTradeSparkInAutoChain: boolean;
}

export interface EscalationPolicy {
  attemptsBeforeEscalation: number;
}

export interface IdempotencyPolicy {
  ttlMs: number;
}

export interface OrchestrationConfig {
  providers: Record<WorkerRole, ProviderConfig[]>; // ordered cheapest -> most capable
  retryPolicy: RetryPolicy;
  escalationPolicy: EscalationPolicy;
  featureFlags: FeatureFlags;
  idempotencyPolicy: IdempotencyPolicy;
  /** Per-event-type kill switch. A disabled handler is never invoked, and is logged as DISABLED, not silently skipped. */
  handlerEnabled: Record<OrchestrationEventType, boolean>;
}
