import type { OpportunityScore } from "./opportunity-types";
import { OPPORTUNITY_WEIGHTS } from "./opportunity-weights";

export function validateOpportunityScore(score: OpportunityScore): string[] {
  const errors: string[] = [];
  if (score.overallScore !== null && (score.overallScore < 0 || score.overallScore > 100)) {
    errors.push("overall score out of range");
  }
  if (score.evidenceCoverage < 0 || score.evidenceCoverage > 100) errors.push("evidence coverage out of range");
  if (score.confidence.competitorCoverage < 0 || score.confidence.competitorCoverage > 100) {
    errors.push("competitor coverage out of range");
  }
  const total = score.components.reduce((n, c) => n + c.weight, 0);
  if (total > 100) errors.push("component weights exceed 100");
  const seen = new Set<string>();
  for (const c of score.components) {
    if (seen.has(c.key)) errors.push(`duplicate component: ${c.key}`);
    seen.add(c.key);
    if (!(c.key in OPPORTUNITY_WEIGHTS)) errors.push(`unknown component: ${c.key}`);
    if (!Number.isFinite(c.weight) || c.weight < 0) errors.push(`${c.key} weight is invalid`);
    if (!Number.isFinite(c.maxValue) || c.maxValue <= 0) errors.push(`${c.key} max value is invalid`);
    if (c.normalizedValue !== null && (c.normalizedValue < 0 || c.normalizedValue > 1)) {
      errors.push(`${c.key} normalized value out of range`);
    }
    if (c.rawValue !== null && !Number.isFinite(c.rawValue)) errors.push(`${c.key} raw value is invalid`);
    if (c.weightedContribution !== null && c.normalizedValue !== null && Math.abs(c.weightedContribution - c.normalizedValue * c.weight) > 0.0001) {
      errors.push(`${c.key} contribution mismatch`);
    }
  }
  return errors;
}
