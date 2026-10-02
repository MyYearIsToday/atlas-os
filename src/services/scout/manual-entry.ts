import type { BusinessDiscoveryProvider, DiscoveryCandidate, DiscoveryQuery } from "../evidence/provider-interfaces";
import { runScoutDiscovery, type CandidateOutcome, type DispatchBusinessDiscovered } from "./discovery-loop";
import type { BusinessRepository } from "./business-repository";

/**
 * Manual business entry. A human-supplied business is turned into the same
 * `DiscoveryCandidate` the automated providers emit and is run through the
 * unchanged `runScoutDiscovery` (normalize -> dedupe -> upsert -> BusinessDiscovered).
 * There is no second repository, normalizer, deduper, or event path here.
 */
export interface ManualBusinessInput {
  businessName: string;
  category: string;
  address: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  website?: string | null;
  phone?: string | null;
  source?: string | null;
  notes?: string | null;
}

export interface ManualEntryFieldError {
  field: keyof ManualBusinessInput;
  message: string;
}

export const MANUAL_SOURCE_ID = "manual";

const LIMITS = { businessName: 200, category: 100, address: 300, website: 300, phone: 30, source: 100, notes: 1000 } as const;

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const blank = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
// eslint-disable-next-line no-control-regex
const hasControlChars = (value: string) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function normalizeWebsite(raw: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type ManualValidationResult =
  | { valid: true; candidate: DiscoveryCandidate }
  | { valid: false; errors: ManualEntryFieldError[] };

/** Pure: validate raw form input and build the existing candidate shape. */
export function buildManualCandidate(input: ManualBusinessInput): ManualValidationResult {
  const errors: ManualEntryFieldError[] = [];
  const fail = (field: keyof ManualBusinessInput, message: string) => errors.push({ field, message });
  const source = (input ?? ({} as ManualBusinessInput));

  const name = clean(source.businessName);
  const category = clean(source.category);
  const address = clean(source.address);
  if (!name) fail("businessName", "Business name is required");
  if (!category) fail("category", "Category is required");
  if (!address) fail("address", "Address is required");

  for (const field of ["businessName", "category", "address", "website", "phone", "source", "notes"] as const) {
    const value = clean(source[field]);
    if (value.length > LIMITS[field]) fail(field, `Must be at most ${LIMITS[field]} characters`);
    else if (value && field !== "notes" && hasControlChars(value)) fail(field, "Contains invalid characters");
  }

  let latitude: number | undefined;
  let longitude: number | undefined;
  const hasLat = !blank(source.latitude);
  const hasLon = !blank(source.longitude);
  if (hasLat !== hasLon) {
    fail(hasLat ? "longitude" : "latitude", "Latitude and longitude must be provided together");
  } else if (hasLat && hasLon) {
    const lat = parseCoordinate(source.latitude, -90, 90);
    const lon = parseCoordinate(source.longitude, -180, 180);
    if (lat === null) fail("latitude", "Latitude must be a number between -90 and 90");
    if (lon === null) fail("longitude", "Longitude must be a number between -180 and 180");
    if (lat !== null && lon !== null) { latitude = lat; longitude = lon; }
  }

  let website: string | undefined;
  if (!blank(source.website)) {
    const normalized = normalizeWebsite(clean(source.website));
    if (!normalized) fail("website", "Website must be a valid http(s) URL"); else website = normalized;
  }

  let phone: string | undefined;
  if (!blank(source.phone)) {
    const raw = clean(source.phone);
    const digits = raw.replace(/\D/g, "");
    if (!/^[+\d][\d\s().-]*$/.test(raw) || digits.length < 7 || digits.length > 15) fail("phone", "Phone must contain 7-15 digits");
    else phone = raw;
  }

  if (errors.length) return { valid: false, errors };

  const sourceLabel = clean(source.source);
  const notes = clean(source.notes);
  // Stable identity so resubmitting the same name+address updates rather than duplicates; fuzzy
  // near-duplicates are still caught by the existing assessDuplicate path in the loop.
  const identity = (value: string) => value.toLowerCase().replace(/\s+/g, " ");
  return {
    valid: true,
    candidate: {
      externalId: `${identity(name)}|${identity(address)}`,
      name,
      category,
      address,
      latitude,
      longitude,
      phone,
      website,
      notes: notes || undefined,
      source: MANUAL_SOURCE_ID,
      sourceMetadata: { sourceId: MANUAL_SOURCE_ID, name: sourceLabel || "Manual entry" },
    },
  };
}

/** Feeds one already-validated candidate to the existing discovery loop. */
export class ManualEntryDiscoveryProvider implements BusinessDiscoveryProvider {
  constructor(private candidates: DiscoveryCandidate[]) {}
  async discover(_query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    return this.candidates;
  }
}

// The loop requires a query; a manual provider has no geographic search, so this is intentionally inert.
const INERT_QUERY: DiscoveryQuery = { latitude: 0, longitude: 0, radiusMeters: 0, categories: [] };

export interface ManualEntryDeps {
  repository: BusinessRepository;
  dispatch: DispatchBusinessDiscovered;
  now?: () => string;
}

export type ManualEntryResult =
  | { ok: true; outcome: CandidateOutcome }
  | { ok: false; errors: ManualEntryFieldError[] };

export async function submitManualBusiness(input: ManualBusinessInput, deps: ManualEntryDeps): Promise<ManualEntryResult> {
  const built = buildManualCandidate(input);
  if (!built.valid) return { ok: false, errors: built.errors };

  const result = await runScoutDiscovery({
    provider: new ManualEntryDiscoveryProvider([built.candidate]),
    repository: deps.repository,
    dispatch: deps.dispatch,
    query: INERT_QUERY,
    now: deps.now,
  });
  if (!result.ok || result.outcomes.length !== 1) {
    throw new Error(result.error ?? "manual entry did not produce a discovery outcome");
  }
  return { ok: true, outcome: result.outcomes[0] };
}
