import type { EvidenceRecord } from "./evidence";

export type FreshnessState = "fresh" | "stale" | "expired" | "unknown";
export type FreshnessConfig = Record<string, number | undefined>;

/**
 * Default freshness windows in days, per evidence field. These are MapSpark
 * methodology defaults (HYPOTHESIS-classified, not Google-confirmed timing
 * rules) — see docs/specs/SPEC-004-MapSpark.md § Evidence Model. Fields not
 * listed here return "unknown" freshness rather than silently assuming a
 * default, per Sprint 4A's "do not invent arbitrary universal freshness
 * periods" instruction.
 */
export const defaultFreshnessConfig: FreshnessConfig = {
  phone: 180,
  whatsapp: 180,
  email: 180,
  website: 60,
  hours: 90,
  services: 120,
  photos: 60,
  reviews: 30,
  latitude: 365,
  longitude: 365,
  address: 365,
};

export function freshnessOf(evidence: EvidenceRecord, now = new Date(), config: FreshnessConfig = defaultFreshnessConfig): FreshnessState {
  if (!evidence.observedAt) return "unknown";
  const observed = new Date(evidence.observedAt);
  if (Number.isNaN(observed.getTime())) return "unknown";
  if (evidence.expiresAt) {
    const expiry = new Date(evidence.expiresAt);
    if (!Number.isNaN(expiry.getTime()) && now >= expiry) return "expired";
  }
  const days = config[evidence.field];
  if (days === undefined) return "unknown";
  const ageMs = now.getTime() - observed.getTime();
  return ageMs <= days * 86400000 ? "fresh" : "stale";
}
