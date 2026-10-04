/**
 * Every threshold the autonomy layer uses lives here, typed and named. Rules read the policy; nothing in
 * the controller or lifecycles hard-codes a limit. Changing a policy is a code change reviewed by a human:
 * Atlas has no code path that edits its own policy, budgets or approval requirements.
 */
export interface AutonomyPolicy {
  /** Evidence older than this is stale and should be re-collected. */
  evidenceMaxAgeMs: number;
  /** After a failed mission, the business is left alone for this long. */
  failureCooldownMs: number;
  /** A mission that has failed this many times needs a human. */
  maxRetries: number;
  /** Upper bound on missions (any kind) per business, to stop runaway work. */
  maxMissionsPerBusiness: number;
  /** Scores are health scores (higher = healthier). A business at or below this is an outreach target. */
  maxScoreForOutreach: number;
  /** How long to wait for a reply before a follow-up is proposed. */
  followUpAfterMs: number;
  maxFollowUps: number;
  /** Fewer active businesses than this triggers DISCOVER_MORE. */
  minActivePipeline: number;
  dailyAutonomousSpendLimitUsd: number;
  /** Estimated AI cost per decision type (USD); used for budget gating and traceability. */
  estimatedCostUsd: Partial<Record<string, number>>;
  /** Actionable decisions expire so a stale recommendation is never executed. */
  decisionTtlMs: number;
  /** Continuous-autonomy loop limits (Objective 8). */
  loop: LoopPolicy;
  /** Bounded, explicit metric influence on ordering (Objective 9). It can never touch limits, approvals or budgets. */
  metricPriority: MetricPriorityPolicy;
}

/** PROPOSED DEFAULTS (Objective 8): chosen by the roadmap decision, all centralized here and changed only by editing this file. */
export interface LoopPolicy {
  maxMissionsPerCycle: number;
  /** At most this many mission-creating actions per business in one cycle. */
  maxMissionsPerBusinessPerCycle: number;
  /** Hard stop on actions of any kind per cycle (PROPOSED default; the roadmap names only mission limits). */
  maxActionsPerCycle: number;
  maxSpendPerCycleUsd: number;
  maxSpendPerDayUsd: number;
  /** After a failed autonomous action the same decision is not retried for this long. */
  failureCooldownMs: number;
  circuitBreaker: { tripAfterConsecutiveFailures: number; openForMs: number };
  /** Decisions the loop may execute: internal evidence, scoring, audit and planning work only. */
  internalDecisionTypes: string[];
  /** Email/SMS/contact/send/payment/refund/customer acceptance: never executed by the loop; each needs its human boundary. */
  externalDecisionTypes: string[];
}

/** PROPOSED DEFAULTS (Objective 9). */
export interface MetricPriorityPolicy {
  /** Largest priority-tier shift a metric may cause (tiers are small integers; 1 = at most one tier). */
  maxBoost: number;
  /** Rules are ignored until a metric has at least this many observations. */
  minSample: number;
  lowEvidenceCompletion: number;
  goodProposalConversion: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const defaultAutonomyPolicy: AutonomyPolicy = {
  evidenceMaxAgeMs: 30 * DAY,
  failureCooldownMs: 6 * HOUR,
  maxRetries: 3,
  maxMissionsPerBusiness: 8,
  maxScoreForOutreach: 70,
  followUpAfterMs: 3 * DAY,
  maxFollowUps: 2,
  minActivePipeline: 10,
  dailyAutonomousSpendLimitUsd: 1,
  estimatedCostUsd: { CREATE_OUTREACH_MISSION: 0.02, GENERATE_AUDIT: 0, ANALYZE_OPPORTUNITY: 0, FOLLOW_UP: 0.02, PREPARE_DELIVERY: 0.05 },
  decisionTtlMs: DAY,
  loop: {
    maxMissionsPerCycle: 3,
    maxMissionsPerBusinessPerCycle: 1,
    maxActionsPerCycle: 10,
    maxSpendPerCycleUsd: 1,
    maxSpendPerDayUsd: 1,
    failureCooldownMs: 30 * 60 * 1000,
    circuitBreaker: { tripAfterConsecutiveFailures: 3, openForMs: 30 * 60 * 1000 },
    internalDecisionTypes: ["COLLECT_EVIDENCE", "ANALYZE_OPPORTUNITY", "GENERATE_AUDIT", "CREATE_OUTREACH_MISSION", "PREPARE_DELIVERY", "REQUEST_PAYMENT"],
    externalDecisionTypes: ["FOLLOW_UP", "DELIVER", "VERIFY_RESULT", "RECONCILE_REVENUE"],
  },
  metricPriority: { maxBoost: 1, minSample: 5, lowEvidenceCompletion: 0.5, goodProposalConversion: 0.2 },
};
// The default policy is immutable at runtime: nothing in Atlas (including metrics) can alter its own limits.
Object.freeze(defaultAutonomyPolicy);
Object.freeze(defaultAutonomyPolicy.loop);
Object.freeze(defaultAutonomyPolicy.loop.circuitBreaker);
Object.freeze(defaultAutonomyPolicy.loop.internalDecisionTypes);
Object.freeze(defaultAutonomyPolicy.loop.externalDecisionTypes);
Object.freeze(defaultAutonomyPolicy.metricPriority);
Object.freeze(defaultAutonomyPolicy.estimatedCostUsd);
