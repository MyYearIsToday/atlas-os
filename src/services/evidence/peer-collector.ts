import type { BusinessDiscoveryProvider } from "./provider-interfaces";
import type { BusinessIntelligence } from "./business-intelligence";
import type { EvidenceRecord } from "./evidence";
import type { CollectorOutcome, EvidenceCollector } from "./acquisition";

export const MIN_PEERS = 5;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Peer benchmark: how many nearby same-category businesses list a website, taken from the same
 * discovery provider Scout already uses. Needs coordinates, a category the provider understands and at
 * least MIN_PEERS peers; otherwise it records nothing rather than guessing.
 */
export class PeerBenchmarkCollector implements EvidenceCollector {
  readonly source = "peers";
  constructor(private options: { provider: BusinessDiscoveryProvider; radiusMeters?: number; sourceUrl: string; nowIso?: () => string }) {}

  async collect(business: BusinessIntelligence): Promise<CollectorOutcome> {
    const skip = (code: string, message: string): CollectorOutcome => ({ source: this.source, status: "skipped", records: [], failure: { code, message } });
    if (typeof business.latitude !== "number" || typeof business.longitude !== "number") return skip("no_coordinates", "business has no coordinates");
    if (!business.category) return skip("no_category", "business has no category");
    const radiusMeters = this.options.radiusMeters ?? 2000;
    try {
      const found = await this.options.provider.discover({ latitude: business.latitude, longitude: business.longitude, radiusMeters, categories: [business.category] });
      const self = norm(business.canonicalName);
      const peers = new Map(found.filter((c) => norm(c.name) !== self).map((c) => [c.externalId, c]));
      if (peers.size < MIN_PEERS) return skip("too_few_peers", `only ${peers.size} peers found (minimum ${MIN_PEERS})`);
      const withWebsite = [...peers.values()].filter((p) => !!p.website).length;
      const at = (this.options.nowIso ?? (() => new Date().toISOString()))();
      const record = {
        evidenceId: `ev:${business.id}:peers.websiteRate`, businessId: business.id, field: "peers.websiteRate",
        value: { peerCount: peers.size, peersWithWebsite: withWebsite, websiteRate: withWebsite / peers.size, subjectHasWebsite: !!business.website, radiusMeters, category: business.category },
        sourceType: "other_permitted_source", sourceUrl: this.options.sourceUrl, evidenceType: "directory_record", observedAt: at, retrievedAt: at,
        confidence: "MEDIUM", verificationStatus: "UNVERIFIED", collector: "connector", humanReviewRequired: false, observability: "OBSERVED_PRESENT",
        notes: "Directory coverage of websites is incomplete; treat the rate as a lower bound.",
      } as unknown as EvidenceRecord;
      return { source: this.source, status: "collected", records: [record] };
    } catch (e) {
      return { source: this.source, status: "failed", records: [], failure: { code: "peer_lookup_failed", message: e instanceof Error ? e.message : "unknown error" } };
    }
  }
}
