import type {
  BusinessDiscoveryProvider,
  DiscoveryCandidate,
  DiscoveryQuery,
  GeocodeResult,
  GeocoderProvider,
  ProviderSourceMetadata,
} from "./provider-interfaces";
import {
  defaultRequestPolicies,
  backoffDelay,
  type RequestPolicy,
} from "./request-policy";
import {
  defaultSources,
  requireEnabledSource,
  type SourceDefinition,
} from "./source-registry";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

export interface OSMProviderOptions {
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  userAgent?: string;
  nominatimBaseUrl?: string;
  overpassBaseUrl?: string;
  sources?: SourceDefinition[];
  policies?: Partial<Record<"nominatim" | "overpass", RequestPolicy>>;
}

export class OSMProviderError extends Error {
  constructor(
    message: string,
    readonly sourceId: "nominatim" | "overpass",
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OSMProviderError";
  }
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);
const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function sourceMetadata(source: SourceDefinition): ProviderSourceMetadata {
  return {
    sourceId: source.id,
    name: source.name,
    attribution: source.attributionRequirement,
    licenseTermsNote: source.licenseTermsNote,
  };
}

function finiteCoordinate(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${field} returned by provider`);
  return number;
}

class PolicyAwareClient {
  private lastRequestAt = 0;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly sleep: Sleep,
    private readonly now: () => number,
    private readonly policies: Record<string, RequestPolicy>,
    private readonly sources: SourceDefinition[],
  ) {}

  async getJson<T>(
    sourceId: "nominatim" | "overpass",
    url: string,
    init: RequestInit,
  ): Promise<T> {
    const source = requireEnabledSource(sourceId, this.sources);
    const policy = this.policies[sourceId];
    if (!policy) throw new OSMProviderError(`No request policy configured for ${sourceId}`, sourceId);
    const cacheKey = `${sourceId}:${init.method ?? "GET"}:${url}:${String(init.body ?? "")}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;

    const elapsed = this.now() - this.lastRequestAt;
    if (elapsed < policy.minIntervalMs) {
      await this.sleep(policy.minIntervalMs - elapsed);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
      this.lastRequestAt = this.now();
      try {
        const response = await this.fetchImpl(url, init);
        if (response.ok) {
          const value = (await response.json()) as T;
          if (policy.cacheTtlMs > 0) {
            this.cache.set(cacheKey, { expiresAt: this.now() + policy.cacheTtlMs, value });
          }
          return value;
        }

        const retryable = response.status === 429 || response.status >= 500;
        const error = new OSMProviderError(
          `${source.name} request failed with HTTP ${response.status}`,
          sourceId,
          response.status,
        );
        if (!retryable || attempt === policy.maxRetries) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof OSMProviderError && error.status !== undefined && error.status < 500 && error.status !== 429) {
          throw error;
        }
        lastError = error;
        if (attempt === policy.maxRetries) {
          throw new OSMProviderError(
            `${source.name} request failed after ${attempt + 1} attempt(s)`,
            sourceId,
            undefined,
            error,
          );
        }
      }
      await this.sleep(backoffDelay(attempt, policy.backoffBaseMs));
    }

    throw new OSMProviderError(`${source.name} request failed`, sourceId, undefined, lastError);
  }
}

export class NominatimGeocoder implements GeocoderProvider {
  private readonly client: PolicyAwareClient;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly source: SourceDefinition;

  constructor(options: OSMProviderOptions = {}) {
    const sources = options.sources ?? defaultSources;
    this.source = requireEnabledSource("nominatim", sources);
    this.baseUrl = (options.nominatimBaseUrl ?? "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    this.userAgent = options.userAgent ?? "Atlas OS Phase 1";
    this.client = new PolicyAwareClient(
      options.fetchImpl ?? defaultFetch,
      options.sleep ?? defaultSleep,
      options.now ?? Date.now,
      { ...defaultRequestPolicies, ...options.policies },
      sources,
    );
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const query = address.trim();
    if (!query) return null;
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", query);
    const results = await this.client.getJson<Array<{ lat: string; lon: string; display_name?: string }>>(
      "nominatim",
      url.toString(),
      { headers: { Accept: "application/json", "User-Agent": this.userAgent } },
    );
    const result = results[0];
    if (!result) return null;
    return {
      latitude: finiteCoordinate(result.lat, "latitude"),
      longitude: finiteCoordinate(result.lon, "longitude"),
      displayName: result.display_name,
      source: "nominatim",
      sourceMetadata: sourceMetadata(this.source),
    };
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Reverse geocoding requires finite coordinates");
    }
    const url = new URL(`${this.baseUrl}/reverse`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    const result = await this.client.getJson<{ lat?: string; lon?: string; display_name?: string }>(
      "nominatim",
      url.toString(),
      { headers: { Accept: "application/json", "User-Agent": this.userAgent } },
    );
    if (result.lat === undefined || result.lon === undefined) return null;
    return {
      latitude: finiteCoordinate(result.lat, "latitude"),
      longitude: finiteCoordinate(result.lon, "longitude"),
      displayName: result.display_name,
      source: "nominatim",
      sourceMetadata: sourceMetadata(this.source),
    };
  }
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

const businessTagKeys = ["amenity", "shop", "tourism", "office", "craft", "healthcare", "leisure"];
const maxDiscoveryRadiusMeters = 10_000;

function escapeOverpass(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function categoryClauses(categories: string[]): string[] {
  const requested = categories.length ? categories : businessTagKeys;
  return requested.flatMap((category) => {
    const [requestedKey, requestedValue] = category.split("=", 2);
    if (requestedValue && businessTagKeys.includes(requestedKey)) {
      return [`nwr["${requestedKey}"="${escapeOverpass(requestedValue)}"](around:{radius},{lat},{lon});`];
    }
    return businessTagKeys.map(
      (key) => `nwr["${key}"="${escapeOverpass(category)}"](around:{radius},{lat},{lon});`,
    );
  });
}

export function buildOverpassQuery(query: DiscoveryQuery): string {
  if (!Number.isFinite(query.latitude) || !Number.isFinite(query.longitude)) {
    throw new Error("Discovery requires finite coordinates");
  }
  if (!Number.isFinite(query.radiusMeters) || query.radiusMeters <= 0 || query.radiusMeters > maxDiscoveryRadiusMeters) {
    throw new Error(`Discovery radius must be between 1 and ${maxDiscoveryRadiusMeters} meters`);
  }
  const clauses = categoryClauses(query.categories);
  return `[out:json][timeout:25];(${clauses.join("")});out center tags;`
    .replaceAll("{radius}", String(Math.round(query.radiusMeters)))
    .replaceAll("{lat}", String(query.latitude))
    .replaceAll("{lon}", String(query.longitude));
}

function elementCoordinates(element: OverpassElement): { latitude: number; longitude: number } | null {
  if (element.type === "node" && element.lat !== undefined && element.lon !== undefined) {
    return { latitude: finiteCoordinate(element.lat, "latitude"), longitude: finiteCoordinate(element.lon, "longitude") };
  }
  if (element.center?.lat !== undefined && element.center.lon !== undefined) {
    return { latitude: finiteCoordinate(element.center.lat, "latitude"), longitude: finiteCoordinate(element.center.lon, "longitude") };
  }
  return null;
}

function elementAddress(tags: Record<string, string>): string | undefined {
  if (tags["addr:full"]) return tags["addr:full"];
  const parts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"], tags["addr:city"]].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function normalizeElement(element: OverpassElement, source: SourceDefinition): DiscoveryCandidate | null {
  const tags = element.tags ?? {};
  const name = tags.name ?? tags["name:en"];
  const coordinates = elementCoordinates(element);
  if (!name || !coordinates) return null;
  const category = businessTagKeys.map((key) => tags[key]).find(Boolean);
  return {
    externalId: `${element.type}/${element.id}`,
    name,
    category,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    address: elementAddress(tags),
    source: "osm",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    sourceMetadata: sourceMetadata(source),
  };
}

export class OverpassBusinessDiscoveryProvider implements BusinessDiscoveryProvider {
  private readonly client: PolicyAwareClient;
  private readonly baseUrl: string;
  private readonly source: SourceDefinition;

  constructor(options: OSMProviderOptions = {}) {
    const sources = options.sources ?? defaultSources;
    this.source = requireEnabledSource("overpass", sources);
    this.baseUrl = (options.overpassBaseUrl ?? "https://overpass-api.de/api").replace(/\/$/, "");
    this.client = new PolicyAwareClient(
      options.fetchImpl ?? defaultFetch,
      options.sleep ?? defaultSleep,
      options.now ?? Date.now,
      { ...defaultRequestPolicies, ...options.policies },
      sources,
    );
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const body = buildOverpassQuery(query);
    const result = await this.client.getJson<{ elements?: OverpassElement[] }>(
      "overpass",
      `${this.baseUrl}/interpreter`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: body }).toString(),
      },
    );
    const unique = new Map<string, DiscoveryCandidate>();
    for (const element of result.elements ?? []) {
      const candidate = normalizeElement(element, this.source);
      if (candidate) unique.set(candidate.externalId, candidate);
    }
    return [...unique.values()];
  }
}