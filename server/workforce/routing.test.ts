import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkforce, WorkforceRegistry, qualityScore, toCandidate, type CatalogModel } from "./registry";
import { routeTask } from "./router";
import { ProviderError, WorkforceExecutor, type CallModel } from "./executor";
import { WorkforceProvider, withFreeWorkforceRouting, withWorkforceRouting } from "./workforce-provider";
import { runAiJob } from "../../src/workforce/ai-job";
import { ProviderRegistry } from "../../src/workforce/provider-registry";
import { defaultWorkforceConfig } from "../../src/workforce/workforce-config";
import { describeRouting } from "../../src/orchestrator/mission-runner";
import { MISSION_TASK_TYPE } from "../../src/orchestrator/autonomous-workforce";
import type { AIProvider } from "../../src/workforce/provider-interface";
import type { AIJobRequest, AIProviderResult } from "../../src/workforce/provider-types";

// MOCK catalog with fabricated ids shaped like real ones. Not live OpenRouter data.
const z = { prompt: "0", completion: "0" };
const m = (id: string, o: Partial<CatalogModel> = {}): CatalogModel => ({ id, name: id, context_length: 128000, pricing: z, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: [], ...o });
const CATALOG: CatalogModel[] = [
  m("vendor/tiny-instruct-8b:free", { supported_parameters: ["tools"] }),
  m("vendor/deepseek-r1-671b:free", { context_length: 163000, supported_parameters: ["reasoning", "tools"] }),
  m("vendor/llama-3.3-70b-instruct:free", { supported_parameters: ["tools"] }),
  m("vendor/qwen3-235b-a22b:free", { context_length: 131000, supported_parameters: ["reasoning", "tools"] }),
  m("vendor/small-1b:free", { context_length: 8000 }),
  m("vendor/paid-giant-405b", { pricing: { prompt: "0.000002", completion: "0.000002" }, supported_parameters: ["reasoning", "tools"] }),
];

test("quality ranking: strong reasoning models lead deep roles; tiny and paid models never do", () => {
  const wf = buildWorkforce(CATALOG);
  const by = (e: string) => wf.find((x) => x.employee === e)!;
  for (const e of ["scout", "business_analyst", "writer"]) {
    const head = by(e).chain[0]!.model;
    assert.ok(!/tiny|small-1b|paid/.test(head), `${e} led by ${head}`);
  }
  assert.ok(["vendor/deepseek-r1-671b:free", "vendor/qwen3-235b-a22b:free"].includes(by("scout").chain[0]!.model));
  assert.notEqual(by("scout").chain[0]!.model, by("business_analyst").chain[0]!.model);
  const s = (id: string) => qualityScore(toCandidate(CATALOG.find((c) => c.id === id)!)!, "deep");
  assert.ok(s("vendor/deepseek-r1-671b:free") > s("vendor/llama-3.3-70b-instruct:free"));
  assert.ok(s("vendor/llama-3.3-70b-instruct:free") > s("vendor/tiny-instruct-8b:free"));
  for (const e of wf) for (const c of e.chain) assert.ok(!c.model.includes("paid-giant"), "paid model must never be in any chain");
});

test("every mission task type routes to a capable employee, and different stages use different employees", () => {
  const emp = (t: string) => routeTask({ taskType: t }).employee;
  assert.equal(emp("deep_research"), "scout");
  assert.equal(emp("competitor_analysis"), "business_analyst");
  assert.equal(emp("market_analysis"), "business_analyst");
  assert.equal(emp("strategy"), "ceo_master_planner");
  assert.equal(emp("reasoning"), "ceo_master_planner");
  assert.equal(emp("writing"), "writer");
  assert.equal(emp("image_generation"), "image_designer");
  assert.equal(routeTask({ media: ["image"] }).employee, "vision_employee");
  const stageEmployees = new Set(Object.values(MISSION_TASK_TYPE).map(emp));
  assert.ok(stageEmployees.size >= 4, `dossier stages should use several employees, got ${[...stageEmployees]}`);
});

test("image generation: unavailable (not faked) without a free image-output model; routed when one exists", () => {
  const none = buildWorkforce(CATALOG).find((e) => e.employee === "image_designer")!;
  assert.equal(none.enabled, false); assert.match(none.note ?? "", /No zero-priced image-generation model/);
  const withImg = buildWorkforce([...CATALOG, m("vendor/img-gen:free", { architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] } }), m("vendor/img-paid", { pricing: { prompt: "0", completion: "0.01" }, architecture: { input_modalities: ["text"], output_modalities: ["image"] } })]).find((e) => e.employee === "image_designer")!;
  assert.equal(withImg.enabled, true); assert.deepEqual(withImg.chain.map((c) => c.model), ["vendor/img-gen:free"]);
});

// ---- executor: failure + fallback, honest recording ----
async function reg() { return WorkforceRegistry.create({ fetchImpl: (async () => ({ ok: true, json: async () => ({ data: CATALOG }) })) as unknown as typeof fetch }); }
const ok = (model: string) => ({ failed: false, provider: "openrouter", model, text: `answer from ${model} that is long enough`, confidence: "UNKNOWN", observability: "OBSERVED_PRESENT", usage: { promptTokens: 1, completionTokens: 1 }, estimatedCostUsd: 0 });

test("fallback is recorded: first choice, failed attempts with reasons, and the model that ACTUALLY answered", async () => {
  const registry = await reg();
  const first = registry.get("scout")!.chain[0]!;
  const calls: string[] = [];
  const callModel: CallModel = async (providerId, model) => {
    calls.push(`${providerId}/${model}`);
    if (model === first.model) throw new ProviderError("timeout", null, "request timed out");
    return ok(model);
  };
  const wf = new WorkforceProvider(registry, new WorkforceExecutor(registry, { callModel, sleep: async () => {} }));
  const r = await wf.execute({ workerRole: "researcher", taskType: "deep_research", task: "t", priority: 1, confidenceTarget: 0.5, budgetLimitUsd: 1, lineageId: "L" } as AIJobRequest) as any;
  assert.equal(r.failed, false);
  assert.notEqual(r.model, first.model, "must report the fallback model, never the first choice");
  assert.equal(r.workforce.usedFallback, true);
  assert.equal(r.workforce.selected.model, first.model);
  assert.equal(r.workforce.employee, "scout"); assert.equal(r.workforce.taskType, "deep_research");
  assert.ok(r.workforce.attempts.some((a: any) => a.model === first.model && a.outcome === "timeout"));
  assert.equal(r.workforce.attempts.at(-1).outcome, "ok");
  const d = describeRouting(r, "deep_research");
  assert.match(d.label, /FALLBACK; first choice was/); assert.ok(d.label.startsWith(`openrouter/${r.model}`));
  assert.equal(d.record.actual.model, r.model); assert.equal(d.record.selected!.model, first.model);
});

// ---- root-cause regression: a failing Workforce must not become Llama ----
function legacy(id: "openrouter" | "nvidia", log: string[]): AIProvider {
  return {
    id, validate: () => ({ valid: true, errors: [] }), estimateCost: () => null, estimateTokens: () => null,
    healthCheck: async () => ({ provider: id, healthy: true, checkedAt: "" }),
    execute: async (rq: AIJobRequest): Promise<AIProviderResult> => { log.push(`${id}/${rq.model}`); return ok(rq.model ?? "none") as AIProviderResult; },
  };
}
const REQ: AIJobRequest = { workerRole: "researcher", taskType: "deep_research", task: "t", priority: 1, confidenceTarget: 0.65, budgetLimitUsd: 1, lineageId: "L" };

async function failingWorkforce(log: string[]) {
  const registry = await reg();
  const callModel: CallModel = async (p, model) => { log.push(`wf:${p}/${model}`); throw new ProviderError("timeout", null, "request timed out"); };
  return new WorkforceProvider(registry, new WorkforceExecutor(registry, { callModel, sleep: async () => {}, totalBudgetMs: 10_000_000 }));
}

test("REGRESSION (root cause): with the old tiering a Workforce failure silently ends on the default Llama model", async () => {
  const log: string[] = []; const pr = new ProviderRegistry();
  pr.registerProvider(legacy("openrouter", log)); pr.registerProvider(legacy("nvidia", log)); pr.registerProvider(await failingWorkforce(log));
  const out = await runAiJob(REQ, pr, withWorkforceRouting(defaultWorkforceConfig, true));
  // Documents the bug the dossier hit: the answer came from plain openrouter's default Llama after the Workforce failed.
  assert.equal(out.result.failed, false);
  assert.equal((out.result as any).model, "meta-llama/llama-3.1-8b-instruct");
});

test("FIX: free-only exclusive routing -> the Workforce failure is reported with every attempt; no Llama, no other provider", async () => {
  const log: string[] = []; const pr = new ProviderRegistry();
  pr.registerProvider(legacy("openrouter", log)); pr.registerProvider(legacy("nvidia", log)); pr.registerProvider(await failingWorkforce(log));
  const cfg = withFreeWorkforceRouting(defaultWorkforceConfig, true);
  assert.deepEqual(cfg.workerProviderMap.researcher, ["workforce"]);
  assert.deepEqual(cfg.workerProviderMap.finance, defaultWorkforceConfig.workerProviderMap.finance, "finance is untouched");
  assert.equal(cfg.modelDefaults.openrouter, "openrouter/free", "no paid default model remains");
  const out = await runAiJob(REQ, pr, cfg);
  assert.equal(out.result.failed, true);
  assert.ok(!log.some((l) => !l.startsWith("wf:")), `only workforce models may be called: ${log.join(", ")}`);
  assert.match((out.result as any).reason, /failed \(.*timeout/);
  assert.equal(out.trail.length, 1, "the Workforce is not retried as 'low confidence'");
  assert.equal(out.trail[0]!.ok, false);
  assert.ok((out.result as any).workforce.attempts.length >= 2, "every chain attempt is kept on the failure");
});

test("FIX: a successful Workforce run carries its tier trail and is accepted without escalation", async () => {
  const registry = await reg(); const pr = new ProviderRegistry();
  const wf = new WorkforceProvider(registry, new WorkforceExecutor(registry, { callModel: async (_p, model) => ok(model), sleep: async () => {} }));
  pr.registerProvider(wf);
  const out = await runAiJob(REQ, pr, withFreeWorkforceRouting(defaultWorkforceConfig, true));
  assert.equal(out.result.failed, false); assert.equal(out.escalations, 0);
  assert.deepEqual(out.trail.map((t) => [t.providerId, t.ok]), [["workforce", true]]);
  assert.equal((out.result as any).workforce.usedFallback, false);
});
