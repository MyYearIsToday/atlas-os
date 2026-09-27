import type { ProviderRegistry } from "./provider-registry";
import type { WorkforceConfig } from "./workforce-config";
import type { AIJobRequest, ProviderId } from "./provider-types";
import type { AIProvider } from "./provider-interface";

/**
 * Worker -> Model Router -> Provider -> Model. The Orchestrator never picks
 * a provider directly; this is the only place that turns a worker role
 * into a concrete `AIProvider` instance. Fully deterministic: given the
 * same config, registry contents, and request, `selectProvider` always
 * returns the same provider for the same tier index. No randomness.
 */

export interface RoutingDecision {
  provider: AIProvider;
  providerId: ProviderId;
  tierIndex: number;
  model: string;
}

const providerEnabledFlag: Record<ProviderId, keyof WorkforceConfig["featureFlags"] | undefined> = {
  openrouter: "openrouterEnabled",
  nvidia: "nvidiaEnabled",
};

function isProviderEnabled(id: ProviderId, config: WorkforceConfig): boolean {
  const flag = providerEnabledFlag[id];
  if (!flag) return true; // unknown/custom providers default to enabled unless explicitly flagged off elsewhere
  return config.featureFlags[flag];
}

/**
 * Selects the provider for `request.workerRole` at `tierIndex` in the
 * configured worker->provider order, skipping disabled or unregistered
 * providers deterministically (in configured order, never by chance).
 * Returns null if no eligible provider exists at or after `tierIndex`.
 */
export function selectProvider(
  request: AIJobRequest,
  registry: ProviderRegistry,
  config: WorkforceConfig,
  tierIndex = 0,
): RoutingDecision | null {
  const order = config.workerProviderMap[request.workerRole];
  if (!order) return null;

  for (let i = tierIndex; i < order.length; i++) {
    const providerId = order[i];
    if (!isProviderEnabled(providerId, config)) continue;
    const provider = registry.getProvider(providerId);
    if (!provider) continue;
    return {
      provider,
      providerId,
      tierIndex: i,
      model: request.model ?? config.modelDefaults[providerId] ?? "unspecified-model",
    };
  }
  return null;
}

export function nextTier(decision: RoutingDecision): number {
  return decision.tierIndex + 1;
}
