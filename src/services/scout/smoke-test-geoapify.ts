import { GeoapifyDiscoveryProvider, mapFeatureToCandidate } from "./geoapify-discovery-provider";
import { createScoutDiscoveryProvider } from "./discovery-provider-factory";
import { OverpassDiscoveryProvider } from "./overpass-discovery-provider";
import { TestBusinessDiscoveryProvider } from "./test-discovery-provider";
import { runScoutDiscovery } from "./discovery-loop";
import { InMemoryBusinessRepository } from "./business-repository";
import { AtlasOrchestrator } from "../../orchestrator/orchestrator";
import { defaultOrchestrationConfig } from "../../orchestrator/orchestration-config";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const TEST_KEY = "test-key-not-real-123";
const query = { latitude: 5.6, longitude: -0.19, radiusMeters: 5000, categories: ["catering.restaurant", "catering.cafe"] };
const goodFeature = {
  type: "Feature",
  properties: {
    name: "Osu Kitchen",
    formatted: "Osu Kitchen, 12 Oxford St, Accra, Ghana",
    categories: ["catering", "catering.restaurant", "catering.restaurant.african"],
    place_id: "place-abc-123",
    lat: 5.6001,
    lon: -0.1901,
  },
  geometry: { type: "Point", coordinates: [-0.1901, 5.6001] },
};
const featureCollection = (features: unknown[]) => ({ type: "FeatureCollection", features });
const okFetch = (body: unknown, capture?: { url?: string; init?: RequestInit }) =>
  (async (url: string, init?: RequestInit) => {
    if (capture) { capture.url = url; capture.init = init; }
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;

async function throws(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

const savedKey = process.env.GEOAPIFY_API_KEY;
const savedUrl = process.env.GEOAPIFY_API_URL;
const savedSource = process.env.SCOUT_DISCOVERY_SOURCE;
process.env.GEOAPIFY_API_KEY = TEST_KEY;
delete process.env.GEOAPIFY_API_URL;

// --- Pure mapping ---
const mapped = mapFeatureToCandidate(goodFeature);
check("a valid feature maps to a candidate", mapped?.name === "Osu Kitchen" && mapped.latitude === 5.6001 && mapped.longitude === -0.1901);
check("external ID is Geoapify place_id and source is registered", mapped?.externalId === "place-abc-123" && mapped.source === "geoapify");
check("most specific category is chosen", mapped?.category === "catering.restaurant.african");
check("formatted address is used", mapped?.address === "Osu Kitchen, 12 Oxford St, Accra, Ghana");
check("source metadata carries attribution", mapped?.sourceMetadata?.sourceId === "geoapify" && !!mapped.sourceMetadata.attribution);
check("candidate never contains the API key", !JSON.stringify(mapped).includes(TEST_KEY));
check("website and phone returned by Geoapify are carried on the candidate (used for peer benchmarking)", (() => {
  const c = mapFeatureToCandidate({ type: "Feature", properties: { name: "Site Biz", place_id: "w1", website: " https://site.example ", contact: { phone: "+233 20 000 0000" } } });
  return c?.website === "https://site.example" && c.phone === "+233 20 000 0000";
})());
check("unnamed features are skipped", mapFeatureToCandidate({ type: "Feature", properties: { place_id: "x" } }) === null && mapFeatureToCandidate({ properties: { name: "   " } }) === null);
check("geometry supplies coordinates when properties lack them", (() => {
  const c = mapFeatureToCandidate({ properties: { name: "Geo Only", place_id: "g1" }, geometry: { type: "Point", coordinates: [1.5, 2.5] } });
  return c?.longitude === 1.5 && c.latitude === 2.5;
})());
check("missing coordinates do not crash mapping", mapFeatureToCandidate({ properties: { name: "No Coords", place_id: "n1" } })?.latitude === undefined);

// --- Request construction ---
{
  const capture: { url?: string; init?: RequestInit } = {};
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(featureCollection([]), capture), limit: 25 });
  await provider.discover(query);
  const url = new URL(capture.url ?? "https://invalid.example");
  check("default endpoint is the official /v2/places URL", url.origin + url.pathname === "https://api.geoapify.com/v2/places");
  check("uses GET", capture.init?.method === "GET");
  check("categories are comma-joined", url.searchParams.get("categories") === "catering.restaurant,catering.cafe");
  check("filter is circle:lon,lat,radiusMeters", url.searchParams.get("filter") === "circle:-0.19,5.6,5000");
  check("limit is sent", url.searchParams.get("limit") === "25");
  check("apiKey comes from GEOAPIFY_API_KEY", url.searchParams.get("apiKey") === TEST_KEY);
}

{
  const capture: { url?: string } = {};
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(featureCollection([]), capture) });
  await provider.discover({ ...query, categories: [] });
  check("empty categories fall back to a default category", new URL(capture.url ?? "https://invalid.example").searchParams.get("categories") === "catering.restaurant");
}

{
  process.env.GEOAPIFY_API_URL = "https://geoapify.example.test/v2/places";
  const capture: { url?: string } = {};
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(featureCollection([]), capture) });
  await provider.discover(query);
  check("GEOAPIFY_API_URL overrides the default endpoint", (capture.url ?? "").startsWith("https://geoapify.example.test/v2/places?"));
  delete process.env.GEOAPIFY_API_URL;
}

// --- Successful FeatureCollection / empty ---
{
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(featureCollection([goodFeature, { type: "Feature", properties: { place_id: "unnamed" } }])) });
  const result = await provider.discover(query);
  check("FeatureCollection maps to candidates and drops unnamed features", result.length === 1 && result[0].name === "Osu Kitchen");
}
{
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(featureCollection([])) });
  const result = await provider.discover(query);
  check("empty features return an empty candidate list", Array.isArray(result) && result.length === 0);
}

// --- Missing API key (no request may be made) ---
{
  let called = false;
  const fetchImpl = (async () => { called = true; return { ok: true, json: async () => featureCollection([]) }; }) as unknown as typeof fetch;
  delete process.env.GEOAPIFY_API_KEY;
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl });
  const msg = await throws(() => provider.discover(query));
  process.env.GEOAPIFY_API_KEY = "   ";
  const blankMsg = await throws(() => provider.discover(query));
  process.env.GEOAPIFY_API_KEY = TEST_KEY;
  check("missing or blank API key fails explicitly without calling the API", msg === "GEOAPIFY_API_KEY is not set" && blankMsg === "GEOAPIFY_API_KEY is not set" && !called);
}

// --- Failure modes ---
{
  const badStatus = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
  const msg = await throws(() => new GeoapifyDiscoveryProvider({ fetchImpl: badStatus }).discover(query));
  check("non-2xx response throws with the status and no key", msg === "Geoapify returned HTTP 401");
}
{
  const failingFetch = (async (url: string) => {
    const err = new Error(`fetch failed for ${url}`, { cause: { code: "ECONNREFUSED" } });
    throw err;
  }) as unknown as typeof fetch;
  const msg = await throws(() => new GeoapifyDiscoveryProvider({ fetchImpl: failingFetch }).discover(query));
  check("network failure throws with cause and the API key is redacted", !!msg && msg.includes("ECONNREFUSED") && !msg.includes(TEST_KEY) && msg.includes("[redacted]"));
}
{
  const unparseable = (async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } })) as unknown as typeof fetch;
  const msg = await throws(() => new GeoapifyDiscoveryProvider({ fetchImpl: unparseable }).discover(query));
  check("unparseable body fails explicitly", msg === "Geoapify returned an unparseable response");
}
{
  const bodies: unknown[] = [{ type: "FeatureCollection" }, { type: "FeatureCollection", features: "nope" }, { type: "Feature", features: [] }, { elements: [] }, null];
  const results: (string | null)[] = [];
  for (const body of bodies) results.push(await throws(() => new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(body) }).discover(query)));
  check("malformed responses fail explicitly", results.every((m) => m === "Geoapify response is not a FeatureCollection with features[]"));
}
{
  const msg = await throws(() => new GeoapifyDiscoveryProvider({ endpoint: "not a url", fetchImpl: okFetch(featureCollection([])) }).discover(query));
  check("invalid endpoint fails explicitly without leaking the key", msg === "Geoapify endpoint is not a valid URL");
}

// --- Existing discovery loop does normalization / dedupe / persistence / BusinessDiscovered ---
{
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: okFetch(featureCollection([goodFeature, { type: "Feature", properties: { place_id: "unnamed" } }])) });
  const repo = new InMemoryBusinessRepository();
  const orchestrator = new AtlasOrchestrator(defaultOrchestrationConfig);
  const result = await runScoutDiscovery({ provider, repository: repo, query, dispatch: (t, p) => orchestrator.dispatch(t, p) });
  const entry = orchestrator.log.all().find((e) => e.event === "BusinessDiscovered");
  check("mocked Geoapify result flows through the existing discovery loop", result.ok && result.candidatesFound === 1 && repo.list().length === 1 && entry?.outcome === "SUCCESS");
  check("repository keys the record by geoapify source and place_id", repo.findByExternalKey("geoapify", "place-abc-123")?.canonicalName === "Osu Kitchen");
}
{
  const provider = new GeoapifyDiscoveryProvider({ fetchImpl: (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch });
  const result = await runScoutDiscovery({ provider, repository: new InMemoryBusinessRepository(), query, dispatch: async () => {} });
  check("provider failure surfaces as a failed run with no candidates", !result.ok && result.candidatesFound === 0 && result.error === "Geoapify returned HTTP 429");
}

// --- Factory ---
{
  delete process.env.SCOUT_DISCOVERY_SOURCE;
  const byDefault = createScoutDiscoveryProvider();
  process.env.SCOUT_DISCOVERY_SOURCE = "geoapify";
  const geoapify = createScoutDiscoveryProvider();
  process.env.SCOUT_DISCOVERY_SOURCE = "overpass";
  const overpass = createScoutDiscoveryProvider();
  check("factory selects Geoapify only when explicitly requested", geoapify instanceof GeoapifyDiscoveryProvider);
  check("factory still selects Overpass and defaults to the test provider", overpass instanceof OverpassDiscoveryProvider && byDefault instanceof TestBusinessDiscoveryProvider);
}

if (savedKey === undefined) delete process.env.GEOAPIFY_API_KEY; else process.env.GEOAPIFY_API_KEY = savedKey;
if (savedUrl === undefined) delete process.env.GEOAPIFY_API_URL; else process.env.GEOAPIFY_API_URL = savedUrl;
if (savedSource === undefined) delete process.env.SCOUT_DISCOVERY_SOURCE; else process.env.SCOUT_DISCOVERY_SOURCE = savedSource;

console.log(failures === 0 ? "\nALL GEOAPIFY DISCOVERY SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
