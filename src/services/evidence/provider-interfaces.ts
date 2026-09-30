export interface DiscoveryQuery { latitude: number; longitude: number; radiusMeters: number; categories: string[]; }
export interface ProviderSourceMetadata {
  sourceId: string;
  name: string;
  attribution?: string;
  licenseTermsNote?: string;
}

export interface DiscoveryCandidate {
  externalId: string;
  name: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  source: string;
  sourceUrl?: string;
  sourceMetadata?: ProviderSourceMetadata;
}
export interface BusinessDiscoveryProvider { discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]>; }
export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName?: string;
  source: string;
  sourceMetadata?: ProviderSourceMetadata;
}
export interface GeocoderProvider { geocode(address: string): Promise<GeocodeResult | null>; reverse(latitude: number, longitude: number): Promise<GeocodeResult | null>; }
export interface BusinessEnrichmentProvider { enrich(candidate: DiscoveryCandidate): Promise<Record<string, unknown>>; }
export interface EvidenceCollector { collect(input: unknown): Promise<unknown[]>; }

/**
 * Documented future extension point only — per Sprint 4A item 13, Google API
 * access must remain optional and is NOT implemented in this sprint. No
 * authentication, request logic, or credentials exist for this yet. Atlas
 * must continue functioning fully without it (see SPEC-004-MapSpark.md §
 * Google Evidence Rule). Do not implement against this interface until a
 * CEO-approved decision authorizes a Google connector.
 */
export interface GoogleAuthorizedProvider extends BusinessEnrichmentProvider {
  readonly requiresAuthorization: true;
}
