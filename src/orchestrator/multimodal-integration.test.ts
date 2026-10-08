import test from "node:test";
import assert from "node:assert/strict";
import type { AIProviderSuccess } from "../workforce/provider-types";
import { AtlasOrchestrator } from "./orchestrator";
import { createPipelineDeps, PipelineStore, buildOpportunityInput, applyScoringGate } from "./atlas-pipeline";
import type { BusinessIntelligence } from "../services/evidence/business-intelligence";
import { WebsiteEvidenceCollector, type HttpResponseLite, type RequestFn } from "../services/evidence/website-collector";
import type { AtlasPersistence, Collection } from "../services/persistence/atlas-persistence";
import { calculateOpportunityScore } from "../services/scoring/opportunity-score";
import { pipelineSchema } from "../services/command-center";
import { MultimodalIntelligenceService } from "../services/multimodal-intelligence/service";
import { WorkforceExecutor } from "../../server/workforce/executor";
import { NVIDIA_OMNI, WorkforceRegistry } from "../../server/workforce/registry";
import { WorkforceProvider } from "../../server/workforce/workforce-provider";

class MemoryAtlasPersistence implements AtlasPersistence {
  private readonly documents = new Map<string, { collection: Collection; id: string; doc: unknown }>();
  async migrate() { return { applied: [], current: 1 }; }
  put(collection: Collection, id: string, doc: unknown) { this.documents.set(`${collection}:${id}`, { collection, id, doc }); }
  remove(collection: Collection, id: string) { this.documents.delete(`${collection}:${id}`); }
  markEvent() {}
  async loadAll(collection: Collection) {
    return [...this.documents.values()].filter((row) => row.collection === collection).map(({ id, doc }) => ({ id, doc }));
  }
  async loadEvents() { return []; }
  async flush() {}
  health() { return { ok: true, failedWrites: 0, lastError: null, pendingWrites: 0 }; }
  async close() {}
}

test("public HTML image discovery reaches workforce, persists only an unverified observation, and displays it", async () => {
  const business: BusinessIntelligence = {
    id: "business-multimodal-integration", canonicalName: "Example Café", aliases: [], category: "cafe", categories: ["cafe"], status: "ACTIVE",
    website: "https://business.example/", socialLinks: [], services: [], products: [], sourceReferences: ["manual"],
    evidenceReferences: [], createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
  };
  const html = `<html><head><title>Example Café</title></head><body>
    <img alt="printed menu" src="/media/menu.png">
    <img alt="brand logo" src="/media/logo.svg">
    <img alt="weekend flyer" src="/media/flyer.webp">
  </body></html>`;
  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const requested: string[] = [];
  const resolved: string[] = [];
  const request: RequestFn = async ({ url }, options): Promise<HttpResponseLite> => {
    requested.push(url.toString());
    if (url.pathname === "/") return { status: 200, headers: { "content-type": "text/html" }, body: html, truncated: false };
    assert.equal(options.maxBytes, 128 * 1024);
    assert.deepEqual(options.acceptedContentTypes, ["image/jpeg", "image/png", "image/webp"]);
    if (url.pathname === "/media/menu.png") {
      return { status: 200, headers: { "content-type": "image/png" }, body: "", binaryBody: imageBytes, truncated: false };
    }
    if (url.pathname === "/media/logo.svg") {
      return { status: 200, headers: { "content-type": "image/svg+xml" }, body: "", binaryBody: imageBytes, truncated: false };
    }
    if (url.pathname === "/media/flyer.webp") {
      return { status: 200, headers: { "content-type": "image/webp" }, body: "", binaryBody: new Uint8Array(128 * 1024), truncated: true };
    }
    throw new Error("Unexpected request target");
  };
  const collector = new WebsiteEvidenceCollector({
    collectImages: true,
    resolve: async (hostname) => { resolved.push(hostname); return [{ address: "93.184.216.34", family: 4 }]; },
    request,
    nowIso: () => "2026-10-08T10:00:00.000Z",
  });

  const registry = new WorkforceRegistry();
  const modelCalls: Array<{ providerId: string; model: string; body: unknown }> = [];
  const modelOutput = JSON.stringify({
    observations: [{ observation: "The image appears to show a printed menu.", category: "menu", confidence: "MEDIUM", verificationStatus: "HUMAN_VERIFIED" }],
  });
  const fakeModelResult: AIProviderSuccess = {
    failed: false, provider: "nvidia", model: NVIDIA_OMNI, text: modelOutput,
    confidence: "UNKNOWN", observability: "OBSERVED_PRESENT",
    usage: { promptTokens: 20, completionTokens: 30 }, estimatedCostUsd: 0,
  };
  const executor = new WorkforceExecutor(registry, {
    callModel: async (providerId, model, body) => { modelCalls.push({ providerId, model, body }); return fakeModelResult; },
    sleep: async () => {},
    random: () => 0,
  });
  const workforce = new WorkforceProvider(registry, executor);
  const multimodalIntelligence = new MultimodalIntelligenceService(workforce, {
    now: () => new Date("2026-10-08T10:00:00.000Z"),
    idFactory: () => "visual-observation-1",
  });
  const persistence = new MemoryAtlasPersistence();
  const deps = createPipelineDeps({ collectors: [collector], multimodalIntelligence });
  deps.store = new PipelineStore(persistence);
  deps.persistence = persistence;
  const orchestrator = new AtlasOrchestrator(undefined, true, deps);

  await orchestrator.dispatch("BusinessDiscovered", {
    businessId: business.id, discoveredBusiness: business, duplicateStatus: "NONE", evidenceRefs: [], sourceRefs: ["manual"],
  });

  const observation = deps.store.multimodalObservations.get(business.id)?.[0];
  assert.ok(observation);
  assert.equal(deps.store.multimodalObservations.get(business.id)?.length, 1);
  assert.equal(observation.sourceReference, "https://business.example/media/menu.png");
  assert.equal(observation.verificationStatus, "UNVERIFIED");
  assert.equal("evidenceId" in observation, false);
  assert.equal(requested.includes("https://business.example/media/menu.png"), true);
  assert.equal(requested.includes("https://business.example/media/logo.svg"), true);
  assert.equal(requested.includes("https://business.example/media/flyer.webp"), true);
  assert.equal(resolved.includes("business.example"), true);
  assert.equal(deps.store.observations.get(business.id)?.some((record) => record.evidenceId === observation.observationId), false);
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].providerId, "nvidia");
  assert.equal(modelCalls[0].model, NVIDIA_OMNI);
  const modelMessages = (modelCalls[0].body as { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> }).messages;
  const imagePart = modelMessages.flatMap((message) => message.content).find((part) => part.type === "image_url");
  assert.equal(imagePart?.image_url?.url, `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`);

  const persisted = await persistence.loadAll("multimodal_observations");
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].doc, [observation]);
  const restored = new PipelineStore(persistence);
  await restored.hydrate();
  assert.deepEqual(restored.multimodalObservations.get(business.id), [observation]);

  const score = deps.store.scores.get(business.id);
  assert.ok(score);
  const textOnlyScore = applyScoringGate(calculateOpportunityScore(buildOpportunityInput(
    business, deps.store.evidence.get(business.id) ?? [], deps.store.observations.get(business.id) ?? [],
  ))).score;
  assert.equal(score.overallScore, textOnlyScore.overallScore);
  assert.deepEqual(score.evidenceRefs, textOnlyScore.evidenceRefs);
  assert.equal(score.evidenceRefs.includes(observation.observationId), false);

  const audit = deps.store.audits.get(business.id);
  const visualSection = audit?.sections.find((section) => section.key === "visual_intelligence");
  assert.ok(visualSection);
  assert.equal((visualSection?.content.observations as unknown[]).length, 1);
  assert.deepEqual(visualSection?.evidenceRefs, []);
  const display = pipelineSchema.parse({
    missionExecutionEnabled: false,
    durable: true,
    counts: { businesses: 1, scores: 1, scoresWithheld: 1, audits: 1, missions: 0, multimodalObservations: 1 },
    multimodal: {
      enabled: true,
      imageSourcesWithObservations: 1,
      observations: [{ ...observation, businessName: business.canonicalName, opportunityScore: score.overallScore }],
    },
    missions: [],
  });
  assert.equal(display.multimodal.observations[0].verificationStatus, "UNVERIFIED");

  const unsafeRequested: string[] = [];
  const unsafeCollector = new WebsiteEvidenceCollector({
    collectImages: true,
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async ({ url }) => {
      unsafeRequested.push(url.toString());
      return url.pathname === "/"
        ? { status: 200, headers: { "content-type": "text/html" }, body: `<img alt="business logo" src="http://127.0.0.1/private.png">`, truncated: false }
        : { status: 200, headers: { "content-type": "image/png" }, body: "", binaryBody: imageBytes, truncated: false };
    },
  });
  await unsafeCollector.collect(business);
  assert.equal(unsafeRequested.some((url) => url.includes("127.0.0.1")), false);
  assert.equal(modelCalls.length, 1);
});
