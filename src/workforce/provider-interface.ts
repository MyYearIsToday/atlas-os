import type { AIJobRequest, AIProviderResult, ProviderHealth, ProviderId } from "./provider-types";

/**
 * Every provider (OpenRouter, NVIDIA, any future one) implements exactly
 * this interface. Nothing outside `src/workforce/` — including the
 * Orchestrator — is allowed to branch on which concrete provider it's
 * talking to; model-router.ts and ai-job.ts only ever see `AIProvider`.
 */
export interface AIProvider {
  readonly id: ProviderId;

  execute(request: AIJobRequest): Promise<AIProviderResult>;

  /** Structural request validation only — does not call the network. */
  validate(request: AIJobRequest): { valid: boolean; errors: string[] };

  /** Returns null if cost cannot be estimated (e.g. unknown model pricing) rather than guessing a number. */
  estimateCost(request: AIJobRequest): number | null;

  /** Returns null if token count cannot be estimated without calling the provider. */
  estimateTokens(request: AIJobRequest): number | null;

  healthCheck(): Promise<ProviderHealth>;
}
