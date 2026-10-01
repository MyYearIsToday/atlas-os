import type { BusinessDiscoveryProvider, DiscoveryCandidate, DiscoveryQuery } from "../evidence/provider-interfaces";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OverpassProviderConfig {
  endpoint?: string;
  timeoutMs?: number;
  minRequestIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";

function buildQuery(q: DiscoveryQuery): string {
  const cats = q.categories.length ? q.categories : ["restaurant"];
  const filters = cats.map((c) => `node["amenity"="${c}"](around:${q.radiusMeters},${q.latitude},${q.longitude});`).join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${filters}\n);\nout center tags;`;
}

/** Pure: raw Overpass element -> candidate, or null when no honest business name exists. */
export function mapElementToCandidate(el: OverpassElement): DiscoveryCandidate | null {
  const name = el.tags?.name?.trim();
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const addrParts = [el.tags?.["addr:housenumber"], el.tags?.["addr:street"], el.tags?.["addr:city"]].filter(Boolean);
  return {
    externalId: `${el.type}/${el.id}`,
    name,
    category: el.tags?.amenity ?? el.tags?.shop,
    latitude: lat,
    longitude: lon,
    address: addrParts.length ? addrParts.join(" ") : undefined,
    source: "overpass",
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

export class OverpassDiscoveryProvider implements BusinessDiscoveryProvider {
  private lastRequestAt = -Infinity;
  private endpoint: string;
  private timeoutMs: number;
  private minIntervalMs: number;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(config: OverpassProviderConfig = {}) {
    this.endpoint = config.endpoint ?? process.env.OVERPASS_API_URL ?? DEFAULT_ENDPOINT;
    this.timeoutMs = config.timeoutMs ?? 25000;
    this.minIntervalMs = config.minRequestIntervalMs ?? 1000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = config.now ?? Date.now;
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const wait = this.minIntervalMs - (this.now() - this.lastRequestAt);
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: buildQuery(query),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Error(`Overpass request failed: ${e instanceof Error ? e.message : "network error"}`);
    }
    if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);

    let body: OverpassResponse;
    try {
      body = (await res.json()) as OverpassResponse;
    } catch {
      throw new Error("Overpass returned an unparseable response");
    }
    if (!Array.isArray(body.elements)) throw new Error("Overpass response missing elements[]");

    const candidates: DiscoveryCandidate[] = [];
    for (const el of body.elements) {
      const candidate = mapElementToCandidate(el);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }
}