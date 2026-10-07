import { intakeRequiresReview } from "../services/scout/intake";
import { calculateOpportunityScore } from "../services/scoring/opportunity-score";
import { generateAudit } from "../services/audit/generate-audit";
import { createMissionFromAuditRecommendation } from "../services/mission-adapters";
import type { BusinessIntelligence } from "../services/evidence/business-intelligence";
import type { EvidenceRecord } from "../services/evidence/evidence";
import { profitLoss } from "../services/finance/metrics";
import { createSnapshot } from "../services/finance/snapshot";
import type { HandlerRegistry, RegisteredHandlerResult } from "./handler-registry";
import type { OrchestrationConfig } from "./orchestration-types";
import { acquireEvidence } from "../services/evidence/acquisition";
import { applyScoringGate, buildAuditInput, buildOpportunityInput, buildProvenanceEvidence, sourceAllowed, type PipelineDeps } from "./atlas-pipeline";

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
export function registerRealHandlers(registry: HandlerRegistry, config: OrchestrationConfig, pipeline?: PipelineDeps): void {
  registry.register("BusinessDiscovered", async (event) => {
    const needsReview = intakeRequiresReview(event.payload);
    const result: RegisteredHandlerResult = { output: { needsReview } };
    if (pipeline) {
      // Pipeline mode: record only the evidence the discovery record really contains, then hand the
      // honest component set to the Evidence stage. Human review and re-discovery both stop here.
      const { store } = pipeline;
      const business = event.payload.discoveredBusiness as BusinessIntelligence;
      const base = { stage: "intake" as const, event: "BusinessDiscovered", businessId: event.payload.businessId, handler: "intake" };
      if (!sourceAllowed(pipeline, business)) {
        store.record({ ...base, state: "skipped: source not enabled for the pipeline" });
        return { output: { needsReview, pipeline: "skipped-source" } };
      }
      store.businesses.set(business.id, business);
      if (needsReview) {
        store.record({ ...base, state: "held for human duplicate review" });
        return { output: { needsReview, pipeline: "held-for-review" } };
      }
      if (store.started.has(business.id)) {
        store.record({ ...base, state: "already in pipeline; no new audit or mission" });
        return { output: { needsReview, pipeline: "already-started" } };
      }
      store.started.add(business.id);
      const evidence = buildProvenanceEvidence(business);
      store.evidence.set(business.id, evidence);
      let observations: EvidenceRecord[] = [];
      const multimodalObservations = [...(store.multimodalObservations.get(business.id) ?? [])];
      if (pipeline.collectors?.length) {
        // Real evidence acquisition. Collectors never throw; a failed source is a trace entry, never evidence.
        const acquired = await acquireEvidence(business, pipeline.collectors);
        observations = acquired.records;
        store.observations.set(business.id, observations);
        for (const outcome of acquired.outcomes) {
          store.record({ stage: "evidence", event: "BusinessDiscovered", businessId: business.id, handler: `collector:${outcome.source}`, state: `${outcome.status}, ${outcome.records.length} record(s)${outcome.failure ? ` [${outcome.failure.code}]` : ""}`, ...(outcome.status === "FAILED" && outcome.failure ? { error: outcome.failure.message } : {}) });
          if (pipeline.multimodalIntelligence && outcome.media?.length) {
            let imageCount = 0;
            for (const media of outcome.media) {
              const result = await pipeline.multimodalIntelligence.analyze({ businessId: business.id, ...media });
              if (result.status === "ANALYZED") {
                imageCount++;
                multimodalObservations.push(...result.observations);
              }
            }
            store.record({ stage: "evidence", event: "BusinessDiscovered", businessId: business.id, handler: "multimodal-intelligence", state: `${imageCount} image(s) analyzed; ${multimodalObservations.length} unverified observation(s)` });
          }
        }
      }
      if (multimodalObservations.length) store.multimodalObservations.set(business.id, multimodalObservations);
      store.record({ ...base, state: `${evidence.length} provenance + ${observations.length} observed evidence items recorded`, nextEvent: "EvidenceUpdated" });
      return {
        output: { needsReview, pipeline: "started", evidenceItems: evidence.length },
        nextEvent: { type: "EvidenceUpdated", payload: { businessId: business.id, opportunityInput: buildOpportunityInput(business, evidence, observations) } },
      };
    }
    // No further chaining: qualifying a business still requires real
    // evidence collection (a Scout/human action), which this handler has
    // no data for. Fabricating an EvidenceUpdated payload here is exactly
    // what "never fabricate data" forbids.
    return result;
  });

  registry.register("EvidenceUpdated", async (event) => {
    const score = calculateOpportunityScore(event.payload.opportunityInput);
    if (pipeline) {
      const { store } = pipeline;
      const business = store.businesses.get(event.payload.businessId);
      if (!business) {
        store.record({ stage: "score", event: "EvidenceUpdated", businessId: event.payload.businessId, handler: "opportunity-score", state: "stopped", error: "business is not in the pipeline store" });
        return { output: score, confidence: score.confidence.numeric };
      }
      const outcome = applyScoringGate(score);
      store.scores.set(business.id, outcome.score);
      store.record({
        stage: "score", event: "EvidenceUpdated", businessId: business.id, handler: "opportunity-score", nextEvent: "ScoreCalculated",
        state: outcome.scorable ? `score ${outcome.score.overallScore}` : `score withheld (${outcome.observedWeight}% observable)`,
      });
      return {
        output: outcome.score,
        // The handler's confidence is in its own determination. "Evidence is insufficient, so the score is
        // withheld" is certain; the score's low evidence confidence stays visible inside the output.
        confidence: outcome.scorable ? outcome.score.confidence.numeric : 1,
        nextEvent: { type: "ScoreCalculated", payload: { businessId: business.id, opportunityScore: outcome.score, auditInput: buildAuditInput(business, store.evidence.get(business.id) ?? [], outcome, store.observations.get(business.id) ?? [], store.multimodalObservations.get(business.id) ?? []) } },
      };
    }
    // Cannot honestly chain to ScoreCalculated: that event also requires a
    // Visibility Score and competitor data this handler was never given.
    return { output: score, confidence: score.confidence.numeric };
  });

  registry.register("ScoreCalculated", async (event) => {
    const result = generateAudit(event.payload.auditInput);
    pipeline?.store.audits.set(event.payload.businessId, result.audit);
    pipeline?.store.record({
      stage: "audit", event: "ScoreCalculated", businessId: event.payload.businessId, handler: "audit-generator",
      state: `audit ${result.audit.auditId} (${result.audit.status}), next action ${result.nextAction?.missionType ?? result.nextAction?.actionType ?? "none"}`,
      nextEvent: "AuditGenerated",
    });
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
      const task = await createMissionFromAuditRecommendation(event.payload.businessId, recommendation, pipeline?.missionQueue);
      createdTasks.push(task);
    }
    const first = createdTasks[0];
    pipeline?.store.record({
      stage: "mission", event: "AuditGenerated", businessId: event.payload.businessId, handler: "mission-creator",
      state: `${createdTasks.length} mission(s) queued: ${createdTasks.map((t) => `${t.taskId} [${t.approvalRequired}]`).join(", ") || "none"}`,
      nextEvent: first ? "MissionCreated" : undefined,
    });
    // Only the first task rides the chained MissionCreated event; every additional task gets its own event so
    // each one reaches the mission runner (and its approval/allowlist checks) exactly once.
    for (const extra of createdTasks.slice(1)) await pipeline?.emit?.("MissionCreated", { businessId: event.payload.businessId, taskId: extra.taskId });
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
  registry.register("MissionCreated", async (event) => {
    const task = pipeline?.missionQueue.getSnapshot().find((t) => t.taskId === event.payload.taskId);
    if (pipeline?.onMissionCreated && task) await pipeline.onMissionCreated(task);
    return { output: { acknowledged: true } };
  });

  registry.register("MissionExecutionStarted", async (event) => {
    return { output: { acknowledged: true, taskId: event.payload.taskId, attempt: event.payload.attempt } };
  });

  registry.register("MissionExecutionSucceeded", async (event) => {
    return { output: { acknowledged: true, taskId: event.payload.taskId, attempt: event.payload.attempt } };
  });

  registry.register("MissionExecutionFailed", async (event) => {
    return { output: { acknowledged: true, taskId: event.payload.taskId, attempt: event.payload.attempt, retryable: event.payload.retryable } };
  });

  registry.register("MissionExecutionBlocked", async (event) => {
    return { output: { acknowledged: true, taskId: event.payload.taskId, attempt: event.payload.attempt, requeued: event.payload.requeued } };
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
