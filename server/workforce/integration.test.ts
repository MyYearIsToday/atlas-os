import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createAiProxyServer } from "../ai-proxy-server";
import { OpenRouterProvider } from "../../src/workforce/openrouter-provider";
import { NvidiaProvider } from "../../src/workforce/nvidia-provider";
import { WorkforceProvider } from "./workforce-provider";
import { WorkforceRegistry, NVIDIA_ULTRA, NVIDIA_OMNI, type CatalogModel } from "./registry";
import { withWorkforceRouting, createWorkforceProxiedProvider } from "../../src/workforce/workforce-routing";
import { defaultWorkforceConfig } from "../../src/workforce/workforce-config";

const z = { prompt: "0", completion: "0" };
const cm = (id: string, o: Partial<CatalogModel> = {}): CatalogModel => ({ id, name: id, context_length: 32000, pricing: z, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: [], ...o });
const CATALOG = [cm("test/big", { context_length: 200000, supported_parameters: ["reasoning", "tools"] }), cm("test/alt", { context_length: 100000 }), cm("test/paid", { pricing: { prompt: "0.1", completion: "0.1" } })];

process.env.ATLAS_PROXY_SHARED_SECRET = "SENTINEL-SECRET-XYZ";
process.env.OPENROUTER_API_KEY = "SENTINEL-OR-KEY";
process.env.NVIDIA_API_KEY = "SENTINEL-NV-KEY";

const calls: Array<{ url: string; model: string; messages: any }> = [];
let failFirstOpenRouter = false;
const upstream = (async (url: string, init: any) => {
  const b = JSON.parse(init.body);
  calls.push({ url, model: b.model, messages: b.messages });
  if (url.includes("openrouter") && failFirstOpenRouter) { failFirstOpenRouter = false; return { ok: false, status: 429, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({ model: b.model, choices: [{ message: { content: `ok:${b.model}` } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) };
}) as unknown as typeof fetch;

async function boot() {
  const legacy = {
    openrouter: new OpenRouterProvider({ defaultModel: "legacy-or", fetchImpl: upstream }),
    nvidia: new NvidiaProvider({ defaultModel: "legacy-nv", fetchImpl: upstream }),
  };
  const registry = await WorkforceRegistry.create({ fetchImpl: (async () => ({ ok: true, json: async () => ({ data: CATALOG }) })) as any });
  const wf = new WorkforceProvider(registry, new (await import("./executor")).WorkforceExecutor(registry, { callModel: (await import("./workforce-provider")).providerCallModel(legacy), sleep: async () => {} }));
  const server = createAiProxyServer({ ...legacy, workforce: wf });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, auth = true) => fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { "x-atlas-proxy-secret": "SENTINEL-SECRET-XYZ" } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
  return { base, post, server, registry };
}
const req = (o: any = {}) => ({ workerRole: "researcher", task: "hello", priority: 1, confidenceTarget: 0.5, budgetLimitUsd: 1, lineageId: "L1", ...o });

test("Sprint 5F integration over real loopback HTTP", async () => {
  const { base, post, server } = await boot();
  const get = (p: string, auth = true) => fetch(base + p, { headers: auth ? { "x-atlas-proxy-secret": "SENTINEL-SECRET-XYZ" } : {} }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

  // health public, includes workforce, no secrets
  const h = await get("/api/ai/health", false);
  assert.equal(h.status, 200);
  assert.ok(h.body.providers.some((p: any) => p.provider === "workforce"));
  assert.ok(!JSON.stringify(h.body).includes("SENTINEL"));

  // legacy path unchanged: uses provider default model, not workforce
  calls.length = 0;
  let r = await post({ providerId: "openrouter", request: req({ model: "legacy-or" }) });
  assert.equal(r.status, 200); assert.equal(calls[0]!.model, "legacy-or"); assert.equal(r.body.workforce, undefined);

  // researcher -> Scout (dynamic OpenRouter, zero-priced only)
  calls.length = 0;
  r = await post({ providerId: "workforce", request: req({ workerRole: "researcher" }) });
  assert.equal(r.body.failed, false); assert.equal(r.body.workforce.employee, "scout"); assert.equal(r.body.model, "test/big"); assert.notEqual(calls[0]!.model, "test/paid");

  // explicit CEO -> NVIDIA Ultra via NVIDIA endpoint
  calls.length = 0;
  r = await post({ providerId: "workforce", request: req({ employee: "ceo_master_planner" }) });
  assert.equal(r.body.provider, "nvidia"); assert.equal(calls[0]!.model, NVIDIA_ULTRA); assert.ok(calls[0]!.url.includes("integrate.api.nvidia.com"));

  // planner role -> CEO; analyst -> business_analyst; writer -> writer
  for (const [role, emp] of [["planner", "ceo_master_planner"], ["analyst", "business_analyst"], ["writer", "writer"]] as const) {
    r = await post({ providerId: "workforce", request: req({ workerRole: role }) });
    assert.equal(r.body.workforce.employee, emp, role);
  }

  // image -> Vision Employee (Omni) with the image part forwarded intact
  calls.length = 0;
  const messages = [{ role: "user", content: [{ type: "text", text: "read" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }];
  r = await post({ providerId: "workforce", request: req({ workerRole: "analyst", messages }) });
  assert.equal(r.body.workforce.employee, "vision_employee"); assert.equal(calls[0]!.model, NVIDIA_OMNI);
  assert.equal(calls[0]!.messages[0].content[1].type, "image_url");

  // 429 on OpenRouter -> graceful fallback, request still succeeds
  calls.length = 0; failFirstOpenRouter = true;
  r = await post({ providerId: "workforce", request: req({ workerRole: "researcher" }) });
  assert.equal(r.body.failed, false); assert.ok(calls.length >= 2);

  // finance never routed to free workforce
  calls.length = 0;
  r = await post({ providerId: "workforce", request: req({ workerRole: "finance" }) });
  assert.equal(r.body.failed, true); assert.equal(calls.length, 0);

  // clear errors
  r = await post({ providerId: "bogus", request: req() }); assert.equal(r.status, 400); assert.match(r.body.reason, /workforce/);
  r = await post({ providerId: "workforce", request: req({ employee: "nobody" }) }); assert.equal(r.body.failed, true); assert.match(r.body.reason, /unknown employee/);
  r = await post({ providerId: "workforce", request: req({ employee: "future_falconfx_worker" }) }); assert.match(r.body.reason, /EMPLOYEE_DISABLED/);

  // auth gate covers execute and registry; registry view has no secrets
  assert.equal((await post({ providerId: "workforce", request: req() }, false)).status, 401);
  assert.equal((await get("/api/ai/workforce", false)).status, 401);
  const reg = await get("/api/ai/workforce");
  assert.equal(reg.status, 200); assert.equal(reg.body.employees.length, 10);
  assert.ok(!JSON.stringify([reg.body, r.body]).includes("SENTINEL"));

  // client wiring: opt-in config keeps defaults untouched, finance excluded
  const cfg = withWorkforceRouting(defaultWorkforceConfig);
  assert.deepEqual(cfg.workerProviderMap.planner, ["workforce", "openrouter", "nvidia"]);
  assert.deepEqual(cfg.workerProviderMap.finance, ["openrouter"]);
  assert.deepEqual(defaultWorkforceConfig.workerProviderMap.planner, ["openrouter", "nvidia"]);
  const client = createWorkforceProxiedProvider(base);
  assert.equal(client.id, "workforce");

  await new Promise((res) => server.close(res));
});
