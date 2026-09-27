import type { AIProvider } from "./provider-interface";
import type { AIJobRequest, AIProviderResult, ProviderHealth, ProviderId } from "./provider-types";

/**
 * Sprint 5D — the browser-side half of the trusted execution boundary.
 * Implements `AIProvider` identically to `OpenRouterProvider`/
 * `NvidiaProvider` — `model-router.ts`, `ai-job.ts`, and the Orchestrator
 * need no changes to use this instead. It never reads, stores, or forwards
 * an API key; it only calls the trusted server (`server/ai-proxy-server.ts`)
 * over HTTP and relays the structured result. This satisfies "preserve the
 * existing provider interfaces" and "route browser AI jobs through the
 * secure boundary" from the Sprint 5D prerequisites.
 */
export interface ProxiedProviderOptions {
  /** e.g. "http://localhost:8787" or a deployed proxy's origin. No default — must be configured, never assumed. */
  proxyBaseUrl: string;
  targetProviderId: ProviderId;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ProxiedAIProvider implements AIProvider {
  readonly id: ProviderId;

  constructor(private options: ProxiedProviderOptions) {
    this.id = options.targetProviderId;
  }

  validate(request: AIJobRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!request.task || request.task.trim().length === 0) errors.push("task must be non-empty");
    if (request.confidenceTarget < 0 || request.confidenceTarget > 1) errors.push("confidenceTarget must be between 0 and 1");
    return { valid: errors.length === 0, errors };
  }

  /** The proxy owns real cost/token estimation (it knows the real provider); the client can't estimate what it can't see. */
  estimateCost(): number | null {
    return null;
  }

  estimateTokens(): number | null {
    return null;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(`${this.options.proxyBaseUrl}/api/ai/health`);
      if (!response.ok) return { provider: this.id, healthy: false, reason: `Proxy health check returned HTTP ${response.status}`, checkedAt: new Date().toISOString() };
      const body = await response.json();
      const entry = body?.providers?.find((p: ProviderHealth) => p.provider === this.id);
      return entry ?? { provider: this.id, healthy: false, reason: "Proxy did not report this provider", checkedAt: new Date().toISOString() };
    } catch (error) {
      return { provider: this.id, healthy: false, reason: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
    }
  }

  async execute(request: AIJobRequest): Promise<AIProviderResult> {
    const validation = this.validate(request);
    if (!validation.valid) {
      return { failed: true, provider: this.id, code: "INVALID_RESPONSE", reason: `Invalid request: ${validation.errors.join("; ")}` };
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.options.timeoutMs ?? 30_000);

    try {
      const response = await fetchImpl(`${this.options.proxyBaseUrl}/api/ai/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: this.options.targetProviderId, request }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const body = (await response.json()) as AIProviderResult;
      if (!response.ok && !("failed" in body)) {
        return { failed: true, provider: this.id, code: "PROVIDER_UNAVAILABLE", reason: `Proxy returned HTTP ${response.status}` };
      }
      // The proxy already returns a well-formed AIProviderResult (success
      // or structured failure) — relayed as-is, not reinterpreted.
      return body;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") {
        return { failed: true, provider: this.id, code: "TIMEOUT", reason: `Proxy request exceeded timeout of ${request.timeoutMs ?? this.options.timeoutMs ?? 30_000}ms` };
      }
      return { failed: true, provider: this.id, code: "NETWORK_ERROR", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
