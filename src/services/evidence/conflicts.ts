import type { EvidenceRecord, ObservabilityState } from "./evidence";

export function fieldState(records: EvidenceRecord[]): ObservabilityState {
  if (!records.length) return "NOT_OBSERVABLE";
  const values = new Set(records.filter(r => r.verificationStatus !== "REJECTED").map(r => JSON.stringify(r.value)));
  if (values.size > 1) return "CONFLICTING";
  const value = [...values][0];
  if (value === undefined || value === JSON.stringify(null) || value === JSON.stringify("")) return "OBSERVED_ABSENT";
  return "OBSERVED_PRESENT";
}

export function requiresHumanReview(records: EvidenceRecord[]): boolean {
  return fieldState(records) === "CONFLICTING" || records.some(r => r.humanReviewRequired);
}
