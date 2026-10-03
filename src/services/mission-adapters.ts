import {
  type MissionQueueRepository,
  type Task,
  type TaskInput,
  type TaskPriority,
  type ApprovalLevel,
  localMissionQueueRepository,
} from "./mission-queue";
import type { AuditRecommendation, AuditQuickWin } from "./audit/audit-types";
import type { FinancialTransaction } from "./finance/finance-types";

/**
 * Real Mission Queue adapters for the Sprint 4C/4D/4E/4F/Finance patches.
 *
 * The uploaded patch bundles each shipped their own `MissionQueueAdapter` /
 * `ExistingMissionQueue` interface (in opportunity-score/integration,
 * audit/integration, and finance/integration respectively). All three were
 * disconnected generic interfaces that never referenced the real `Task`
 * type or `localMissionQueueRepository` — the same gap found and fixed in
 * Sprint 4A's mission adapter. This file is the actual integration; the
 * opportunity-score case was already fixed in Sprint 4A at
 * `evidence/mission-adapter.ts`'s `createScoutMissionForBusiness()`. This
 * file adds the audit and finance cases. See DECISION_LOG.md, 2026-09-17.
 */

function approvalLevelFromString(value: string): ApprovalLevel {
  if (value === "CEO_ONLY") return "CEO Only";
  if (value === "AUTO" || value === "NONE" || value === "NOT_REQUIRED") return "Auto";
  return "Approval Required";
}

function priorityFromEffort(effort: string): TaskPriority {
  if (effort === "high") return "High";
  if (effort === "medium") return "Medium";
  return "Low";
}

/** Turns an audit recommendation into a real Scout/Builder mission task. */
export async function createMissionFromAuditRecommendation(
  businessId: string,
  recommendation: AuditRecommendation,
  repository: MissionQueueRepository = localMissionQueueRepository,
): Promise<Task> {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 5);

  const input: TaskInput = {
    title: `Audit follow-up — ${recommendation.action}`,
    description: `${recommendation.reason} (business ${businessId})`,
    assignedAI: "builder",
    clientId: businessId,
    priority: priorityFromEffort(recommendation.estimatedEffort),
    // Missing/unknown approval metadata is never permission, and evidence collection is never automatic.
    approvalRequired: recommendation.missionType === "collect_missing_evidence" ? "Approval Required" : approvalLevelFromString(recommendation.approvalLevel),
    ...(recommendation.missionType ? { missionType: recommendation.missionType } : {}),
    dueDate: dueDate.toISOString().slice(0, 10),
    estimatedCost: 0,
    estimatedTime: "45 min",
  };

  return repository.create(input);
}

/** Turns an audit quick win into a real, lightweight mission task. */
export async function createMissionFromQuickWin(
  businessId: string,
  quickWin: AuditQuickWin,
  repository: MissionQueueRepository = localMissionQueueRepository,
): Promise<Task> {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 2);

  const input: TaskInput = {
    title: `Quick win — ${quickWin.action}`,
    description: quickWin.reason,
    assignedAI: "builder",
    clientId: businessId,
    priority: "Medium",
    approvalRequired: quickWin.approvalRequired ? "Approval Required" : "Auto",
    dueDate: dueDate.toISOString().slice(0, 10),
    estimatedCost: 0,
    estimatedTime: "20 min",
  };

  return repository.create(input);
}

/**
 * Creates a Finance AI mission for a transaction that needs human review —
 * e.g. an expense entry or refund sitting at PENDING_APPROVAL. This does
 * not authorize the transaction itself (that stays in the Approval Engine /
 * ledger); it only surfaces it as trackable work in the Mission Queue.
 */
export async function createMissionForFinanceApproval(
  transaction: FinancialTransaction,
  repository: MissionQueueRepository = localMissionQueueRepository,
): Promise<Task> {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 1);

  const approvalRequired: ApprovalLevel =
    transaction.approvalStatus === "CEO_ONLY" ? "CEO Only" : "Approval Required";

  const input: TaskInput = {
    title: `Finance review — ${transaction.transactionType} (${transaction.category})`,
    description: transaction.description,
    assignedAI: "finance",
    clientId: transaction.clientId ?? null,
    priority: transaction.transactionType === "REFUND" ? "High" : "Medium",
    approvalRequired,
    dueDate: dueDate.toISOString().slice(0, 10),
    estimatedCost: 0,
    estimatedTime: "15 min",
  };

  return repository.create(input);
}
