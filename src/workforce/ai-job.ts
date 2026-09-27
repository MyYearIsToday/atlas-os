import { selectProvider, nextTier } from "./model-router";
import { decideEscalation, type EscalationState } from "./escalation-policy";
import { normalizeConfidence } from "./confidence-policy";
import { buildCostRecord } from "./cost-tracker";
import { checkDailyBudget } from "./cost-guard";
import type { ProviderRegistry } from "./provider-registry";
import type { WorkforceConfig } from "./workforce-config";
import type { AIJobRequest, AIProviderResult, CostRecord } from "./provider-types";
import type { OperationalLedger } from "../services/finance/ledger";

/**
 * Runs one AI job to completion: routes to a provider, executes, checks
 * confidence, escalates per policy, and always returns a cost record (even
 * for a failed/give-up outcome, where cost is $0 — no fee for no result).
 *
 * This function is the real implementation Sprint 5A's `WorkforceManager.
 * executeWithEscalation()` was built to accept via dependency injection —
 * see `asWorkforceManagerRun()` below. It does not bypass the Orchestrator:
 * the Orchestrator still owns approval, retry-on-failure, and logging;
 * this only owns "which real provider call happens for an AI worker step."
 */

export interface AiJobOutcome {
  result: AIProviderResult;
  costRecord: CostRecord;
  escalations: number;
  finalTierIndex: number | null;
}

export async function runAiJob(
  request: AIJobRequest,
  registry: ProviderRegistry,
  config: WorkforceConfig,
  ledger?: OperationalLedger,
): Promise<AiJobOutcome> {
  if (ledger) {
    const budget = checkDailyBudget(ledger, config);
    if (!budget.allowed) {
      const result: AIProviderResult = { failed: true, provider: config.defaultProvider, code: "BUDGET_EXCEEDED", reason: budget.reason! };
      return { result, costRecord: buildCostRecord(result, "none", null, null, request.workerRole, request.lineageId), escalations: 0, finalTierIndex: null };
    }
  }

  const state: EscalationState = { tierIndex: 0, attemptsOnTier: 0, totalEscalations: 0 };
  let lastResult: AIProviderResult | null = null;

  while (true) {
    const decision = selectProvider(request, registry, config, state.tierIndex);
    if (!decision) {
      const result: AIProviderResult = { failed: true, provider: config.defaultProvider, code: "PROVIDER_UNAVAILABLE", reason: `No enabled/registered provider for worker role "${request.workerRole}" at tier ${state.tierIndex}.` };
      return { result, costRecord: buildCostRecord(result, "none", null, null, request.workerRole, request.lineageId), escalations: state.totalEscalations, finalTierIndex: null };
    }

    state.attemptsOnTier += 1;
    const result = await decision.provider.execute({ ...request, model: request.model ?? decision.model });
    lastResult = result;

    const { confidence } = normalizeConfidence(result);

    // Sprint 5D: the same fix as the outer WorkforceManager gate, applied
    // here so ai-job's own escalation loop doesn't independently exhaust
    // every tier chasing a confidence score a real provider will never
    // supply. Guarded on `!result.failed` explicitly — a genuine failure
    // (timeout, missing key, bad response) also normalizes to "UNKNOWN"
    // confidence and must never be accepted through this path.
    if (!result.failed && confidence === "UNKNOWN" && config.acceptUnknownConfidenceOnSuccess) {
      const costRecord = buildCostRecord(result, decision.model, result.usage.promptTokens, result.usage.completionTokens, request.workerRole, request.lineageId);
      return { result, costRecord, escalations: state.totalEscalations, finalTierIndex: decision.tierIndex };
    }

    const escalationDecision = decideEscalation(confidence, state, {
      confidenceTarget: request.confidenceTarget,
      attemptsBeforeEscalation: config.maxRetries,
      maxEscalationDepth: config.maxEscalationDepth,
    });

    if (escalationDecision.action === "ACCEPT") {
      const costRecord = buildCostRecord(result, decision.model, result.failed ? null : result.usage.promptTokens, result.failed ? null : result.usage.completionTokens, request.workerRole, request.lineageId);
      return { result, costRecord, escalations: state.totalEscalations, finalTierIndex: decision.tierIndex };
    }
    if (escalationDecision.action === "RETRY_SAME_TIER") {
      continue;
    }
    if (escalationDecision.action === "ESCALATE") {
      state.tierIndex = nextTier(decision);
      state.attemptsOnTier = 0;
      state.totalEscalations += 1;
      continue;
    }
    // GIVE_UP
    const costRecord = buildCostRecord(result, decision.model, result.failed ? null : result.usage.promptTokens, result.failed ? null : result.usage.completionTokens, request.workerRole, request.lineageId);
    return { result, costRecord, escalations: state.totalEscalations, finalTierIndex: decision.tierIndex };
  }
}

/**
 * Adapts `runAiJob` to the exact `run` signature Sprint 5A's
 * `WorkforceManager.executeWithEscalation()` expects, so a caller can wire
 * real AI execution into the existing orchestrator-level escalation loop
 * without modifying `workforce-manager.ts` itself. Confidence is converted
 * to a 0..1 number for that loop using the same rank table
 * `confidence-policy.ts`'s callers already rely on being consistent with.
 */
export function asWorkforceManagerRun(
  buildRequest: (attempt: number) => AIJobRequest,
  registry: ProviderRegistry,
  config: WorkforceConfig,
) {
  const rank: Record<string, number> = { VERIFIED: 1, HIGH: 0.85, MEDIUM: 0.65, LOW: 0.4, UNKNOWN: 0 };
  return async (_provider: unknown, attempt: number) => {
    const outcome = await runAiJob(buildRequest(attempt), registry, config);
    const executionSucceeded = !outcome.result.failed;
    const confidence = outcome.result.failed ? 0 : rank[outcome.result.confidence];
    // Sprint 5D: distinguish "genuinely low confidence" from "this provider
    // doesn't report confidence at all" — see DECISION_LOG.md, 2026-09-21.
    // executionSucceeded is tracked separately so a real failure (timeout,
    // missing key, network error) can never be mistaken for an accepted
    // unknown-confidence success — those two are orthogonal signals.
    const confidenceKnown = !outcome.result.failed && outcome.result.confidence !== "UNKNOWN";
    return { output: outcome, confidence, confidenceKnown, executionSucceeded };
  };
}
