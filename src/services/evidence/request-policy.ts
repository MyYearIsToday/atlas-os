export interface RequestPolicy { minIntervalMs: number; maxRetries: number; backoffBaseMs: number; cacheTtlMs: number; }
export const defaultRequestPolicies: Record<string, RequestPolicy> = {
  nominatim: { minIntervalMs: 1000, maxRetries: 2, backoffBaseMs: 1000, cacheTtlMs: 30 * 86400000 },
  overpass: { minIntervalMs: 2000, maxRetries: 2, backoffBaseMs: 2000, cacheTtlMs: 7 * 86400000 },
  website: { minIntervalMs: 250, maxRetries: 1, backoffBaseMs: 1000, cacheTtlMs: 7 * 86400000 }
};
export function backoffDelay(attempt: number, baseMs: number): number { return baseMs * 2 ** attempt; }
