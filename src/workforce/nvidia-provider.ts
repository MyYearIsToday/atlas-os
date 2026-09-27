import type { AIProvider } from "./provider-interface";
import type { AIJobRequest, AIProviderResult, ProviderHealth } from "./provider-types";

/**
 * NVIDIA provider. Same security note as openrouter-provider.ts:
 * `NVIDIA_API_KEY` is read via `process.env`, never `import.meta.env`,
 * for the same reason — see that file's header comment and
 * DECISION_LOG.md, 2026-09-20.
 */

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export interface NvidiaRequestInit {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Pure request construction — no network call, fully unit-testable. */
export function buildNvidiaRequest(request: AIJobRequest, apiKey: string, defaultModel: string): NvidiaRequestInit {
  return {
    url: NVIDIA_URL,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: request.model ?? defaultModel,
      messages: [{ role: "user", content: request.task }],
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.3,
    }),
  };
}

export interface NvidiaProviderOptions {
  defaultModel: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  apiKey?: string; // for dependency injection in tests only — production reads process.env
  costPerThousandTokensUsd?: number;
}

export class NvidiaProvider implements AIProvider {
  readonly id = "nvidia" as const;

  constructor(private options: NvidiaProviderOptions) {}

  private apiKey(): string | undefined {
    return this.options.apiKey ?? (typeof process !== "undefined" ? process.env?.NVIDIA_API_KEY : undefined);
  }

  validate(request: AIJobRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!request.task || request.task.trim().length === 0) errors.push("task must be non-empty");
    if (request.confidenceTarget < 0 || request.confidenceTarget > 1) errors.push("confidenceTarget must be between 0 and 1");
    if (request.budgetLimitUsd <= 0) errors.push("budgetLimitUsd must be positive");
    return { valid: errors.length === 0, errors };
  }

  estimateTokens(request: AIJobRequest): number | null {
    return Math.ceil(request.task.length / 4) + (request.maxTokens ?? 1024);
  }

  estimateCost(request: AIJobRequest): number | null {
    const rate = this.options.costPerThousandTokensUsd;
    if (rate === undefined) return null;
    const tokens = this.estimateTokens(request);
    return tokens === null ? null : (tokens / 1000) * rate;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const key = this.apiKey();
    if (!key) {
      return { provider: this.id, healthy: false, reason: "NVIDIA_API_KEY not set", checkedAt: new Date().toISOString() };
    }
    return { provider: this.id, healthy: true, checkedAt: new Date().toISOString() };
  }

  async execute(request: AIJobRequest): Promise<AIProviderResult> {
    const key = this.apiKey();
    if (!key) {
      return { failed: true, provider: this.id, code: "MISSING_API_KEY", reason: "NVIDIA_API_KEY is not set in this environment." };
    }

    const validation = this.validate(request);
    if (!validation.valid) {
      return { failed: true, provider: this.id, code: "INVALID_RESPONSE", reason: `Invalid request: ${validation.errors.join("; ")}` };
    }

    const estimatedCost = this.estimateCost(request) ?? 0;
    if (estimatedCost > request.budgetLimitUsd) {
      return { failed: true, provider: this.id, code: "BUDGET_EXCEEDED", reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds budget $${request.budgetLimitUsd}` };
    }

    const init = buildNvidiaRequest(request, key, this.options.defaultModel);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.options.timeoutMs ?? 30_000);

    try {
      const response = await fetchImpl(init.url, { method: init.method, headers: init.headers, body: init.body, signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        return { failed: true, provider: this.id, code: "PROVIDER_UNAVAILABLE", reason: `NVIDIA returned HTTP ${response.status}` };
      }

      const json = await response.json();
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        return { failed: true, provider: this.id, code: "INVALID_RESPONSE", reason: "NVIDIA response missing choices[0].message.content" };
      }

      return {
        failed: false,
        provider: this.id,
        model: json?.model ?? request.model ?? this.options.defaultModel,
        text,
        confidence: "UNKNOWN",
        observability: "OBSERVED_PRESENT",
        usage: {
          promptTokens: json?.usage?.prompt_tokens ?? null,
          completionTokens: json?.usage?.completion_tokens ?? null,
        },
        estimatedCostUsd: estimatedCost,
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") {
        return { failed: true, provider: this.id, code: "TIMEOUT", reason: `Request exceeded timeout of ${request.timeoutMs ?? this.options.timeoutMs ?? 30_000}ms` };
      }
      return { failed: true, provider: this.id, code: "NETWORK_ERROR", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
