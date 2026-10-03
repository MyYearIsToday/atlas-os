import type { BusinessIntelligence } from "./business-intelligence";
import type { EvidenceRecord } from "./evidence";

/** An evidence source. Collectors never throw; a failure is an outcome, never evidence. */
export interface CollectorOutcome {
  source: string;
  status: "collected" | "skipped" | "failed";
  records: EvidenceRecord[];
  failure?: { code: string; message: string };
  hops?: string[];
}

export interface EvidenceCollector {
  readonly source: string;
  collect(business: BusinessIntelligence): Promise<CollectorOutcome>;
}

/** Runs collectors in order; one failing source never blocks the others or crashes Scout. */
export async function acquireEvidence(business: BusinessIntelligence, collectors: EvidenceCollector[]): Promise<{ records: EvidenceRecord[]; outcomes: CollectorOutcome[] }> {
  const outcomes: CollectorOutcome[] = [];
  for (const collector of collectors) {
    try {
      outcomes.push(await collector.collect(business));
    } catch (e) {
      outcomes.push({ source: collector.source, status: "failed", records: [], failure: { code: "collector_error", message: e instanceof Error ? e.message : "unknown error" } });
    }
  }
  const byId = new Map<string, EvidenceRecord>();
  for (const outcome of outcomes) for (const record of outcome.records) byId.set(record.evidenceId, record); // deterministic IDs: last write wins
  return { records: [...byId.values()], outcomes };
}
