import { createAiProxyServer } from "../../server/ai-proxy-server";
import { ProxiedAIProvider } from "../workforce/proxied-provider";
import { OpenRouterProvider } from "../workforce/openrouter-provider";
import { NvidiaProvider } from "../workforce/nvidia-provider";
import { ProviderRegistry } from "../workforce/provider-registry";
import { runAiJob } from "../workforce/ai-job";
import { defaultWorkforceConfig } from "../workforce/workforce-config";
import { WorkforceManager } from "../orchestrator/workforce-manager";
import { defaultOrchestrationConfig } from "../orchestrator/orchestration-config";
import type { AIJobRequest } from "../workforce/provider-types";
import type { AIProvider } from "../workforce/provider-interface";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const baseRequest: AIJobRequest = {
  workerRole: "researcher",
  task: "Summarize the visibility gaps for this business.",
  priority: 50,
  confidenceTarget: 0.9, // deliberately high — real providers report UNKNOWN, so this exercises the 5D acceptance path
  budgetLimitUsd: 1,
  lineageId: "lineage-5d-1",
};

// ---------- Real server boundary, over real loopback HTTP ----------
// Providers here are given API keys directly (server-side context is where
// that's meant to happen) and a fake fetch so no real network call to
// OpenRouter/NVIDIA is made — but the client<->server hop itself is real.
const fakeUpstreamFetch: typeof fetch = async () => new Response(JSON.stringify({
  model: "meta-llama/llama-3.1-8b-instruct",
  choices: [{ message: { content: "Three visibility gaps found." } }],
  usage: { prompt_tokens: 42, completion_tokens: 18 },
}), { status: 200 });

const serverProviders: Record<string, AIProvider> = {
  openrouter: new OpenRouterProvider({ defaultModel: "meta-llama/llama-3.1-8b-instruct", apiKey: "server-side-key", fetchImpl: fakeUpstreamFetch, costPerThousandTokensUsd: 0.5 }),
  nvidia: new NvidiaProvider({ defaultModel: "meta/llama-3.1-8b-instruct", apiKey: undefined }), // deliberately no key, to test the missing-key path through the proxy
};

const server = createAiProxyServer(serverProviders);
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const proxyBaseUrl = `http://127.0.0.1:${port}`;

// ---------- Health check through the real boundary ----------
const healthResponse = await fetch(`${proxyBaseUrl}/api/ai/health`);
const healthBody = await healthResponse.json();
check("real HTTP health check reaches the server boundary", healthResponse.ok && Array.isArray(healthBody.providers) && healthBody.providers.length === 2);
check("the server-side NVIDIA provider (no key) reports unhealthy through the real endpoint", healthBody.providers.find((p: any) => p.provider === "nvidia")?.healthy === false);

// ---------- ProxiedAIProvider: client never sees a key, real round trip ----------
const proxiedOpenRouter = new ProxiedAIProvider({ proxyBaseUrl, targetProviderId: "openrouter" });
const proxiedResult = await proxiedOpenRouter.execute(baseRequest);
check("a real end-to-end call through the proxy succeeds and is normalized correctly", !proxiedResult.failed && proxiedResult.text === "Three visibility gaps found.");
check("token usage survives the proxy hop intact", !proxiedResult.failed && proxiedResult.usage.promptTokens === 42);

const proxiedNvidia = new ProxiedAIProvider({ proxyBaseUrl, targetProviderId: "nvidia" });
const proxiedFailure = await proxiedNvidia.execute(baseRequest);
check("a real missing-key failure on the server is relayed through the proxy honestly, not swallowed", proxiedFailure.failed && proxiedFailure.code === "MISSING_API_KEY");

// ---------- Proxy-side validation and unknown routes ----------
const badRoute = await fetch(`${proxyBaseUrl}/api/ai/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "not-a-real-provider", request: baseRequest }) });
const badRouteBody = await badRoute.json();
check("the server rejects an unknown providerId with a structured 400, not a crash", badRoute.status === 400 && badRouteBody.failed === true);

// ---------- Interface preservation: same AIProvider contract as direct providers (prerequisite #4) ----------
const registry = new ProviderRegistry();
registry.registerProvider(proxiedOpenRouter);
const jobOutcome = await runAiJob({ ...baseRequest, confidenceTarget: 0 }, registry, defaultWorkforceConfig);
check("runAiJob/model-router work unmodified against a proxied provider — no special-casing needed", !jobOutcome.result.failed);

// ---------- Confidence/acceptance fix (prerequisite #5) ----------
// Tested directly against WorkforceManager with a hand-built run(), not
// through ai-job.ts's own separate inner escalation loop (escalation-
// policy.ts has the identical UNKNOWN-confidence question at that layer,
// and conflating the two loops in one test would confound which layer is
// actually being exercised — see DECISION_LOG.md, 2026-09-21, for why both
// layers needed the same fix rather than just the outer one).
const workforceManager = new WorkforceManager(defaultOrchestrationConfig);
const realProxiedSuccessRun = async () => {
  const result = await proxiedOpenRouter.execute({ ...baseRequest, confidenceTarget: 0 });
  const confidenceKnown = !result.failed && result.confidence !== "UNKNOWN";
  return { output: result, confidence: 0, confidenceKnown, executionSucceeded: !result.failed };
};
const escalationResult = await workforceManager.executeWithEscalation("researcher", realProxiedSuccessRun);
check("a real successful call with UNKNOWN confidence is now accepted (researcher tier opts in), not endlessly escalated", escalationResult.succeeded === true);
check("acceptance is logged distinctly as acceptedOnUnknownConfidence, never conflated with a real threshold match", escalationResult.acceptedOnUnknownConfidence === true);

// Contrast: the finance role deliberately did NOT opt in — a genuinely
// unknown-confidence result there must still fail closed.
const financeManager = new WorkforceManager(defaultOrchestrationConfig);
const financeRun = async () => ({ output: {}, confidence: 0, confidenceKnown: false, executionSucceeded: true });
const financeResult = await financeManager.executeWithEscalation("finance", financeRun);
check("the finance worker role stays strict — unknown confidence is NOT auto-accepted there, by deliberate default", financeResult.succeeded === false);

// A genuine failure must never be accepted via the unknown-confidence path.
const failingRun = async () => ({ output: null, confidence: 0, confidenceKnown: false, executionSucceeded: false });
const failingResult = await workforceManager.executeWithEscalation("researcher", failingRun);
check("a genuine execution failure is never mistaken for an accepted unknown-confidence success", failingResult.succeeded === false && failingResult.acceptedOnUnknownConfidence === false);

server.close();

console.log(failures === 0 ? "\nALL SPRINT 5D SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
