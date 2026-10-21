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
    phone: candidate.phone,
    website: candidate.website,
    notes: candidate.notes,
    socialLinks: [...new Set(candidate.socialLinks ?? [])],
    email: candidate.email,
    contactName: candidate.contactName,
    city: candidate.city,
    country: candidate.country,
    goals: candidate.goals?.length ? [...candidate.goals] : undefined,
    relationship: candidate.relationship,
    intakeSource: candidate.intakeSource,
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
    phone: existing.phone ?? candidate.phone,
    website: existing.website ?? candidate.website,
    // Never drop operator-supplied context: a second submission adds to, not replaces, what is on record.
    notes: !existing.notes ? candidate.notes : candidate.notes && !existing.notes.includes(candidate.notes) ? `${existing.notes}\n---\n${candidate.notes}` : existing.notes,
    socialLinks: [...new Set([...(existing.socialLinks ?? []), ...(candidate.socialLinks ?? [])])],
    email: existing.email ?? candidate.email,
    contactName: existing.contactName ?? candidate.contactName,
    city: existing.city ?? candidate.city,
    country: existing.country ?? candidate.country,
    goals: [...new Set([...(existing.goals ?? []), ...(candidate.goals ?? [])])].length ? [...new Set([...(existing.goals ?? []), ...(candidate.goals ?? [])])] : undefined,
    relationship: existing.relationship ?? candidate.relationship,
    intakeSource: existing.intakeSource ?? candidate.intakeSource,
    sourceReferences: existing.sourceReferences.includes(candidate.source)
      ? existing.sourceReferences
      : [...existing.sourceReferences, candidate.source],
    updatedAt: nowIso,
  };
}