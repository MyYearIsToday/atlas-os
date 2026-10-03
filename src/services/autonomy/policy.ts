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
};
