import { assessDuplicate } from "../src/services/evidence/business-deduplication";
import {
  createBusinessIntelligence,
  createEvidenceRecord,
} from "../src/services/evidence/constructors";
import { NominatimGeocoder, OSMProviderError, OverpassBusinessDiscoveryProvider } from "../src/services/evidence/osm-providers";
import { calculateOpportunityScore } from "../src/services/scoring/opportunity-score";
import { createLocalPhase1Repositories, PHASE1_STORAGE_KEY, type Phase1Storage } from "../src/services/phase1-repositories";
import { ScoutCoordinator } from "../src/services/scout/coordinator";
import { createScoutRun } from "../src/services/scout/scout-run";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}`);
  if (!condition) failures += 1;
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function memoryStorage(): Phase1Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const fixedNow = () => new Date("2026-09-30T00:00:00.000Z");
let ids = 0;
const fixedIds = () => `phase1-${++ids}`;
const noWait = async () => undefined;

const nominatim = new NominatimGeocoder({
  fetchImpl: async () =>
    response([{ lat: "5.6037", lon: "-0.1870", display_name: "Accra, Ghana" }]),
  sleep: noWait,
  now: () => 0,
  policies: { nominatim: { minIntervalMs: 0, maxRetries: 0, backoffBaseMs: 0, cacheTtlMs: 0 } },
});
const geocoded = await nominatim.geocode("Accra");
check("Nominatim normalizes coordinates and display name", geocoded?.latitude === 5.6037 && geocoded.displayName === "Accra, Ghana");
check("Nominatim preserves registered source attribution", geocoded?.sourceMetadata?.attribution === "© OpenStreetMap contributors");

let overpassBody = "";
const overpass = new OverpassBusinessDiscoveryProvider({
  fetchImpl: async (_input, init) => {
    overpassBody = String(init?.body ?? "");
    return response({
      elements: [
        { type: "node", id: 11, lat: 5.604, lon: -0.187, tags: { name: "Cedar & Salt", amenity: "restaurant", "addr:street": "Oxford Street" } },
        { type: "way", id: 12, center: { lat: 5.605, lon: -0.188 }, tags: { "name:en": "Kente House", shop: "clothes" } },
        { type: "node", id: 13, lat: 5.606, lon: -0.189, tags: { amenity: "cafe" } },
      ],
    });
  },
  sleep: noWait,
  now: () => 0,
  policies: { overpass: { minIntervalMs: 0, maxRetries: 0, backoffBaseMs: 0, cacheTtlMs: 0 } },
});
const discovered = await overpass.discover({ latitude: 5.6037, longitude: -0.187, radiusMeters: 750, categories: ["restaurant", "clothes"] });
check("Overpass normalizes named nodes and centered ways", discovered.length === 2 && discovered[1].latitude === 5.605);
check("Overpass skips records without a real name", !discovered.some((item) => item.externalId === "node/13"));
const decodedOverpassBody = new URLSearchParams(overpassBody).get("data") ?? "";
check("Overpass request is bounded and includes the requested radius", decodedOverpassBody.includes("around:750") && decodedOverpassBody.includes("timeout:25"));

const failingProvider = new NominatimGeocoder({
  fetchImpl: async () => response({ error: "unavailable" }, 503),
  sleep: noWait,
  now: () => 0,
  policies: { nominatim: { minIntervalMs: 0, maxRetries: 0, backoffBaseMs: 0, cacheTtlMs: 0 } },
});
let providerFailedExplicitly = false;
try {
  await failingProvider.geocode("Accra");
} catch (error) {
  providerFailedExplicitly = error instanceof OSMProviderError && error.sourceId === "nominatim";
}
check("provider failure is explicit and names its source", providerFailedExplicitly);

const storage = memoryStorage();
const repositories = createLocalPhase1Repositories({ storage });
const business = createBusinessIntelligence({ id: "business-1", canonicalName: "Cedar & Salt", category: "restaurant", phone: "+233 24 000 0000" }, { now: fixedNow, idFactory: fixedIds });
await repositories.businesses.upsert(business);
const reloadedRepositories = createLocalPhase1Repositories({ storage });
check("canonical BusinessIntelligence persists through a fresh repository", reloadedRepositories.businesses.get("business-1")?.canonicalName === "Cedar & Salt");

const evidence = createEvidenceRecord(
  {
    businessId: business.id,
    field: "category",
    value: "restaurant",
    sourceType: "osm",
    evidenceType: "osm_record",
    collector: "scout_ai",
  },
  { now: fixedNow, idFactory: fixedIds },
);
await repositories.evidence.upsert(evidence);
check("EvidenceRecord is created with source-derived confidence", evidence.confidence === "MEDIUM" && repositories.evidence.listByBusiness(business.id).length === 1);

const duplicate = assessDuplicate(
  business,
  createBusinessIntelligence({ id: "business-2", canonicalName: "Cedar and Salt", phone: "+233 24 000 0000" }, { now: fixedNow, idFactory: fixedIds }),
);
check("duplicate assessment requires review without auto-merging", duplicate.status === "POSSIBLE_DUPLICATE" && duplicate.humanReviewRequired);

const sameScoreInput = {
  businessId: "business-score",
  evidenceCoverage: 100,
  competitorCoverage: 0,
  generatedAt: fixedNow().toISOString(),
  idFactory: fixedIds,
  components: [
    {
      key: "visibilityWeakness",
      rawValue: 0.8,
      maxValue: 1,
      normalizedValue: 0.8,
      weight: 20,
      evidenceRefs: [evidence.evidenceId],
      confidence: "MEDIUM" as const,
      observability: "OBSERVED_PRESENT" as const,
      explanation: "Observed evidence supports the component",
    },
  ],
};
const scoreA = calculateOpportunityScore(sameScoreInput);
const scoreB = calculateOpportunityScore({ ...sameScoreInput, idFactory: fixedIds });
check("deterministic OpportunityScore calculation preserves the same math", scoreA.overallScore === scoreB.overallScore && scoreA.evidenceRefs.length === 1);

const coordinatorRepositories = createLocalPhase1Repositories({ storage: memoryStorage() });
const coordinator = new ScoutCoordinator({
  geocoder: { geocode: async () => ({ latitude: 5.6037, longitude: -0.187, source: "nominatim" }), reverse: async () => null },
  discovery: {
    discover: async () => [
      { externalId: "node/100", name: "Complete Business", category: "restaurant", latitude: 5.604, longitude: -0.187, source: "osm" },
      { externalId: "node/101", name: "Thin Business", source: "osm" },
      { externalId: "node/102", name: "Unscorable Business", category: "restaurant", latitude: 5.606, longitude: -0.189, source: "osm" },
    ],
  },
  repositories: coordinatorRepositories,
  recordFactory: { now: fixedNow, idFactory: fixedIds },
  now: fixedNow,
  scoreBuilder: {
    build: (_business, observed) => ({
      competitorCoverage: 0,
      components: [
        {
          key: "evidenceQuality",
          rawValue: _business.canonicalName === "Unscorable Business" ? null : observed.length / 4,
          maxValue: 4,
          normalizedValue: _business.canonicalName === "Unscorable Business" ? null : observed.length / 4,
          weight: 10,
          evidenceRefs: observed.map((item) => item.evidenceId),
          confidence: _business.canonicalName === "Unscorable Business" ? "UNKNOWN" as const : "MEDIUM" as const,
          observability: _business.canonicalName === "Unscorable Business" ? "NOT_OBSERVABLE" as const : "OBSERVED_PRESENT" as const,
          explanation: "Evidence count is directly observed from the discovery record",
        },
      ],
    }),
  },
});
const workflow = await coordinator.run({ target: "Accra", radiusMeters: 500, categories: ["restaurant"] });
check("ScoutRun reaches a persisted completed lifecycle", workflow.run.status === "COMPLETED" && coordinatorRepositories.scoutRuns.get(workflow.run.runId)?.completedAt !== undefined);
check("complete mocked Scout workflow persists BI and evidence lineage", workflow.businesses.length === 3 && workflow.evidence.every((item) => item.businessId === workflow.businesses.find((businessItem) => businessItem.evidenceReferences.includes(item.evidenceId))?.id));
check("complete evidence receives a deterministic score", workflow.scores.length === 1 && workflow.workflowStates[`${workflow.run.runId}:${workflow.businesses[0].id}`] === "SCORED");
check("insufficient or unobservable evidence is blocked honestly without a score", workflow.scores.length === 1 && Object.values(workflow.workflowStates).filter((state) => state === "BLOCKED").length === 2);
check("Phase 1 repository uses a migration-safe versioned storage key", storage.getItem(PHASE1_STORAGE_KEY) !== null);

const lifecycle = createScoutRun({ targetArea: { query: "Accra", radiusMeters: 500, categories: [] }, idFactory: fixedIds, now: fixedNow });
check("new ScoutRun starts in PENDING", lifecycle.status === "PENDING" && lifecycle.businessIds.length === 0);

console.log(failures === 0 ? "\nALL PHASE 1 SMOKE TESTS PASSED" : `\n${failures} PHASE 1 SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);