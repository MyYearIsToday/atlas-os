import type { BusinessIntelligence } from "../evidence/business-intelligence";
import type { AtlasPersistence } from "../persistence/atlas-persistence";
import { InMemoryBusinessRepository } from "./business-repository";

/**
 * The existing Scout repository with its writes mirrored to durable storage. After a restart,
 * hydrate() restores every business and its external-key index, so rediscovery updates (not duplicates).
 */
export class DurableBusinessRepository extends InMemoryBusinessRepository {
  constructor(private persistence: AtlasPersistence) { super(); }

  upsert(record: BusinessIntelligence, externalKey?: { source: string; externalId: string }): void {
    super.upsert(record, externalKey);
    this.persistence.put("business", record.id, record);
    if (externalKey) this.persistence.put("external_key", `${externalKey.source}:${externalKey.externalId}`, { id: record.id, ...externalKey });
  }

  async hydrate(): Promise<{ businesses: number; externalKeys: number }> {
    const businesses = await this.persistence.loadAll("business");
    const keys = await this.persistence.loadAll("external_key");
    const byId = new Map(businesses.map((b) => [b.id, b.doc as BusinessIntelligence]));
    const keyed = new Set<string>();
    for (const k of keys) {
      const record = byId.get(k.doc.id);
      if (record) { super.upsert(record, { source: k.doc.source, externalId: k.doc.externalId }); keyed.add(record.id); }
    }
    for (const [id, record] of byId) if (!keyed.has(id)) super.upsert(record);
    return { businesses: businesses.length, externalKeys: keys.length };
  }
}
