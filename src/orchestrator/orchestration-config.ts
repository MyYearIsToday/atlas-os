import type { OrchestrationConfig } from "./orchestration-types";

/**
 * Default Sprint 5A orchestration configuration.
 *
 * No API keys, tokens, or secrets belong here — provider identity only.
 * Actual credentials (if a provider is ever connected for real execution)
 * are an environment/secrets-manager concern, never a config literal.
 * Per ATLAS.md § Research Standards and Sprint 4A precedent, no provider
 * here makes a real external call yet — see workforce-manager.ts.
 */
export const defaultOrchestrationConfig: OrchestrationConfig = {
  providers: {
    planner: [
      { providerId: "openrouter", costTier: "cheap", confidenceThreshold: 0.6, acceptUnknownConfidenceOnSuccess: true },
      { providerId: "nvidia", costTier: "standard", confidenceThreshold: 0.75, acceptUnknownConfidenceOnSuccess: true },
    ],
    researcher: [
      { providerId: "openrouter", costTier: "cheap", confidenceThreshold: 0.55, acceptUnknownConfidenceOnSuccess: true },
      { providerId: "nvidia", costTier: "standard", confidenceThreshold: 0.7, acceptUnknownConfidenceOnSuccess: true },
    ],
    reviewer: [
      { providerId: "nvidia", costTier: "standard", confidenceThreshold: 0.7, acceptUnknownConfidenceOnSuccess: true },
      { providerId: "openrouter", costTier: "premium", confidenceThreshold: 0.85, acceptUnknownConfidenceOnSuccess: true },
    ],
    analyst: [
      { providerId: "openrouter", costTier: "cheap", confidenceThreshold: 0.6, acceptUnknownConfidenceOnSuccess: true },
      { providerId: "nvidia", costTier: "standard", confidenceThreshold: 0.75, acceptUnknownConfidenceOnSuccess: true },
    ],
    finance: [
      { providerId: "openrouter", costTier: "cheap", confidenceThreshold: 0.9 },
    ],
    writer: [
      { providerId: "openrouter", costTier: "cheap", confidenceThreshold: 0.6, acceptUnknownConfidenceOnSuccess: true },
      { providerId: "nvidia", costTier: "standard", confidenceThreshold: 0.75, acceptUnknownConfidenceOnSuccess: true },
    ],
  },
  retryPolicy: {
    maxRetries: 3,
    baseDelayMs: 500,
    backoffFactor: 2,
  },
  escalationPolicy: {
    // "Cheap worker first. Retry once. Escalate only when confidence
    // threshold fails" — one retry on the same tier before escalating.
    attemptsBeforeEscalation: 2,
  },
  featureFlags: {
    enableAuditAutoMission: true,
    enableFinanceEscalation: false,
    includeTradeSparkInAutoChain: false,
  },
  idempotencyPolicy: {
    // 24h: long enough to catch retried webhook-style duplicates, short
    // enough that the processed-event cache doesn't grow unbounded in a
    // long-running process.
    ttlMs: 24 * 60 * 60 * 1000,
  },
  handlerEnabled: {
    BusinessDiscovered: true,
    EvidenceUpdated: true,
    ScoreCalculated: true,
    AuditGenerated: true,
    MissionCreated: true,
    MissionExecutionStarted: true,
    MissionExecutionSucceeded: true,
    MissionExecutionFailed: true,
    MissionExecutionBlocked: true,
    MissionCompleted: true,
    PaymentRecorded: true,
    WorkflowBlocked: true,
  },
};
