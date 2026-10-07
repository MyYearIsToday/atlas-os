import test from "node:test";
import assert from "node:assert/strict";
import type { AIJobRequest, AIProviderResult, AIProviderSuccess } from "../../workforce/provider-types";
import { MultimodalIntelligenceService } from "./service";
import { WorkforceExecutor } from "../../../server/workforce/executor";
import { NVIDIA_OMNI, WorkforceRegistry } from "../../../server/workforce/registry";
import { WorkforceProvider } from "../../../server/workforce/workforce-provider";

const DATA_URL = `data:image/png;base64,${Buffer.from("mock-image-bytes").toString("base64")}`;
const SOURCE = "https://business.example/media/menu.png";

class RecordingWorkforceProvider extends WorkforceProvider {
  lastResult: AIProviderResult | null = null;
  override async execute(request: AIJobRequest): Promise<AIProviderResult> {
    this.lastResult = await super.execute(request);
    return this.lastResult;
  }
}

function mockedWorkforce(text: string | Error) {
  const registry = new WorkforceRegistry();
  const calls: Array<{ providerId: string; model: string; body: unknown }> = [];
  const workforceResult: AIProviderSuccess = {
    failed: false, provider: "nvidia", model: NVIDIA_OMNI, text: typeof text === "string" ? text : "",
    confidence: "UNKNOWN", observability: "OBSERVED_PRESENT",
    usage: { promptTokens: 20, completionTokens: 30 }, estimatedCostUsd: 0,
  };
  const executor = new WorkforceExecutor(registry, {
    callModel: async (providerId, model, body) => {
      calls.push({ providerId, model, body });
      if (text instanceof Error) throw text;
      return workforceResult;
    },
    sleep: async () => {},
    random: () => 0,
  });
  return { provider: new RecordingWorkforceProvider(registry, executor), calls };
}

const validOutput = JSON.stringify({
  observations: [{ observation: "The image appears to show a printed menu.", category: "menu", confidence: "MEDIUM", verificationStatus: "HUMAN_VERIFIED" }],
});

test("image analysis routes through the existing vision workforce and produces an unverified observation", async () => {
  const { provider, calls } = mockedWorkforce(validOutput);
  const service = new MultimodalIntelligenceService(provider, { now: () => new Date("2026-10-07T10:00:00.000Z"), idFactory: () => "obs-1" });
  const result = await service.analyze({ businessId: "business-1", sourceType: "image", sourceReference: SOURCE, mimeType: "image/png", dataUrl: DATA_URL, label: "menu" });

  assert.equal(result.status, "ANALYZED");
  assert.equal(result.observations.length, 1);
  assert.deepEqual(result.observations[0], {
    observationId: "obs-1", businessId: "business-1", observation: "The image appears to show a printed menu.",
    category: "menu", sourceType: "image", confidence: "MEDIUM", verificationStatus: "UNVERIFIED",
    sourceReference: SOURCE, createdAt: "2026-10-07T10:00:00.000Z",
  });
  assert.equal("evidenceId" in result.observations[0], false);
  assert.equal(JSON.stringify(result).includes(DATA_URL), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerId, "nvidia");
  assert.equal(calls[0].model, NVIDIA_OMNI);
  assert.ok(provider.lastResult && !provider.lastResult.failed);
  if (provider.lastResult && !provider.lastResult.failed) {
    assert.equal(provider.lastResult.workforce.employee, "vision_employee");
    assert.equal(provider.lastResult.workforce.routedBy, "media");
  }
});

test("unsupported video, audio, and document inputs are rejected without invoking a provider", async () => {
  const { provider, calls } = mockedWorkforce(validOutput);
  const service = new MultimodalIntelligenceService(provider);
  for (const sourceType of ["video", "audio", "document", "web"] as const) {
    const result = await service.analyze({ businessId: "business-1", sourceType, sourceReference: SOURCE, mimeType: "application/octet-stream", dataUrl: "not-used" });
    assert.equal(result.status, "UNSUPPORTED_MEDIA");
  }
  assert.equal(calls.length, 0);
});

test("malformed model output is discarded rather than persisted", async () => {
  const { provider } = mockedWorkforce("not-json");
  const service = new MultimodalIntelligenceService(provider);
  const result = await service.analyze({ businessId: "business-1", sourceType: "image", sourceReference: SOURCE, mimeType: "image/png", dataUrl: DATA_URL });
  assert.deepEqual(result, { status: "MALFORMED_OUTPUT", observations: [] });
});

test("provider errors are reduced to a safe status and never echo secret-like details", async () => {
  const secretMarker = "NVIDIA_API_KEY=secret-test-value";
  const { provider } = mockedWorkforce(new Error(secretMarker));
  const service = new MultimodalIntelligenceService(provider);
  const result = await service.analyze({ businessId: "business-1", sourceType: "image", sourceReference: SOURCE, mimeType: "image/png", dataUrl: DATA_URL });
  assert.equal(result.status, "PROVIDER_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

test("image request validation rejects unsafe references and non-image MIME/data", async () => {
  const { provider, calls } = mockedWorkforce(validOutput);
  const service = new MultimodalIntelligenceService(provider);
  const unsafe = await service.analyze({ businessId: "business-1", sourceType: "image", sourceReference: "https://user:pass@business.example/logo.png", mimeType: "image/png", dataUrl: DATA_URL });
  const wrongMime = await service.analyze({ businessId: "business-1", sourceType: "image", sourceReference: SOURCE, mimeType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" });
  assert.equal(unsafe.status, "INVALID_INPUT");
  assert.equal(wrongMime.status, "INVALID_INPUT");
  assert.equal(calls.length, 0);
});

test("the existing text-only workforce route still resolves the researcher role to Scout", async () => {
  const { provider, calls } = mockedWorkforce("ordinary text answer");
  const result = await provider.execute({
    workerRole: "researcher", task: "Research a business from text.", priority: 1,
    confidenceTarget: 0.5, budgetLimitUsd: 0.1, lineageId: "text-only-test",
  });
  assert.equal(result.failed, false);
  if (!result.failed) {
    assert.equal(result.workforce.employee, "scout");
    assert.equal(result.workforce.routedBy, "worker_role");
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "openrouter/free");
});
