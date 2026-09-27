import type { ConfidenceLevel } from "../services/evidence/evidence";

/**
 * Confidence-based escalation, as a pure decision function — no I/O, no
 * randomness. Default behavior: try the cheap tier, retry once on that
 * same tier, escalate only if the confidence target still isn't met, and
 * never escalate past `maxEscalationDepth`.
 */

const confidenceRank: Record<ConfidenceLevel, number> = { VERIFIED: 1, HIGH: 0.85, MEDIUM: 0.65, LOW: 0.4, UNKNOWN: 0 };

export interface EscalationState {
  tierIndex: number;
  attemptsOnTier: number;
  totalEscalations: number;
}

export type EscalationDecision =
  | { action: "ACCEPT" }
  | { action: "RETRY_SAME_TIER" }
  | { action: "ESCALATE"; nextTierIndex: number }
  | { action: "GIVE_UP"; reason: string };

export interface EscalationPolicyConfig {
  confidenceTarget: number; // 0..1
  attemptsBeforeEscalation: number;
  maxEscalationDepth: number;
}

export function decideEscalation(
  confidence: ConfidenceLevel,
  state: EscalationState,
  policy: EscalationPolicyConfig,
): EscalationDecision {
  const numericConfidence = confidenceRank[confidence];

  if (numericConfidence >= policy.confidenceTarget) {
    return { action: "ACCEPT" };
  }

  if (state.attemptsOnTier < policy.attemptsBeforeEscalation) {
    return { action: "RETRY_SAME_TIER" };
  }

  if (state.totalEscalations >= policy.maxEscalationDepth) {
    return { action: "GIVE_UP", reason: `Confidence target ${policy.confidenceTarget} not met after ${policy.maxEscalationDepth} escalations (last: ${confidence}).` };
  }

  return { action: "ESCALATE", nextTierIndex: state.tierIndex + 1 };
}
