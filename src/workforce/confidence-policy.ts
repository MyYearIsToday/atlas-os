import type { ConfidenceLevel, ObservabilityState } from "../services/evidence/evidence";
import type { AIProviderResult } from "./provider-types";

/**
 * Confidence must come from the provider or be explicitly "UNKNOWN" — never
 * invented by this layer. Today's OpenRouter/NVIDIA chat-completion APIs do
 * not return a confidence score, so both providers already report
 * "UNKNOWN" (see openrouter-provider.ts / nvidia-provider.ts). This module
 * exists so that if a future provider *does* return one, there is a single
 * place that decides how to fold it in — no per-caller reinterpretation.
 */
export interface NormalizedConfidence {
  confidence: ConfidenceLevel;
  observability: ObservabilityState;
}

export function normalizeConfidence(result: AIProviderResult): NormalizedConfidence {
  if (result.failed) {
    return { confidence: "UNKNOWN", observability: "NOT_OBSERVABLE" };
  }
  return { confidence: result.confidence, observability: result.observability };
}
