import type { BusinessIntelligence } from "../evidence/business-intelligence";

/**
 * Scout discovery loop — business record store.
 *
 * No repository for BusinessIntelligence existed before this. The CRM/
 * Mission Queue repository pattern in this codebase is browser-backed and
 * unavailable in the Node process, so this server-side seam uses memory.
 * A future persistent provider can implement the same interface.
 */
export interface BusinessRepository {
  get(id: string): BusinessIntelligence | undefined;
  /** Stable identity for a source candidate, independent of fuzzy matching. */
  findByExternalKey(source: string, externalId: string): BusinessIntelligence | undefined;
  list(): BusinessIntelligence[];
  upsert(record: BusinessIntelligence, externalKey?: { source: string; externalId: string }): void;
}

export class InMemoryBusinessRepository implements BusinessRepository {
  private byId = new Map<string, BusinessIntelligence>();
  private byExternalKey = new Map<string, string>();

  get(id: string): BusinessIntelligence | undefined {
    return this.byId.get(id);
  }

  findByExternalKey(source: string, externalId: string): BusinessIntelligence | undefined {
    const id = this.byExternalKey.get(`${source}:${externalId}`);
    return id ? this.byId.get(id) : undefined;
  }

  list(): BusinessIntelligence[] {
    return [...this.byId.values()];
  }

  upsert(record: BusinessIntelligence, externalKey?: { source: string; externalId: string }): void {
    this.byId.set(record.id, record);
    if (externalKey) this.byExternalKey.set(`${externalKey.source}:${externalKey.externalId}`, record.id);
  }
}