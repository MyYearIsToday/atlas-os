import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkforceRegistry, buildWorkforce, verifyRegistry, isZeroPriced,
  NVIDIA_ULTRA, NVIDIA_OMNI, OPENROUTER_FREE_ROUTER, type CatalogModel,
} from "./registry";
import { routeTask, detectMedia, type ChatMessage } from "./router";
import { WorkforceExecutor, ProviderError, WorkforceError, type CallModel } from "./executor";
import { formatRegistry } from "./print-registry";

// MOCK catalog: fabricated "test/..." IDs, NOT real OpenRouter data.
const z = { prompt: "0", completion: "0" };
const m = (id: string, o: Partial<CatalogModel> = {}): CatalogModel => ({
  id, name: id, context_length: 32000, pricing: z,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: [], ...o,
});
const CATALOG: CatalogModel[] = [
  m("test/alpha-reasoner", { context_length: 200000, supported_parameters: ["reasoning", "tools"] }),
  m("test/beta-longctx", { context_length: 1000000, supported_parameters: ["tools"] }),
  m("test/gamma-flash-4b", { context_length: 32000, supported_parameters: ["tools"] }),
  m("test/zeta-nano-1b", { context_length: 8000 }),
  m("test/delta-coder-32b", { context_length: 128000, description: "A coding agent model", supported_parameters: ["tools"] }),
  m("test/eps-vision-27b", { context_length: 64000, supported_parameters: ["reasoning"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } }),
  m("test/paid-model", { pricing: { prompt: "0.000001", completion: "0.000002" } }),
  m("test/router-negative", { pricing: { prompt: "-1", completion: "-1" } }),
  m("test/half-free", { pricing: { prompt: "0", completion: "0.000001" } }),
  m("test/embed-model", { architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] } }),
  m("test/image-only-in", { architecture: { input_modalities: ["image"], output_modalities: ["text"] } }),
  m("test/image-gen", { architecture: { input_modalities: ["text"], output_modalities: ["image"] } }),
  m("openrouter/free", { context_length: 200000 }),
];

const msgs: ChatMessage[] = [{ role: "user", content: "hi" }];
const imgMsgs: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: "read" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }];

async function registry(catalog: CatalogModel[] | "fail") {
  const fetchImpl = (async () => {
    if (catalog === "fail") throw new Error("offline");
    return { ok: true, json: async () => ({ data: catalog }) };
  }) as unknown as typeof fetch;
  return WorkforceRegistry.create({ fetchImpl });
}

test("catalog filter keeps only prompt==='0' && completion==='0'", () => {
  assert.equal(isZeroPriced(m("a")), true);
  for (const id of ["test/paid-model", "test/router-negative", "test/half-free"]) assert.equal(isZeroPriced(CATALOG.find((c) => c.id === id)!), false);
});

test("dynamic registry: assignments, fixed NVIDIA IDs, zero pricing, disabled placeholder", async () => {
  const reg = await registry(CATALOG);
  console.log("\n--- MOCK-CATALOG registry (fabricated test data) ---\n" + formatRegistry(reg) + "\n");
  const get = (e: string) => reg.get(e)!;
  assert.equal(get("ceo_master_planner").model, NVIDIA_ULTRA);
  assert.equal(get("ceo_master_planner").source, "fixed");
  assert.equal(get("vision_employee").model, NVIDIA_OMNI);
  assert.equal(get("document_analyst").model, NVIDIA_OMNI);
  assert.equal(get("scout").model, "test/alpha-reasoner");
  assert.equal(get("writer").model, "test/beta-longctx");
  assert.equal(get("fast_worker").model, "test/zeta-nano-1b");
  assert.notEqual(get("mission_router").model, get("fast_worker").model); // rate-limit spreading
  assert.equal(get("coding_engineer").model, "test/delta-coder-32b");
  assert.equal(get("vision_employee").chain[1]!.model, "test/eps-vision-27b"); // multimodal fallback
  assert.equal(get("future_falconfx_worker").enabled, false);
  for (const c of verifyRegistry(reg)) assert.equal(c.pass, true, c.name + " " + (c.detail ?? ""));
  for (const e of reg.list()) for (const c of e.chain) if (c.providerId === "openrouter" && c.model !== OPENROUTER_FREE_ROUTER) {
    const src = CATALOG.find((x) => x.id === c.model)!;
    assert.equal(src.pricing!.prompt, "0"); assert.equal(src.pricing!.completion, "0");
  }
});

test("no coding model -> NVIDIA Ultra; catalog offline -> static registry, still boots", async () => {
  const noCoder = buildWorkforce(CATALOG.filter((c) => c.id !== "test/delta-coder-32b"));
  const coder = noCoder.find((e) => e.employee === "coding_engineer")!;
  assert.equal(coder.model, NVIDIA_ULTRA); assert.equal(coder.source, "static-fallback");
  const reg = await registry("fail");
  assert.equal(reg.catalogStatus, "unavailable");
  assert.equal(reg.get("scout")!.model, OPENROUTER_FREE_ROUTER);
  assert.equal(reg.get("scout")!.fallback, NVIDIA_ULTRA);
  assert.equal(reg.get("ceo_master_planner")!.model, NVIDIA_ULTRA);
  for (const c of verifyRegistry(reg)) assert.equal(c.pass, true, c.name);
});

test("routing", () => {
  const r = (i: Parameters<typeof routeTask>[0]) => routeTask(i).employee;
  assert.equal(r({ taskType: "research" }), "scout");
  assert.equal(r({ taskType: "opportunity_analysis" }), "business_analyst");
  assert.equal(r({ taskType: "long_reasoning" }), "ceo_master_planner");
  assert.equal(r({ taskType: "quick_response" }), "fast_worker");
  assert.equal(r({ taskType: "coding" }), "coding_engineer");
  assert.equal(r({ media: ["image"] }), "vision_employee");
  assert.equal(r({ media: ["file"] }), "document_analyst");
  assert.equal(r({ taskType: "research", media: ["image"] }), "vision_employee"); // media beats task type
  assert.equal(r({}), "fast_worker");
  assert.throws(() => routeTask({ employee: "nobody" }), /Unknown employee/);
  assert.deepEqual(detectMedia(imgMsgs), ["image"]);
});

function harness(script: Array<Error | "ok">, catalog = CATALOG) {
  const calls: string[] = []; const sleeps: number[] = []; let refreshes = 0;
  const reg = { get: (e: string) => registryFor.get(e), requestRefresh: () => { refreshes++; } };
  const registryFor = new WorkforceRegistry(); (registryFor as any).apply(catalog);
  let i = 0;
  const callModel: CallModel = async (p, model) => {
    calls.push(`${p}:${model}`);
    const s = script[Math.min(i++, script.length - 1)]!;
    if (s === "ok") return { choices: [{ message: { content: "done" } }] };
    throw s;
  };
  const ex = new WorkforceExecutor(reg, { callModel, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
  return { ex, calls, sleeps, get refreshes() { return refreshes; } };
}

test("429 with short Retry-After: waits, retries the SAME model, succeeds (no escalation)", async () => {
  const h = harness([new ProviderError("rate_limit", 429, "slow down", 2000), "ok"]);
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.usedFallback, false); assert.deepEqual(h.sleeps, [2000]);
  assert.equal(new Set(h.calls).size, 1);
});

test("429 with long Retry-After: escalates to next model without waiting", async () => {
  const h = harness([new ProviderError("rate_limit", 429, "daily limit", 60000), "ok"]);
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.usedFallback, true); assert.deepEqual(h.sleeps, []); assert.equal(h.calls.length, 2);
});

test("404 (model disappeared): sidelined, catalog refresh requested, next model used", async () => {
  const h = harness([new ProviderError("not_found", 404, "no such model"), "ok"]);
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.usedFallback, true); assert.equal(h.refreshes, 1);
  await h.ex.execute({ employee: "scout", messages: msgs }); // cooled model is tried last now
  assert.notEqual(h.calls[2], h.calls[0]);
});

test("OpenRouter auth failure skips remaining OpenRouter models and escalates to NVIDIA Ultra", async () => {
  const h = harness([new ProviderError("auth", 401, "bad key"), "ok"]);
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.providerId, "nvidia"); assert.equal(r.model, NVIDIA_ULTRA);
  assert.equal(h.calls.filter((c) => c.startsWith("openrouter")).length, 1);
});

test("5xx retried once then escalates; all failing -> ALL_MODELS_UNAVAILABLE with trace", async () => {
  const h = harness([new ProviderError("server", 503, "down")]);
  await assert.rejects(h.ex.execute({ employee: "fast_worker", messages: msgs }), (e: WorkforceError) =>
    e.code === "ALL_MODELS_UNAVAILABLE" && e.httpStatus === 503 && e.attempts.length >= 2);
});

test("plain bad_request is terminal (does not burn every free model)", async () => {
  const h = harness([new ProviderError("bad_request", 400, "invalid field foo")]);
  await assert.rejects(h.ex.execute({ employee: "scout", messages: msgs }), (e: WorkforceError) => e.code === "BAD_REQUEST");
  assert.equal(h.calls.length, 1);
});

test("image request never falls back to text-only models; text-only employee -> NO_CAPABLE_MODEL", async () => {
  const h = harness([new ProviderError("server", 500, "x")]);
  await assert.rejects(h.ex.execute({ employee: "vision_employee", messages: imgMsgs }), () => true);
  assert.ok(h.calls.every((c) => c.includes("nemotron-3-nano-omni") || c.includes("eps-vision")));
  await assert.rejects(h.ex.execute({ employee: "ceo_master_planner", messages: imgMsgs }), (e: WorkforceError) => e.code === "NO_CAPABLE_MODEL" || e.code === "ALL_MODELS_UNAVAILABLE");
});

test("unknown / disabled employee return clear errors", async () => {
  const h = harness(["ok"]);
  await assert.rejects(h.ex.execute({ employee: "nobody", messages: msgs }), (e: WorkforceError) => e.code === "EMPLOYEE_NOT_FOUND" && e.httpStatus === 404);
  await assert.rejects(h.ex.execute({ employee: "future_falconfx_worker", messages: msgs }), (e: WorkforceError) => e.code === "EMPLOYEE_DISABLED");
});

test("secrets never appear in errors or traces", async () => {
  process.env.OPENROUTER_API_KEY = "SENTINEL-OR-KEY-123"; process.env.NVIDIA_API_KEY = "SENTINEL-NV-KEY-456";
  const h = harness([new ProviderError("server", 500, "boom")]);
  try { await h.ex.execute({ employee: "scout", messages: msgs }); } catch (e) {
    const s = JSON.stringify(e);
    assert.ok(!s.includes("SENTINEL"));
  }
  const dump = JSON.stringify((await registry(CATALOG)).list());
  assert.ok(!dump.includes("SENTINEL"));
  delete process.env.OPENROUTER_API_KEY; delete process.env.NVIDIA_API_KEY;
});

// --- OpenRouter 403 classification fix (401/402=account-level auth; 403=model-specific "forbidden") ---
import { classify as _classify } from "./executor";

test("classify(): 401/402 are account-level auth; 403 is model-specific forbidden, not auth", () => {
  assert.equal(_classify(401), "auth");
  assert.equal(_classify(402), "auth");
  assert.equal(_classify(403), "forbidden");
  assert.equal(_classify(429), "rate_limit");
  assert.equal(_classify(502), "server");
  assert.equal(_classify(503), "server");
});

test("403 (forbidden) on one OpenRouter model: tries the NEXT OpenRouter model, does not skip straight to NVIDIA", async () => {
  const h = harness([new ProviderError("forbidden", 403, "model requires moderation"), "ok"]);
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.providerId, "openrouter"); // stayed on OpenRouter
  assert.equal(h.calls.length, 2);
  assert.notEqual(h.calls[0], h.calls[1]); // different model, not a bare retry of the same one
});

test("401 (real auth failure): skips ALL remaining OpenRouter models immediately, escalates to NVIDIA", async () => {
  const h = harness([new ProviderError("auth", 401, "invalid api key"), "ok"]);
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.providerId, "nvidia");
  assert.equal(h.calls.filter((c) => c.startsWith("openrouter")).length, 1); // no retries burned on other OR models
});

test("402 (insufficient credits): also account-level, skips remaining OpenRouter models", async () => {
  const h = harness([new ProviderError("auth", 402, "insufficient credits")]);
  const r = await harness([new ProviderError("auth", 402, "insufficient credits"), "ok"]).ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.providerId, "nvidia");
});

test("403 on every eligible OpenRouter model, then NVIDIA succeeds: full graceful degradation, matches the real production trace shape", async () => {
  // 403 every OpenRouter entry in scout's chain (dynamic alternates + openrouter/free), then NVIDIA succeeds.
  const scoutChain = buildWorkforce(CATALOG).find((e) => e.employee === "scout")!.chain;
  const openrouterSlots = scoutChain.filter((c) => c.providerId === "openrouter").length;
  const h = harness(Array(openrouterSlots).fill(new ProviderError("forbidden", 403, "flagged")).concat(["ok"]));
  const r = await h.ex.execute({ employee: "scout", messages: msgs });
  assert.equal(r.providerId, "nvidia");
  assert.ok(r.attempts.filter((a) => a.providerId === "openrouter").length >= 1);
  assert.ok(r.attempts.every((a) => a.outcome !== "auth")); // none of these were misclassified as account-level
  assert.ok(r.attempts.filter((a) => a.providerId === "openrouter").every((a) => a.outcome === "forbidden"));
});
