import type { DiscoveryCandidate } from "../evidence/provider-interfaces";
import type { BusinessIntelligence } from "../evidence/business-intelligence";

let counter = 0;

/** Deterministic, injectable id generator. */
export function nextCandidateId(now: () => string = () => new Date().toISOString()): string {
  counter += 1;
  return `biz-${now().replace(/[^0-9]/g, "")}-${counter}`;
}

/** Pure: raw provider output -> canonical BusinessIntelligence shape. */
export function normalizeCandidate(candidate: DiscoveryCandidate, id: string, nowIso: string): BusinessIntelligence {
  return {
    id,
    canonicalName: candidate.name.trim(),
    aliases: [],
    category: candidate.category,
    categories: candidate.category ? [candidate.category] : [],
    status: "UNKNOWN",
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    socialLinks: [],
    services: [],
    products: [],
    sourceReferences: [candidate.source],
    evidenceReferences: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** Merge a rediscovered candidate without erasing previously-known fields. */
export function mergeIntoExisting(existing: BusinessIntelligence, candidate: DiscoveryCandidate, nowIso: string): BusinessIntelligence {
  return {
    ...existing,
    category: existing.category ?? candidate.category,
    categories: existing.categories.length ? existing.categories : candidate.category ? [candidate.category] : [],
    address: existing.address ?? candidate.address,
    latitude: existing.latitude ?? candidate.latitude,
    longitude: existing.longitude ?? candidate.longitude,
    sourceReferences: existing.sourceReferences.includes(candidate.source)
      ? existing.sourceReferences
      : [...existing.sourceReferences, candidate.source],
    updatedAt: nowIso,
  };
}