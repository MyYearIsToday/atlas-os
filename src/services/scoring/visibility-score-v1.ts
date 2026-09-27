import type { ConfidenceLevel, ObservabilityState } from "../evidence/evidence";

/**
 * Sprint 4B — Visibility Score v1.0, evidence-based engine.
 *
 * This is deliberately a NEW, additional engine, not a replacement of the
 * existing `src/services/visibility-score.ts` (which the Dashboard and
 * Clients pages already render against with a different six-input model).
 * Per Sprint 4B's own instruction — "do not create a second visibility
 * engine" refers to not duplicating *this* engine once it exists; the
 * reconciliation between this evidence-based v1.0 model and the legacy
 * UI-facing calculation is a deliberately deferred decision. See
 * docs/specs/SPEC-004-MapSpark.md § Reconciliation with the Implemented
 * Engine, and DECISION_LOG.md, 2026-09-17.
 *
 * No component here is Google-confirmed. Weights are MapSpark's own
 * methodology (SPEC-004-MapSpark.md § Visibility Score Methodology).
 */

export const VISIBILITY_SCORE_VERSION = "visibility-v1.0" as const;

export const VISIBILITY_WEIGHTS = {
  profileCompleteness: 15,
  categoryRelevance: 15,
  reviews: 15,
  reviewResponses: 8,
  servicesProductsAttributes: 10,
  photosVisualTrust: 10,
  websiteConversion: 10,
  recentActivity: 5,
  localTrustSignals: 7,
  measurementReadiness: 5,
} as const;

const VISIBILITY_MAX = Object.values(VISIBILITY_WEIGHTS).reduce((a, b) => a + b, 0);
if (VISIBILITY_MAX !== 100) throw new Error("Visibility weights must total 100");

export type VisibilityComponentKey = keyof typeof VISIBILITY_WEIGHTS;

export interface VisibilityScoreComponent {
  key: VisibilityComponentKey;
  rawValue: number | null;
  normalizedValue: number | null; // 0..1
  weight: number;
  weightedContribution: number | null;
  evidenceRefs: string[];
  confidence: ConfidenceLevel;
  observability: ObservabilityState;
  explanation: string;
}

export interface VisibilityScoreConfidence {
  overall: ConfidenceLevel;
  numeric: number;
  evidenceCoverage: number;
  explanation: string;
}

export interface VisibilityScore {
  id: string;
  version: typeof VISIBILITY_SCORE_VERSION;
  businessId: string;
  overallScore: number | null;
  components: VisibilityScoreComponent[];
  confidence: VisibilityScoreConfidence;
  evidenceCoverage: number;
  evidenceRefs: string[];
  generatedAt: string;
  limitations: string[];
}

export interface VisibilityScoreInput {
  businessId: string;
  components: Array<Omit<VisibilityScoreComponent, "weightedContribution">>;
  generatedAt?: string;
}

const confidenceRank: Record<ConfidenceLevel, number> = { VERIFIED: 1, HIGH: 0.85, MEDIUM: 0.65, LOW: 0.4, UNKNOWN: 0 };

/**
 * Deterministic — given the same components, always produces the same
 * score. AI may supply component *evidence*, but this function is the only
 * thing that calculates the number (see ATLAS.md § Financial Principles /
 * Research Standards: "AI must never calculate the final score").
 */
export function calculateVisibilityScoreV1(input: VisibilityScoreInput): VisibilityScore {
  const components: VisibilityScoreComponent[] = input.components.map((c) => ({
    ...c,
    weightedContribution: c.normalizedValue === null ? null : c.normalizedValue * c.weight,
  }));

  const usable = components.filter(
    (c) => c.normalizedValue !== null && c.observability !== "NOT_OBSERVABLE" && c.observability !== "CONFLICTING",
  );
  const usableWeight = usable.reduce((sum, c) => sum + c.weight, 0);
  const overallScore = usableWeight > 0
    ? Math.round((usable.reduce((sum, c) => sum + (c.weightedContribution ?? 0), 0) / usableWeight) * VISIBILITY_MAX)
    : null;

  const evidenceCoverage = components.length
    ? Math.round((usable.length / components.length) * 100)
    : 0;

  const avgConfidence = usable.length
    ? usable.reduce((sum, c) => sum + confidenceRank[c.confidence], 0) / usable.length
    : 0;
  const overallConfidence: ConfidenceLevel =
    avgConfidence >= 0.85 ? "VERIFIED" : avgConfidence >= 0.65 ? "HIGH" : avgConfidence >= 0.4 ? "MEDIUM" : avgConfidence > 0 ? "LOW" : "UNKNOWN";

  const evidenceRefs = [...new Set(components.flatMap((c) => c.evidenceRefs))];
  const limitations: string[] = [];
  if (usableWeight < VISIBILITY_MAX) {
    limitations.push(`${VISIBILITY_MAX - usableWeight} of ${VISIBILITY_MAX} weighted points could not be scored (missing or conflicting evidence) and were excluded rather than assumed.`);
  }

  return {
    id: crypto.randomUUID(),
    version: VISIBILITY_SCORE_VERSION,
    businessId: input.businessId,
    overallScore,
    components,
    confidence: {
      overall: overallConfidence,
      numeric: avgConfidence,
      evidenceCoverage,
      explanation: "Confidence describes evidence reliability and completeness, not a statistical probability, and is not Google's assessment of this business.",
    },
    evidenceCoverage,
    evidenceRefs,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    limitations,
  };
}

export function visibilityBand(score: number): string {
  if (score >= 80) return "Strong operational foundation";
  if (score >= 60) return "Reasonable foundation with competitive weaknesses";
  if (score >= 40) return "Basic presence with significant gaps";
  return "High risk / major missed opportunity";
}
