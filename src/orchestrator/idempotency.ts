import type { OrchestrationEventType } from "./orchestration-types";

/**
 * Deterministic duplicate detection. `computeEventId` is a pure hash of
 * type+payload (FNV-1a, no randomness, no Date.now() in the hash itself) so
 * the same logical event always maps to the same id even if the caller
 * doesn't supply one explicitly. A caller-supplied `eventId` always takes
 * priority when present, since it can encode intent a payload hash cannot
 * (e.g. "this specific webhook delivery").
 */
export function computeEventId(type: OrchestrationEventType, payload: unknown): string {
  const json = `${type}:${JSON.stringify(payload)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `evt-${(hash >>> 0).toString(16)}`;
}

interface CacheRecord {
  processedAt: number;
  expiresAt: number;
}

export class ProcessedEventCache {
  private records = new Map<string, CacheRecord>();

  constructor(private ttlMs: number) {}

  /** True if this eventId was already processed and its TTL hasn't expired. Expired entries are treated as not-processed (and pruned). */
  hasProcessed(eventId: string, now: number = Date.now()): boolean {
    const record = this.records.get(eventId);
    if (!record) return false;
    if (record.expiresAt <= now) {
      this.records.delete(eventId);
      return false;
    }
    return true;
  }

  markProcessed(eventId: string, now: number = Date.now()): void {
    this.records.set(eventId, { processedAt: now, expiresAt: now + this.ttlMs });
  }

  size(): number {
    return this.records.size;
  }
}
