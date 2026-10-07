import test from "node:test";
import assert from "node:assert/strict";
import { AtlasOrchestrator } from "./orchestrator";
import { createPipelineDeps } from "./atlas-pipeline";
import type { BusinessIntelligence } from "../services/evidence/business-intelligence";

test("multimodal observations persist separately, reach the audit, and do not enter evidence or scoring", async () => {
  const business: BusinessIntelligence = {
    id: "business-visual-test", canonicalName: "Test Café", aliases: [], category: "cafe", categories: ["cafe"], status: "ACTIVE",
    website: "https://business.example", socialLinks: [], services: [], products: [], sourceReferences: ["manual"],
    evidenceReferences: [], createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z",
  };
  const media = {
    sourceType: "image" as const, sourceReference: "https://business.example/menu.png", mimeType: "image/png" as const,
    dataUrl: "data:image/png;base64,bW9jaw==", label: "menu",
  };
  const deps = createPipelineDeps({
    collectors: [{
      source: "test-media",
      collect: async () => ({ source: "test-media", status: "COLLECTED", records: [], media: [media] }),
    }],
    multimodalIntelligence: {
      analyze: async (input) => ({
        status: "ANALYZED",
        observations: [{
          observationId: "observation-1", businessId: input.businessId,
          observation: "The image appears to show a printed menu.", category: "menu", sourceType: "image",
          confidence: "MEDIUM", verificationStatus: "UNVERIFIED", sourceReference: input.sourceReference,
          createdAt: "2026-10-07T10:00:00.000Z",
        }],
      }),
    },
  });
  const orchestrator = new AtlasOrchestrator(undefined, true, deps);

  await orchestrator.dispatch("BusinessDiscovered", {
    businessId: business.id, discoveredBusiness: business, duplicateStatus: "NONE", evidenceRefs: [], sourceRefs: ["manual"],
  });

  const visual = deps.store.multimodalObservations.get(business.id);
  assert.equal(visual?.length, 1);
  assert.equal(visual?.[0].verificationStatus, "UNVERIFIED");
  assert.deepEqual(deps.store.observations.get(business.id), []);
  const score = deps.store.scores.get(business.id);
  assert.ok(score);
  assert.equal(score.overallScore, null);
  assert.equal(score.evidenceRefs.includes("observation-1"), false);
  const audit = deps.store.audits.get(business.id);
  assert.ok(audit);
  const visualSection = audit.sections.find((section) => section.key === "visual_intelligence");
  assert.ok(visualSection);
  assert.equal((visualSection.content.observations as unknown[]).length, 1);
  assert.equal(visualSection.evidenceRefs.includes("observation-1"), false);
});
