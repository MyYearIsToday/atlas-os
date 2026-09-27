import { ProviderRegistry, DuplicateProviderError } from "../workforce/provider-registry";
import { OpenRouterProvider, buildOpenRouterRequest } from "../workforce/openrouter-provider";
import { NvidiaProvider, buildNvidiaRequest } from "../workforce/nvidia-provider";
import { selectProvider } from "../workforce/model-router";
import { decideEscalation } from "../workforce/escalation-policy";
import { normalizeConfidence } from "../workforce/confidence-policy";
import { buildCostRecord, costRecordToTransaction, recordAiCost } from "../workforce/cost-tracker";
import { runAiJob } from "../workforce/ai-job";
import { defaultWorkforceConfig } from "../workforce/workforce-config";
import { OperationalLedger } from "../services/finance/ledger";
import { AtlasOrchestrator } from "../orchestrator/orchestrator";
import { defaultOrchestrationConfig } from "../orchestrator/orchestration-config";
import type { AIJobRequest } from "../workforce/provider-types";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const baseRequest: AIJobRequest = {
  workerRole: "researcher",
  task: "Summarize the visibility gaps for this business.",
  priority: 50,
  confidenceTarget: 0.6,
  budgetLimitUsd: 1,
  lineageId: "lineage-test-1",
};

// ---------- Provider Registry ----------
const registry = new ProviderRegistry();
const openrouter = new OpenRouterProvider({ defaultModel: "meta-llama/llama-3.1-8b-instruct", apiKey: undefined });
registry.registerProvider(openrouter);
check("provider registration succeeds", registry.listProviders().includes("openrouter"));
let dupThrew = false;
try { registry.registerProvider(openrouter); } catch (e) { dupThrew = e instanceof DuplicateProviderError; }
check("duplicate provider registration is rejected, not silently replaced", dupThrew);
check("getProvider returns null for an unregistered id", registry.getProvider("nvidia") === null);
const nvidia = new NvidiaProvider({ defaultModel: "meta/llama-3.1-8b-instruct", apiKey: undefined });
registry.registerProvider(nvidia);
check("removeProvider then re-register works (deliberate replacement is allowed)", registry.removeProvider("nvidia") && (registry.registerProvider(nvidia), true));

// ---------- Missing API key handling ----------
const keyResult = await openrouter.execute(baseRequest);
check("missing OPENROUTER_API_KEY produces a structured failure, never a fabricated response", keyResult.failed && keyResult.code === "MISSING_API_KEY");
const nvidiaKeyResult = await nvidia.execute(baseRequest);
check("missing NVIDIA_API_KEY produces a structured failure", nvidiaKeyResult.failed && nvidiaKeyResult.code === "MISSING_API_KEY");

// ---------- Provider health checks ----------
const health = await openrouter.healthCheck();
check("health check reports unhealthy when the API key is absent", health.healthy === false && (health.reason?.includes("OPENROUTER_API_KEY") ?? false));
const healthSummary = await registry.healthSummary();
check("registry health summary covers every registered provider", healthSummary.length === registry.listProviders().length);

// ---------- Request construction (pure, no network) ----------
const orRequest = buildOpenRouterRequest(baseRequest, "test-key-123", "meta-llama/llama-3.1-8b-instruct");
check("OpenRouter request uses Bearer auth with the given key", orRequest.headers.Authorization === "Bearer test-key-123");
check("OpenRouter request uses the configured default model, not hardcoded", JSON.parse(orRequest.body).model === "meta-llama/llama-3.1-8b-instruct");
const orRequestWithModelOverride = buildOpenRouterRequest({ ...baseRequest, model: "custom/model" }, "k", "default/model");
check("OpenRouter request honors an explicit model override", JSON.parse(orRequestWithModelOverride.body).model === "custom/model");

const nvRequest = buildNvidiaRequest(baseRequest, "nv-key-456", "meta/llama-3.1-8b-instruct");
check("NVIDIA request uses Bearer auth with the given key", nvRequest.headers.Authorization === "Bearer nv-key-456");
check("NVIDIA request uses the configured default model", JSON.parse(nvRequest.body).model === "meta/llama-3.1-8b-instruct");

// ---------- Timeout handling ----------
const neverResolves: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
  const signal = init?.signal as AbortSignal | undefined;
  signal?.addEventListener("abort", () => {
    const err = new Error("Aborted");
    err.name = "AbortError";
    reject(err);
  });
});
const slowProvider = new OpenRouterProvider({ defaultModel: "m", apiKey: "k", fetchImpl: neverResolves, timeoutMs: 50 });
const timeoutResult = await slowProvider.execute({ ...baseRequest, timeoutMs: 50 });
check("a hanging request is aborted and reported as TIMEOUT, not left hanging or faked", timeoutResult.failed && timeoutResult.code === "TIMEOUT");

// ---------- Successful call via injected fetch (deterministic, no real network) ----------
const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
  model: "meta-llama/llama-3.1-8b-instruct",
  choices: [{ message: { content: "Three visibility gaps found." } }],
  usage: { prompt_tokens: 42, completion_tokens: 18 },
}), { status: 200 });
const workingProvider = new OpenRouterProvider({ defaultModel: "meta-llama/llama-3.1-8b-instruct", apiKey: "k", fetchImpl: fakeFetch, costPerThousandTokensUsd: 0.5 });
const successResult = await workingProvider.execute(baseRequest);
check("a successful response is normalized correctly", !successResult.failed && successResult.text === "Three visibility gaps found." && successResult.usage.promptTokens === 42);
check("confidence is UNKNOWN when the provider doesn't report one, never invented", !successResult.failed && successResult.confidence === "UNKNOWN");
const normalized = normalizeConfidence(successResult);
check("confidence-policy normalizes a successful result consistently", normalized.confidence === "UNKNOWN" && normalized.observability === "OBSERVED_PRESENT");
const failNormalized = normalizeConfidence(timeoutResult);
check("confidence-policy normalizes a failure to UNKNOWN/NOT_OBSERVABLE", failNormalized.confidence === "UNKNOWN" && failNormalized.observability === "NOT_OBSERVABLE");

// ---------- Deterministic routing ----------
const registry2 = new ProviderRegistry();
registry2.registerProvider(workingProvider);
registry2.registerProvider(new NvidiaProvider({ defaultModel: "m", apiKey: "k" }));
const decision1 = selectProvider(baseRequest, registry2, defaultWorkforceConfig);
const decision2 = selectProvider(baseRequest, registry2, defaultWorkforceConfig);
check("routing is deterministic — same input always yields the same provider", decision1?.providerId === decision2?.providerId);
check("researcher role routes to openrouter first, per config order", decision1?.providerId === "openrouter");
const decisionTier1 = selectProvider(baseRequest, registry2, defaultWorkforceConfig, 1);
check("requesting the next tier explicitly routes to the second configured provider", decisionTier1?.providerId === "nvidia");
const disabledConfig = { ...defaultWorkforceConfig, featureFlags: { ...defaultWorkforceConfig.featureFlags, openrouterEnabled: false } };
const decisionDisabled = selectProvider(baseRequest, registry2, disabledConfig);
check("a disabled provider is skipped deterministically, never chosen by chance", decisionDisabled?.providerId === "nvidia");

// ---------- Confidence-based escalation ----------
const accept = decideEscalation("HIGH", { tierIndex: 0, attemptsOnTier: 1, totalEscalations: 0 }, { confidenceTarget: 0.6, attemptsBeforeEscalation: 2, maxEscalationDepth: 2 });
check("confidence above target is accepted", accept.action === "ACCEPT");
const retry = decideEscalation("LOW", { tierIndex: 0, attemptsOnTier: 1, totalEscalations: 0 }, { confidenceTarget: 0.9, attemptsBeforeEscalation: 2, maxEscalationDepth: 2 });
check("low confidence retries the same tier before escalating (cheap model first, retry once)", retry.action === "RETRY_SAME_TIER");
const escalate = decideEscalation("LOW", { tierIndex: 0, attemptsOnTier: 2, totalEscalations: 0 }, { confidenceTarget: 0.9, attemptsBeforeEscalation: 2, maxEscalationDepth: 2 });
check("exhausting retries on a tier escalates to the next tier", escalate.action === "ESCALATE" && escalate.nextTierIndex === 1);
const giveUp = decideEscalation("LOW", { tierIndex: 1, attemptsOnTier: 2, totalEscalations: 2 }, { confidenceTarget: 0.9, attemptsBeforeEscalation: 2, maxEscalationDepth: 2 });
check("escalation never continues endlessly — gives up at maxEscalationDepth", giveUp.action === "GIVE_UP");

// ---------- Full ai-job run (real router + escalation + provider, injected fetch) ----------
const jobRegistry = new ProviderRegistry();
jobRegistry.registerProvider(workingProvider);
jobRegistry.registerProvider(new NvidiaProvider({ defaultModel: "m", apiKey: "k" }));
const outcome = await runAiJob({ ...baseRequest, confidenceTarget: 0 }, jobRegistry, defaultWorkforceConfig);
check("a full ai-job run accepts a successful low-bar result without unnecessary escalation", !outcome.result.failed && outcome.escalations === 0);

// ---------- Cost tracking + Finance Ledger integration ----------
const costRecord = buildCostRecord(successResult, "meta-llama/llama-3.1-8b-instruct", 42, 18, "researcher", "lineage-cost-1");
check("cost record captures provider, model, tokens, and lineage", costRecord.provider === "openrouter" && costRecord.promptTokens === 42 && costRecord.lineageId === "lineage-cost-1");
const ledger = new OperationalLedger();
const posted = recordAiCost(costRecord, ledger, defaultWorkforceConfig);
check("a non-zero AI cost is posted as a real Finance Ledger transaction, not a separate cost log", posted !== null && ledger.get(posted!.transactionId)?.status === "POSTED");
check("AI cost defaults to Atlas_Shared, never silently attributed to TradeSpark", posted?.productId === "Atlas_Shared");
const zeroCostRecord = buildCostRecord(timeoutResult, "none", null, null, "researcher", "lineage-cost-2");
check("a failed execution posts no cost transaction (no fee for no result)", recordAiCost(zeroCostRecord, ledger, defaultWorkforceConfig) === null);
const tradeSparkConfig = { ...defaultWorkforceConfig, featureFlags: { ...defaultWorkforceConfig.featureFlags, attributeAiCostsToTradeSpark: true } };
const tradeSparkTxn = costRecordToTransaction(costRecord, tradeSparkConfig);
check("TradeSpark attribution requires an explicit opt-in flag", tradeSparkTxn.productId === "TradeSpark");
const expectedCents = BigInt(Math.round(costRecord.estimatedCostUsd * 100));
check("cost amounts use bigint minor units via the existing money() helper, never a float field", posted!.amount.minorUnits === expectedCents && typeof posted!.amount.minorUnits === "bigint");

// ---------- Execution Log integration (via Sprint 5A's WorkforceManager, not bypassing the Orchestrator) ----------
// Sprint 5A's dispatch() already wraps every worker-routed handler in
// workforceManager.executeWithEscalation(route.workerRole, ...) — a
// handler should call runAiJob() directly for the real provider call, not
// wrap it in a second executeWithEscalation (that would double-escalate).
// This is the correct integration point: real AI execution supplies the
// (honest) confidence the orchestrator's existing outer escalation already
// consumes for the route's configured worker role.
//
// Note: real chat-completion providers honestly report confidence as
// "UNKNOWN" (rank 0) — no invented number. The outer gate requires
// `confidence >= provider.confidenceThreshold`, which UNKNOWN can never
// satisfy for a positive threshold, so a real AI call that succeeded at
// the provider level can still be reported FAILURE by the outer loop —
// a genuine, documented cross-sprint interaction (DECISION_LOG.md,
// 2026-09-20), not hidden here. The assertion checks the log entry exists
// with the right route-configured worker, not a specific outcome.
const orchestrator = new AtlasOrchestrator(defaultOrchestrationConfig, true);
orchestrator.registry.register("EvidenceUpdated", async (event) => {
  const outcome = await runAiJob({ ...baseRequest, lineageId: event.lineageId, confidenceTarget: 0 }, jobRegistry, defaultWorkforceConfig);
  const rank: Record<string, number> = { VERIFIED: 1, HIGH: 0.85, MEDIUM: 0.65, LOW: 0.4, UNKNOWN: 0 };
  return { output: outcome, confidence: outcome.result.failed ? 0 : rank[outcome.result.confidence] };
}, { replace: true });
await orchestrator.dispatch("EvidenceUpdated", { businessId: "b1", opportunityInput: { businessId: "b1", components: [{ key: "x", rawValue: 1, maxValue: 1, normalizedValue: 1, weight: 1, evidenceRefs: [], confidence: "HIGH", observability: "OBSERVED_PRESENT", explanation: "x" }], evidenceCoverage: 50, competitorCoverage: 50 } });
const logged = orchestrator.log.all().find((e) => e.event === "EvidenceUpdated");
check("a real AI job run is captured in the Sprint 5A Execution Log via the route's configured worker role — integration is real, not bypassed", logged !== undefined && logged?.worker === "analyst" && (logged.outcome === "SUCCESS" || logged.outcome === "FAILURE"));

console.log(failures === 0 ? "\nALL SPRINT 5C SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
