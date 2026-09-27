import type { ProviderId } from "./provider-types";
import type { WorkerRole } from "../orchestrator/orchestration-types";

/**
 * No secrets live here — `OPENROUTER_API_KEY` and `NVIDIA_API_KEY` are read
 * at call time by each provider from `process.env` (see openrouter-
 * provider.ts / nvidia-provider.ts for why not `import.meta.env`). This
 * file only names which env vars are required, for documentation/health
 * checks — it never reads or stores their values.
 */
export const REQUIRED_ENV_VARS = ["OPENROUTER_API_KEY", "NVIDIA_API_KEY"] as const;
/** Recommended (not strictly required, but strongly advised for any real deployment) — see DEPLOYMENT.md. */
export const RECOMMENDED_ENV_VARS = ["ATLAS_PROXY_SHARED_SECRET", "ATLAS_ALLOWED_ORIGIN"] as const;

export interface WorkforceConfig {
  defaultProvider: ProviderId;
  /** Ordered cheapest -> most capable, per worker role. */
  workerProviderMap: Record<WorkerRole, ProviderId[]>;
  modelDefaults: Record<ProviderId, string>;
  timeoutMs: number;
  maxRetries: number;
  escalationConfidenceThreshold: number;
  maxEscalationDepth: number;
  dailyCostLimitUsd: number;
  /**
   * Sprint 5D fix for ai-job.ts's own inner escalation loop (see
   * escalation-policy.ts) — the same UNKNOWN-confidence question that
   * orchestrator/workforce-manager.ts's outer gate had. Kept as a distinct
   * flag from that outer gate's per-tier setting because this one governs
   * whether ai-job.ts accepts a structurally successful run on its own,
   * before the result is ever handed to the outer WorkforceManager.
   */
  acceptUnknownConfidenceOnSuccess: boolean;
  /**
   * Sprint 5D: "direct" calls OpenRouter/NVIDIA from wherever this code
   * runs (correct only in a trusted server process — in a browser it will
   * always hit MISSING_API_KEY, which is the intended safe behavior).
   * "proxied" routes every call through the trusted server boundary via
   * ProxiedAIProvider — this is the only mode safe to use from a browser
   * bundle with real credentials in play. Defaults to "proxied" so the
   * insecure path is never the default.
   */
  executionBoundary: {
    mode: "direct" | "proxied";
    proxyBaseUrl?: string;
  };
  featureFlags: {
    openrouterEnabled: boolean;
    nvidiaEnabled: boolean;
    /** AI costs are excluded from TradeSpark reporting unless explicitly enabled, same isolation rule as the rest of Finance. */
    attributeAiCostsToTradeSpark: boolean;
  };
}

export const defaultWorkforceConfig: WorkforceConfig = {
  defaultProvider: "openrouter",
  workerProviderMap: {
    planner: ["openrouter", "nvidia"],
    researcher: ["openrouter", "nvidia"],
    reviewer: ["nvidia", "openrouter"],
    analyst: ["openrouter", "nvidia"],
    finance: ["openrouter"],
    writer: ["openrouter", "nvidia"],
  },
  modelDefaults: {
    openrouter: "meta-llama/llama-3.1-8b-instruct",
    nvidia: "meta/llama-3.1-8b-instruct",
  },
  timeoutMs: 30_000,
  maxRetries: 2,
  escalationConfidenceThreshold: 0.65,
  maxEscalationDepth: 2,
  dailyCostLimitUsd: 25,
  acceptUnknownConfidenceOnSuccess: true,
  executionBoundary: {
    mode: "proxied",
    // VITE_ATLAS_PROXY_URL is safe to expose to the browser bundle — it's
    // a URL, not a secret. Contrast with OPENROUTER_API_KEY/NVIDIA_API_KEY,
    // which must NEVER be read via import.meta.env — see openrouter-
    // provider.ts's header comment. `import.meta.env` is undefined outside
    // Vite (e.g. when this file is imported by server/ai-proxy-server.ts
    // under plain Node), so this is read with optional chaining rather
    // than assumed to exist.
    proxyBaseUrl: (import.meta as any).env?.VITE_ATLAS_PROXY_URL ?? "http://localhost:8787",
  },
  featureFlags: {
    openrouterEnabled: true,
    nvidiaEnabled: true,
    attributeAiCostsToTradeSpark: false,
  },
};
