import type { WorkforceConfig } from "./workforce-config";
import { ProxiedAIProvider } from "./proxied-provider";
import type { WorkerRole } from "../orchestrator/orchestration-types";

/**
 * Sprint 5F — opt-in client wiring. `defaultWorkforceConfig` is deliberately NOT modified (prepending a
 * tier would shift tierIndex semantics Sprints 5C-5E rely on). Use `withWorkforceRouting(config)` and
 * register `createWorkforceProxiedProvider(...)` to send Orchestrator worker roles through the
 * server-side Workforce Router first; legacy openrouter/nvidia tiers remain as escalation.
 * `finance` is never routed to the free workforce.
 */
export function withWorkforceRouting(config: WorkforceConfig): WorkforceConfig {
  const map = { ...config.workerProviderMap };
  (Object.keys(map) as WorkerRole[]).forEach((role) => {
    if (role !== "finance") map[role] = ["workforce", ...map[role]];
  });
  return { ...config, workerProviderMap: map, modelDefaults: { ...config.modelDefaults, workforce: "workforce-auto" } };
}

export function createWorkforceProxiedProvider(proxyBaseUrl: string, fetchImpl?: typeof fetch): ProxiedAIProvider {
  return new ProxiedAIProvider({ proxyBaseUrl, targetProviderId: "workforce", fetchImpl });
}
