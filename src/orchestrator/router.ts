import type { OrchestrationEventType, WorkerRole } from "./orchestration-types";
import type { ApprovalLevel } from "../services/mission-queue";

/**
 * Router. A deterministic table only — it decides *which existing service*
 * should run next for a given event, and what worker role/approval tier
 * that step needs. It never calls a service directly and never bypasses
 * one; the orchestrator is what actually invokes the handler registered
 * for a route (see orchestrator.ts).
 */
export interface Route {
  event: OrchestrationEventType;
  /** Name only, for logging/lineage — the real function lives in src/services/. */
  serviceInvoked: string;
  workerRole: WorkerRole | null;
  approvalLevel: ApprovalLevel;
}

export const defaultRoutes: Record<OrchestrationEventType, Route> = {
  BusinessDiscovered: {
    event: "BusinessDiscovered",
    serviceInvoked: "services/scout/intake.ts#intakeRequiresReview",
    workerRole: "researcher",
    approvalLevel: "Auto",
  },
  EvidenceUpdated: {
    event: "EvidenceUpdated",
    serviceInvoked: "services/scoring/opportunity-score.ts#calculateOpportunityScore",
    workerRole: "analyst",
    approvalLevel: "Auto",
  },
  ScoreCalculated: {
    event: "ScoreCalculated",
    serviceInvoked: "services/audit/generate-audit.ts#generateAudit",
    workerRole: "analyst",
    approvalLevel: "Auto",
  },
  AuditGenerated: {
    event: "AuditGenerated",
    serviceInvoked: "services/mission-adapters.ts#createMissionFromAuditRecommendation",
    workerRole: "planner",
    approvalLevel: "Auto",
  },
  MissionCreated: {
    event: "MissionCreated",
    serviceInvoked: "services/mission-queue.ts#localMissionQueueRepository",
    workerRole: null,
    approvalLevel: "Auto",
  },
  MissionCompleted: {
    event: "MissionCompleted",
    serviceInvoked: "services/mission-queue.ts#localMissionQueueRepository.advance",
    workerRole: null,
    approvalLevel: "Auto",
  },
  PaymentRecorded: {
    event: "PaymentRecorded",
    serviceInvoked: "services/finance/metrics.ts#profitLoss",
    workerRole: "finance",
    approvalLevel: "Approval Required",
  },
  WorkflowBlocked: {
    event: "WorkflowBlocked",
    serviceInvoked: "orchestrator/execution-log.ts#record",
    workerRole: null,
    approvalLevel: "Auto",
  },
};

export function routeFor(event: OrchestrationEventType): Route {
  const route = defaultRoutes[event];
  if (!route) throw new Error(`No route configured for event "${event}"`);
  return route;
}
