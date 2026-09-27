import type { AIProvider } from "./provider-interface";
import type { ProviderHealth, ProviderId } from "./provider-types";

export class DuplicateProviderError extends Error {
  constructor(id: ProviderId) {
    super(`Provider "${id}" is already registered. Call removeProvider() first if replacement is intentional.`);
    this.name = "DuplicateProviderError";
  }
}

/**
 * Same "never silently overwrite" discipline as the Sprint 5B Handler
 * Registry — a provider is registered once; replacing one is a deliberate
 * removeProvider() + registerProvider() pair, never an implicit overwrite.
 */
export class ProviderRegistry {
  private providers = new Map<ProviderId, AIProvider>();

  registerProvider(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      throw new DuplicateProviderError(provider.id);
    }
    this.providers.set(provider.id, provider);
  }

  removeProvider(id: ProviderId): boolean {
    return this.providers.delete(id);
  }

  getProvider(id: ProviderId): AIProvider | null {
    return this.providers.get(id) ?? null;
  }

  listProviders(): ProviderId[] {
    return [...this.providers.keys()];
  }

  async healthSummary(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const provider of this.providers.values()) {
      results.push(await provider.healthCheck());
    }
    return results;
  }
}
