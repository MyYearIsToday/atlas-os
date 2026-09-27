import { intakeRequiresReview } from "../services/scout/intake";
import { calculateOpportunityScore } from "../services/scoring/opportunity-score";
import { generateAudit } from "../services/audit/generate-audit";
import { createMissionFromAuditRecommendation } from "../services/mission-adapters";
import { profitLoss } from "../services/finance/metrics";
import { createSnapshot } from "../services/finance/snapshot";
import type { HandlerRegistry, RegisteredHandlerResult } from "./handler-registry";
import type { OrchestrationConfig } from "./orchestration-types";

/**
 * Sprint 5B — real handlers. Each function here calls an existing Atlas
 * service directly; none recreate or re-implement business logic. Where a
 * handler can honestly construct the next event's payload from its own
 * real output (no invented fields), it returns `nextEvent` so the
 * orchestrator can auto-chain. Where the next step needs data this handler
 * has no way to know (e.g. EvidenceUpdated's Opportunity Score result
 * cannot honestly become a ScoreCalculated event, because that needs a
 * Visibility Score and competitor data this handler was never given), the
 * chain stops here — auto-chaining a fabricated payload would violate
 * "never fabricate data," so it is not attempted. See DECISION_LOG.md,
 * 2026-09-19.
 */
export function registerRealHandlers(registry: HandlerRegistry, config: OrchestrationConfig): void {
  registry.register("BusinessDiscovered", async (event) => {
    const needsReview = intakeRequiresReview(event.payload);
    const result: RegisteredHandlerResult = { output: { needsReview } };
    // No further chaining: qualifying a business still requires real
    // evidence collection (a Scout/human action), which this handler has
    // no data for. Fabricating an EvidenceUpdated payload here is exactly
    // what "never fabricate data" forbids.
    return result;
  });

  registry.register("EvidenceUpdated", async (event) => {
    const score = calculateOpportunityScore(event.payload.opportunityInput);
    // Cannot honestly chain to ScoreCalculated: that event also requires a
    // Visibility Score and competitor data this handler was never given.
    return { output: score, confidence: score.confidence.numeric };
  });

  registry.register("ScoreCalculated", async (event) => {
    const result = generateAudit(event.payload.auditInput);
    return {
      output: result,
      nextEvent: {
        type: "AuditGenerated",
        payload: {
          businessId: event.payload.businessId,
          auditId: result.audit.auditId,
          recommendations: event.payload.auditInput.recommendations,
          quickWins: event.payload.auditInput.quickWins,
        },
      },
    };
  });

  registry.register("AuditGenerated", async (event) => {
    if (!config.featureFlags.enableAuditAutoMission) {
      return { output: { missionsCreated: 0, skipped: "enableAuditAutoMission is false" } };
    }
    const createdTasks = [];
    for (const recommendation of event.payload.recommendations) {
      const task = await createMissionFromAuditRecommendation(event.payload.businessId, recommendation);
      createdTasks.push(task);
    }
    const first = createdTasks[0];
    return {
      output: { missionsCreated: createdTasks.length, taskIds: createdTasks.map((t) => t.taskId) },
      nextEvent: first ? { type: "MissionCreated", payload: { businessId: event.payload.businessId, taskId: first.taskId } } : undefined,
    };
  });

  // MissionCreated has no downstream service call of its own in Sprint 5B's
  // required mappings — it is the real, honest notification that mission
  // creation above already completed. Registering a handler (rather than
  // leaving it unregistered) means it is logged as an intentional
  // acknowledgment, not a missing-handler failure.
  registry.register("MissionCreated", async () => {
    return { output: { acknowledged: true } };
  });

  registry.register("MissionCompleted", async (event) => {
    const report = profitLoss(event.payload.transactions, event.payload.period, {
      includeTradeSpark: config.featureFlags.includeTradeSparkInAutoChain,
    });
    return { output: report };
  });

  registry.register("PaymentRecorded", async (event) => {
    const snapshot = createSnapshot(event.payload.snapshotInput);
    return { output: snapshot };
  });

  registry.register("WorkflowBlocked", async (event) => {
    // Deliberately no service call: a blocked transition is already fully
    // described by the event itself (fromState/attemptedState/reason).
    // Acknowledging it here keeps it out of the missing-handler path
    // without inventing a "recovery service" that doesn't exist.
    return { output: { acknowledged: true, reason: event.payload.reason } };
  });
}
