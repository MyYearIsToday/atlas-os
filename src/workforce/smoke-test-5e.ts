import { createAiProxyServer } from "../../server/ai-proxy-server";
import { OpenRouterProvider } from "../workforce/openrouter-provider";
import { checkDailyBudget } from "../workforce/cost-guard";
import { runAiJob } from "../workforce/ai-job";
import { ProviderRegistry } from "../workforce/provider-registry";
import { defaultWorkforceConfig } from "../workforce/workforce-config";
import { OperationalLedger } from "../services/finance/ledger";
import { recordAiCost, buildCostRecord } from "../workforce/cost-tracker";
import type { AIProvider } from "../workforce/provider-interface";
import type { AIJobRequest } from "../workforce/provider-types";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const fakeSuccessFetch: typeof fetch = async () => new Response(JSON.stringify({
  model: "m", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 5 },
}), { status: 200 });

const baseRequest: AIJobRequest = {
  workerRole: "researcher", task: "test task", priority: 50, confidenceTarget: 0, budgetLimitUsd: 1, lineageId: "l1",
};

// ---------- Server: auth, CORS, malformed payloads, body size ----------
process.env.ATLAS_PROXY_SHARED_SECRET = "test-secret-123";
process.env.ATLAS_ALLOWED_ORIGIN = "https://app.example.com";
const providers: Record<string, AIProvider> = { openrouter: new OpenRouterProvider({ defaultModel: "m", apiKey: "k", fetchImpl: fakeSuccessFetch, costPerThousandTokensUsd: 0.1 }) };
const server = createAiProxyServer(providers);
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;

const noAuth = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "openrouter", request: baseRequest }) });
check("a request without the shared secret is rejected with 401", noAuth.status === 401);

const withAuth = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json", "x-atlas-proxy-secret": "test-secret-123" }, body: JSON.stringify({ providerId: "openrouter", request: baseRequest }) });
check("a request with the correct shared secret succeeds", withAuth.status === 200);

const wrongAuth = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json", "x-atlas-proxy-secret": "wrong" }, body: JSON.stringify({ providerId: "openrouter", request: baseRequest }) });
check("a request with the wrong shared secret is rejected", wrongAuth.status === 401);

const healthNoAuth = await fetch(`${base}/api/ai/health`);
check("health check does not require the shared secret (Render's health checker sends no custom headers)", healthNoAuth.status === 200);

const allowedOrigin = await fetch(`${base}/api/ai/health`, { headers: { Origin: "https://app.example.com" } });
check("an allowlisted origin gets a matching CORS header", allowedOrigin.headers.get("access-control-allow-origin") === "https://app.example.com");
const disallowedOrigin = await fetch(`${base}/api/ai/health`, { headers: { Origin: "https://evil.example.com" } });
check("a non-allowlisted origin gets no CORS header (deny-by-default, not reflected blindly)", disallowedOrigin.headers.get("access-control-allow-origin") === null);

const malformed = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json", "x-atlas-proxy-secret": "test-secret-123" }, body: JSON.stringify({ providerId: "openrouter" }) });
check("a request missing the job payload is rejected with 400, not a crash", malformed.status === 400);

const unknownProvider = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json", "x-atlas-proxy-secret": "test-secret-123" }, body: JSON.stringify({ providerId: "made-up", request: baseRequest }) });
check("an unknown providerId is rejected with 400", unknownProvider.status === 400);

const tooLarge = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json", "x-atlas-proxy-secret": "test-secret-123" }, body: JSON.stringify({ providerId: "openrouter", request: { ...baseRequest, task: "x".repeat(300_000) } }) });
check("an oversized request body is rejected (413), not accepted or hung", tooLarge.status === 413);

const notFoundNoAuth = await fetch(`${base}/not-a-real-route`);
check("an unauthenticated request to an unknown route gets 401, not 404 — deliberately, so an unauthenticated caller can't use 404-vs-401 to map valid routes", notFoundNoAuth.status === 401);
const notFoundWithAuth = await fetch(`${base}/not-a-real-route`, { headers: { "x-atlas-proxy-secret": "test-secret-123" } });
check("an authenticated request to an unknown route returns a structured 404, not a stack trace", notFoundWithAuth.status === 404);

server.close();

// ---------- Cost guard: enforces dailyCostLimitUsd using the real ledger ----------
const ledger = new OperationalLedger();
const tightConfig = { ...defaultWorkforceConfig, dailyCostLimitUsd: 0.01 };
const under = checkDailyBudget(ledger, tightConfig);
check("an empty ledger is under budget", under.allowed === true && under.spentTodayUsd === 0);

const bigCost = buildCostRecord({ failed: false, provider: "openrouter", model: "m", text: "x", confidence: "UNKNOWN", observability: "OBSERVED_PRESENT", usage: { promptTokens: 1, completionTokens: 1 }, estimatedCostUsd: 5 }, "m", 1, 1, "researcher", "l2");
recordAiCost(bigCost, ledger, defaultWorkforceConfig);
const over = checkDailyBudget(ledger, tightConfig);
check("a posted AI cost transaction is picked up from the real ledger, not a separate counter", over.spentTodayUsd === 5);
check("exceeding the daily limit is correctly detected", over.allowed === false);

// ---------- runAiJob refuses to execute once the daily limit is hit ----------
const registry = new ProviderRegistry();
registry.registerProvider(new OpenRouterProvider({ defaultModel: "m", apiKey: "k", fetchImpl: fakeSuccessFetch }));
const blockedOutcome = await runAiJob(baseRequest, registry, tightConfig, ledger);
check("runAiJob refuses to call the provider at all once the daily budget is exceeded", blockedOutcome.result.failed && blockedOutcome.result.code === "BUDGET_EXCEEDED");
check("a budget-blocked job never even attempts the provider — no cost incurred for a call that didn't happen", blockedOutcome.costRecord.estimatedCostUsd === 0);

const roomyLedger = new OperationalLedger();
const allowedOutcome = await runAiJob(baseRequest, registry, defaultWorkforceConfig, roomyLedger);
check("a job under budget still executes normally (the guard doesn't block everything)", !allowedOutcome.result.failed);

// ---------- runAiJob remains fully backward compatible without a ledger (Sprint 5C callers) ----------
const noLedgerOutcome = await runAiJob(baseRequest, registry, defaultWorkforceConfig);
check("omitting the ledger entirely (as every Sprint 5C/5D caller does) still works unchanged", !noLedgerOutcome.result.failed);

// ---------- No secret logging discipline (static check) ----------
const serverSource = await (await import("node:fs/promises")).readFile(new URL("../../server/ai-proxy-server.ts", import.meta.url), "utf-8");
check("the server source never logs req.headers or the request body", !/console\.(log|warn|error)\([^)]*req\.headers/.test(serverSource) && !/console\.(log|warn|error)\([^)]*body\b/.test(serverSource));
check("the server binds explicitly to 0.0.0.0 for Render compatibility", serverSource.includes('"0.0.0.0"'));
check("the server reads Render's PORT env var", serverSource.includes("process.env.PORT"));

console.log(failures === 0 ? "\nALL SPRINT 5E SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
