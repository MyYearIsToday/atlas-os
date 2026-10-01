import { OverpassDiscoveryProvider, mapElementToCandidate } from "./overpass-discovery-provider";
import { createScoutDiscoveryProvider } from "./discovery-provider-factory";
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

const query = { latitude: 5.6, longitude: -0.19, radiusMeters: 5000, categories: ["restaurant"] };
const goodNode = { type: "node" as const, id: 123456, lat: 5.6001, lon: -0.1901, tags: { name: "Osu Kitchen", amenity: "restaurant", "addr:street": "Oxford St" } };
const mapped = mapElementToCandidate(goodNode);
check("a valid OSM node maps to a candidate", mapped?.name === "Osu Kitchen" && mapped.category === "restaurant" && mapped.latitude === 5.6001);
check("OSM external IDs are stable and source is registered", mapped?.externalId === "node/123456" && mapped.source === "overpass");
check("source URL identifies the OSM object", mapped?.sourceUrl === "https://www.openstreetmap.org/node/123456");

const way = { type: "way" as const, id: 999, center: { lat: 5.61, lon: -0.2 }, tags: { name: "Way Business", shop: "bakery" } };
check("ways use their center and shop category", mapElementToCandidate(way)?.latitude === 5.61 && mapElementToCandidate(way)?.category === "bakery");
check("unnamed elements are skipped", mapElementToCandidate({ type: "node", id: 1 }) === null && mapElementToCandidate({ type: "node", id: 2, tags: { amenity: "cafe" } }) === null);
check("missing coordinates do not crash mapping", mapElementToCandidate({ type: "node", id: 3, tags: { name: "No Coords Cafe" } })?.latitude === undefined);

{
  const provider = new OverpassDiscoveryProvider({ fetchImpl: (async () => ({ ok: true, json: async () => ({ elements: [] }) })) as unknown as typeof fetch, sleep: async () => {} });
  const result = await provider.discover(query);
  check("empty elements return an empty candidate list", Array.isArray(result) && result.length === 0);
}

{
  const provider = new OverpassDiscoveryProvider({ fetchImpl: (async () => ({ ok: true, json: async () => ({ notElements: [] }) })) as unknown as typeof fetch, sleep: async () => {} });
  let threw = false;
  try { await provider.discover(query); } catch { threw = true; }
  check("malformed response fails explicitly", threw);
}

{
  const failingFetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const provider = new OverpassDiscoveryProvider({ fetchImpl: failingFetch, sleep: async () => {} });
  let networkThrew = false;
  try { await provider.discover(query); } catch { networkThrew = true; }
  const badStatusFetch = (async () => ({ ok: false, status: 504 })) as unknown as typeof fetch;
  const provider2 = new OverpassDiscoveryProvider({ fetchImpl: badStatusFetch, sleep: async () => {} });
  let statusThrew = false;
  try { await provider2.discover(query); } catch { statusThrew = true; }
  check("network and non-2xx failures throw", networkThrew && statusThrew);
}

{
  let now = 0;
  const waits: number[] = [];
  const provider = new OverpassDiscoveryProvider({
    fetchImpl: (async () => ({ ok: true, json: async () => ({ elements: [] }) })) as unknown as typeof fetch,
    now: () => now,
    sleep: async (ms) => { waits.push(ms); now += ms; },
    minRequestIntervalMs: 1000,
  });
  await provider.discover(query);
  await provider.discover(query);
  check("requests respect the configured minimum interval", waits.length === 1 && waits[0] === 1000);
}

{
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ elements: [goodNode, { type: "node", id: 2, tags: { amenity: "cafe" } }] }),
  })) as unknown as typeof fetch;
  const provider = new OverpassDiscoveryProvider({ fetchImpl, sleep: async () => {} });
  const repo = new InMemoryBusinessRepository();
  const orchestrator = new AtlasOrchestrator(defaultOrchestrationConfig);
  const result = await runScoutDiscovery({ provider, repository: repo, query, dispatch: (t, p) => orchestrator.dispatch(t, p) });
  const entry = orchestrator.log.all().find((e) => e.event === "BusinessDiscovered");
  check("mocked Overpass result flows through the existing discovery loop", result.ok && result.candidatesFound === 1 && repo.list().length === 1 && entry?.outcome === "SUCCESS");
}

{
  delete process.env.SCOUT_DISCOVERY_SOURCE;
  const defaultProvider = createScoutDiscoveryProvider();
  process.env.SCOUT_DISCOVERY_SOURCE = "overpass";
  const optedInProvider = createScoutDiscoveryProvider();
  delete process.env.SCOUT_DISCOVERY_SOURCE;
  check("factory defaults to deterministic test provider", defaultProvider instanceof TestBusinessDiscoveryProvider);
  check("factory selects Overpass only when explicitly requested", optedInProvider instanceof OverpassDiscoveryProvider);
}

console.log(failures === 0 ? "\nALL OVERPASS DISCOVERY SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);