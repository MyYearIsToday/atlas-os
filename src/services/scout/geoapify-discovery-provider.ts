import type { BusinessDiscoveryProvider, DiscoveryCandidate, DiscoveryQuery } from "../evidence/provider-interfaces";

interface GeoapifyFeature {
  type?: string;
  properties?: {
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    categories?: string[];
    place_id?: string;
    lat?: number;
    lon?: number;
  };
  geometry?: { type?: string; coordinates?: number[] };
}

interface GeoapifyResponse {
  type: string;
  features: GeoapifyFeature[];
}

export interface GeoapifyProviderConfig {
  endpoint?: string;
  timeoutMs?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.geoapify.com/v2/places";
const DEFAULT_CATEGORY = "catering.restaurant";
const MAX_LIMIT = 500;

/** Most specific (deepest dotted) Geoapify category, e.g. "catering.restaurant.pizza". */
function pickCategory(categories: unknown): string | undefined {
  if (!Array.isArray(categories)) return undefined;
  let best: string | undefined;
  for (const c of categories) {
    if (typeof c !== "string" || !c) continue;
    if (!best || c.split(".").length > best.split(".").length) best = c;
  }
  return best;
}

/** Pure: Geoapify GeoJSON feature -> candidate, or null when no honest business name exists. */
export function mapFeatureToCandidate(feature: GeoapifyFeature): DiscoveryCandidate | null {
  const props = feature?.properties;
  const name = typeof props?.name === "string" ? props.name.trim() : "";
  if (!name) return null;

  const coords = feature.geometry?.type === "Point" ? feature.geometry.coordinates : undefined;
  const lon = props?.lon ?? coords?.[0];
  const lat = props?.lat ?? coords?.[1];

  const addrParts = [props?.housenumber, props?.street, props?.city].filter(Boolean);
  const address =
    props?.formatted?.trim() ||
    [props?.address_line1, props?.address_line2].filter(Boolean).join(", ") ||
    (addrParts.length ? addrParts.join(" ") : undefined) ||
    undefined;

  // Prefer Geoapify's stable place_id; otherwise a deterministic identity from name + position.
  const externalId = props?.place_id || `${name}@${lon ?? ""},${lat ?? ""}`;

  return {
    externalId,
    name,
    category: pickCategory(props?.categories),
    latitude: typeof lat === "number" ? lat : undefined,
    longitude: typeof lon === "number" ? lon : undefined,
    address,
    source: "geoapify",
    sourceMetadata: {
      sourceId: "geoapify",
      name: "Geoapify Places",
      attribution: "Powered by Geoapify; © OpenStreetMap contributors",
    },
  };
}

export class GeoapifyDiscoveryProvider implements BusinessDiscoveryProvider {
  private endpoint: string;
  private timeoutMs: number;
  private limit: number;
  private fetchImpl: typeof fetch;

  constructor(config: GeoapifyProviderConfig = {}) {
    this.endpoint = config.endpoint ?? (process.env.GEOAPIFY_API_URL?.trim() || DEFAULT_ENDPOINT);
    this.timeoutMs = config.timeoutMs ?? 25000;
    this.limit = Math.min(Math.max(Math.trunc(config.limit ?? 50), 1), MAX_LIMIT);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    // The key comes only from the environment, is read at call time, and never appears in errors.
    const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
    if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not set");
    const redact = (text: string) => text.split(apiKey).join("[redacted]");

    const categories = query.categories.length ? query.categories : [DEFAULT_CATEGORY];
    let url: URL;
    try {
      url = new URL(this.endpoint);
    } catch {
      throw new Error("Geoapify endpoint is not a valid URL");
    }
    url.searchParams.set("categories", categories.join(","));
    url.searchParams.set("filter", `circle:${query.longitude},${query.latitude},${query.radiusMeters}`);
    url.searchParams.set("limit", String(this.limit));
    url.searchParams.set("apiKey", apiKey);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const cause = e instanceof Error && e.cause ? ` cause=${JSON.stringify(e.cause)}` : "";
      throw new Error(redact(`Geoapify request failed: ${e instanceof Error ? e.message : "network error"}${cause}`));
    }
    if (!res.ok) throw new Error(`Geoapify returned HTTP ${res.status}`);

    let body: GeoapifyResponse;
    try {
      body = (await res.json()) as GeoapifyResponse;
    } catch {
      throw new Error("Geoapify returned an unparseable response");
    }
    if (!body || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
      throw new Error("Geoapify response is not a FeatureCollection with features[]");
    }

    const candidates: DiscoveryCandidate[] = [];
    for (const feature of body.features) {
      const candidate = mapFeatureToCandidate(feature);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }
}
