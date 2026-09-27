import type { BusinessIntelligence } from "./business-intelligence";

export interface DuplicateAssessment { status: "NO_MATCH" | "POSSIBLE_DUPLICATE" | "LIKELY_DUPLICATE"; score: number; reasons: string[]; humanReviewRequired: boolean; }
const normalize = (v?: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function assessDuplicate(a: BusinessIntelligence, b: BusinessIntelligence): DuplicateAssessment {
  const reasons: string[] = []; let score = 0;
  if (a.phone && b.phone && normalize(a.phone) === normalize(b.phone)) { score += 45; reasons.push("phone_match"); }
  if (a.website && b.website && normalize(a.website) === normalize(b.website)) { score += 35; reasons.push("website_match"); }
  if (normalize(a.canonicalName) === normalize(b.canonicalName)) { score += 20; reasons.push("name_match"); }
  if (a.latitude !== undefined && b.latitude !== undefined && a.longitude !== undefined && b.longitude !== undefined) {
    const distance = Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude);
    if (distance < 0.001) { score += 15; reasons.push("nearby_coordinates"); }
  }
  const status = score >= 70 ? "LIKELY_DUPLICATE" : score >= 35 ? "POSSIBLE_DUPLICATE" : "NO_MATCH";
  return { status, score, reasons, humanReviewRequired: status !== "NO_MATCH" };
}
