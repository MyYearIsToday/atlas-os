import type { ConfidenceLevel, ObservabilityState } from "../services/evidence/evidence";
import type { WorkerRole } from "../orchestrator/orchestration-types";

/**
 * Sprint 5C — provider types. `WorkerRole` and confidence/observability are
 * imported, not redefined — see DECISION_LOG.md, 2026-09-20, "why providers
 * are abstracted."
 */

export type ProviderId = "openrouter" | "nvidia" | (string & {});

export interface AIJobRequest {
  workerRole: WorkerRole;
  task: string;
  priority: number;
  confidenceTarget: number; // 0..1
  budgetLimitUsd: number;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  lineageId: string;
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AIProviderSuccess {
  failed: false;
  provider: ProviderId;
  model: string;
  text: string;
  /** Provider-reported confidence if the API returns one; otherwise "UNKNOWN" — never invented. */
  confidence: ConfidenceLevel;
  observability: ObservabilityState;
  usage: TokenUsage;
  estimatedCostUsd: number;
}

export type ProviderFailureCode =
  | "MISSING_API_KEY"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "PROVIDER_UNAVAILABLE"
  | "BUDGET_EXCEEDED";

export interface AIProviderFailure {
  failed: true;
  provider: ProviderId;
  code: ProviderFailureCode;
  reason: string;
}

export type AIProviderResult = AIProviderSuccess | AIProviderFailure;

export interface ProviderHealth {
  provider: ProviderId;
  healthy: boolean;
  reason?: string;
  checkedAt: string;
}

export interface CostRecord {
  provider: ProviderId;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number;
  worker: WorkerRole;
  timestamp: string;
  lineageId: string;
}
