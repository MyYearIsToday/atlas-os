import { AtlasOrchestrator } from "../../orchestrator/orchestrator";
import { defaultOrchestrationConfig } from "../../orchestrator/orchestration-config";
import { InMemoryBusinessRepository } from "./business-repository";
import { normalizeCandidate } from "./discovery-normalize";
import { runScoutDiscovery } from "./discovery-loop";
import { TestBusinessDiscoveryProvider } from "./test-discovery-provider";
import { ScoutScheduler } from "./scheduler";
import type { DiscoveryCandidate } from "../evidence/provider-interfaces";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const query = { latitude: 5.6, longitude: -0.19, radiusMeters: 5000, categories: ["restaurant"] };
const candidateA: DiscoveryCandidate = { externalId: "osm-1", name: "Jollof Palace", category: "restaurant", latitude: 5.6001, longitude: -0.1901, address: "Osu, Accra", source: "osm" };
const candidateB: DiscoveryCandidate = { externalId: "osm-2", name: "Jollof Palace", category: "restaurant", latitude: 5.6002, longitude: -0.19, address: "Osu, Accra", source: "osm" };

const normalized = normalizeCandidate(candidateA, "biz-test-1", "2026-09-30T00:00:00.000Z");
check("normalization copies the name, category, and coordinates", normalized.canonicalName === "Jollof Palace" && normalized.category === "restaurant" && normalized.latitude === 5.6001);
check("normalization never invents fields the candidate did not supply", normalized.phone === undefined && normalized.website === undefined && normalized.aliases.length === 0);
check("normalization records the source", normalized.sourceReferences.includes("osm"));

{
  const repo = new InMemoryBusinessRepository();
  const provider = new TestBusinessDiscoveryProvider([]);
  const dispatched: string[] = [];
  const result = await runScoutDiscovery({ provider, repository: repo, query, dispatch: async (t) => { dispatched.push(t); } });
  check("empty discovery is not an error", result.ok === true && result.candidatesFound === 0);
  check("empty discovery publishes no event and persists nothing", dispatched.length === 0 && repo.list().length === 0);
}

{
  const repo = new InMemoryBusinessRepository();
  const provider = new TestBusinessDiscoveryProvider([], true);
  const dispatched: string[] = [];
  const result = await runScoutDiscovery({ provider, repository: repo, query, dispatch: async (t) => { dispatched.push(t); } });
  check("source failures are structured, not thrown", result.ok === false && typeof result.error === "string");
  check("source failure publishes no event and persists nothing", dispatched.length === 0 && repo.list().length === 0);
}

{
  const repo = new InMemoryBusinessRepository();
  const provider = new TestBusinessDiscoveryProvider([candidateA]);
  const orchestrator = new AtlasOrchestrator(defaultOrchestrationConfig);
  const result = await runScoutDiscovery({ provider, repository: repo, query, dispatch: (t, p) => orchestrator.dispatch(t, p) });
  const entry = orchestrator.log.all().find((e) => e.event === "BusinessDiscovered");
  check("discovery persists and dispatches through the real orchestrator", result.ok && result.candidatesFound === 1 && repo.list().length === 1 && entry?.outcome === "SUCCESS");
  check("a new business is not flagged for review", result.outcomes[0]?.duplicateStatus === "NONE");
}

{
  const repo = new InMemoryBusinessRepository();
  await runScoutDiscovery({ provider: new TestBusinessDiscoveryProvider([candidateA]), repository: repo, query, dispatch: async () => {} });
  const result = await runScoutDiscovery({ provider: new TestBusinessDiscoveryProvider([candidateB]), repository: repo, query, dispatch: async () => {} });
  check("nearby name match is flagged for review, not silently merged", result.outcomes[0]?.duplicateStatus === "POSSIBLE_DUPLICATE" && repo.list().length === 2);
}

{
  const repo = new InMemoryBusinessRepository();
  const dispatched: unknown[] = [];
  const provider = new TestBusinessDiscoveryProvider([candidateA]);
  await runScoutDiscovery({ provider, repository: repo, query, dispatch: async (_t, p) => { dispatched.push(p); } });
  await runScoutDiscovery({ provider, repository: repo, query, dispatch: async (_t, p) => { dispatched.push(p); } });
  const ids = dispatched.map((p) => (p as { businessId: string }).businessId);
  check("same source ID updates one record and publishes idempotently", repo.list().length === 1 && dispatched.length === 2 && ids[0] === ids[1]);
}

{
  const repo = new InMemoryBusinessRepository();
  const runs: number[] = [];
  const scheduler = new ScoutScheduler({
    provider: new TestBusinessDiscoveryProvider([candidateA]),
    repository: repo,
    query,
    dispatch: async () => {},
  });
  scheduler.onRun((r) => runs.push(r.candidatesFound));
  const result = await scheduler.triggerNow();
  check("internal trigger runs discovery without an HTTP endpoint", result?.ok === true && runs.length === 1 && runs[0] === 1);
  check("scheduler keeps the latest result", scheduler.lastResult?.ok === true);
}

console.log(failures === 0 ? "\nALL SCOUT DISCOVERY SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);