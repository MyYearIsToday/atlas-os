import type { BusinessIntelligence } from "../services/evidence/business-intelligence";
import type { OpportunityInput } from "../services/scoring/opportunity-score";
import type { OpportunityScore } from "../services/scoring/opportunity-types";
import { OPPORTUNITY_WEIGHTS } from "../services/scoring/opportunity-weights";
import type { AuditRecommendation, MapSparkAudit } from "../services/audit/audit-types";
import type { AuditGeneratorInput } from "../services/audit/audit-inputs";
import type { MissionQueueRepository, Task } from "../services/mission-queue";
import { createInMemoryMissionQueue } from "../services/mission-queue";
import type { EvidenceRecord } from "../services/evidence/evidence";
import type { EvidenceCollector } from "../services/evidence/acquisition";
import type { MultimodalIntelligence, MultimodalObservation } from "../services/multimodal-intelligence/service";
import type { AtlasPersistence, Collection } from "../services/persistence/atlas-persistence";
import { buildOpportunities } from "../services/scoring/opportunity-recommendations";
import { OperationalLedger } from "../services/finance/ledger";
import type { FinancialTransaction } from "../services/finance/finance-types";

/**
 * Atlas pipeline wiring for BusinessDiscovered -> Evidence -> Score -> Audit -> Mission.
 *
 * Honesty rules (see DECISION_LOG): discovery data proves only that a business exists and
 * which profile fields a provider returned. It says nothing about visibility, competitors,
 * commercial value, conversion or demand, so those score components are recorded as
 * NOT_OBSERVABLE and a numeric opportunity score is WITHHELD until enough of the methodology
 * is actually observed. Nothing here invents evidence, and no AI output is ever stored as evidence.
 */

/** A numeric opportunity score needs at least this much of the methodology's weight observed. */
export const MIN_SCORABLE_WEIGHT = 50;

export type PipelineStage = "intake" | "evidence" | "score" | "audit" | "mission" | "execution" | "finance";

export interface ProvenanceEvidence {
  id: string;
  businessId: string;
  field: "name" | "category" | "address" | "coordinates" | "phone" | "website";
  sources: string[];
  recordedAt: string;
}

export interface PipelineTraceEntry {
  at: string;
  stage: PipelineStage;
  event: string;
  businessId: string | null;
  handler: string;
  state: string;
  nextEvent?: string;
  error?: string;
}

export interface MissionOutput { generatedBy: string; text: string; isEvidence: false }

/** A Map that reports every mutation so a durable store can mirror it. */
class ObservedMap<V> extends Map<string, V> {
  constructor(private notify: (id: string, value: V | null) => void) { super(); }
  set(key: string, value: V) { super.set(key, value); this.notify(key, value); return this; }
  delete(key: string) { const had = super.delete(key); if (had) this.notify(key, null); return had; }
  restore(key: string, value: V) { super.set(key, value); }
}
class ObservedSet extends Set<string> {
  constructor(private notify: (id: string) => void) { super(); }
  add(value: string) { super.add(value); this.notify(value); return this; }
  restore(value: string) { super.add(value); }
}

export class PipelineStore {
  readonly businesses: ObservedMap<BusinessIntelligence>;
  /** Discovery-record provenance (which profile fields the provider returned). */
  readonly evidence: ObservedMap<ProvenanceEvidence[]>;
  /** Externally collected observations (website, peers) as standard EvidenceRecords. */
  readonly observations: ObservedMap<EvidenceRecord[]>;
  /** AI media observations are stored separately; they are not EvidenceRecords or score inputs. */
  readonly multimodalObservations: ObservedMap<MultimodalObservation[]>;
  readonly scores: ObservedMap<OpportunityScore>;
  readonly audits: ObservedMap<MapSparkAudit>;
  /** AI work products. Never evidence: isEvidence is always false. */
  readonly missionOutputs: ObservedMap<MissionOutput>;
  readonly trace: PipelineTraceEntry[] = [];
  /** Businesses that have entered the pipeline; a re-discovery must not spawn duplicate audits or missions. */
  readonly started: ObservedSet;
  private traceSeq = 0;

  constructor(private persistence?: AtlasPersistence) {
    const bind = <V,>(c: Collection) => new ObservedMap<V>((id, v) => (v === null ? persistence?.remove(c, id) : persistence?.put(c, id, v)));
    this.businesses = bind("business");
    this.evidence = bind("evidence");
    this.observations = bind("observations");
    this.multimodalObservations = bind("multimodal_observations");
    this.scores = bind("score");
    this.audits = bind("audit");
    this.missionOutputs = bind("mission_output");
    this.started = new ObservedSet((id) => persistence?.put("started", id, { id }));
  }

  record(entry: Omit<PipelineTraceEntry, "at">) {
    const full = { at: new Date().toISOString(), ...entry };
    this.trace.push(full);
    this.persistence?.put("trace", String(++this.traceSeq).padStart(9, "0"), full);
  }

  /** Rebuilds the in-memory working set from durable storage without re-writing it. */
  async hydrate(limitTrace = 500): Promise<Record<string, number>> {
    const p = this.persistence;
    if (!p) return {};
    const fill = async <V,>(c: Collection, map: ObservedMap<V>) => { const rows = await p.loadAll(c); rows.forEach((r) => map.restore(r.id, r.doc)); return rows.length; };
    const counts = {
      businesses: await fill("business", this.businesses), evidence: await fill("evidence", this.evidence), observations: await fill("observations", this.observations),
      multimodalObservations: await fill("multimodal_observations", this.multimodalObservations),
      scores: await fill("score", this.scores), audits: await fill("audit", this.audits), missionOutputs: await fill("mission_output", this.missionOutputs),
      started: 0, trace: 0,
    };
    (await p.loadAll("started")).forEach((r) => { this.started.restore(r.id); counts.started++; });
    const trace = await p.loadAll("trace");
    this.traceSeq = trace.length ? Math.max(...trace.map((r) => Number(r.id))) : 0;
    trace.slice(-limitTrace).forEach((r) => this.trace.push(r.doc));
    counts.trace = trace.length;
    return counts;
  }
}

export interface PipelineDeps {
  store: PipelineStore;
  missionQueue: MissionQueueRepository;
  /** Only businesses with one of these source references enter the pipeline. Undefined = all. */
  allowedSources?: string[];
  /** Real evidence sources run on BusinessDiscovered. Empty/undefined = discovery provenance only. */
  collectors?: EvidenceCollector[];
  /** Optional additive analysis layer; its output is never passed to scoring as evidence. */
  multimodalIntelligence?: MultimodalIntelligence;
  /** Called after MissionCreated for every new task; the runner decides whether it may execute. */
  onMissionCreated?: (task: Task) => Promise<void>;
  /** Late-bound by the orchestrator so handlers can emit MissionCreated for additional tasks. */
  emit?: (type: "MissionCreated", payload: { businessId: string; taskId: string }) => Promise<unknown>;
  persistence?: AtlasPersistence;
  /** Processed-event IDs loaded at startup so replay after a restart is still deduplicated. */
  restoredEvents?: Array<{ eventId: string; processedAtMs: number }>;
}

export function createPipelineDeps(options: { allowedSources?: string[]; missionQueue?: MissionQueueRepository; collectors?: EvidenceCollector[]; multimodalIntelligence?: MultimodalIntelligence } = {}): PipelineDeps {
  return { store: new PipelineStore(), missionQueue: options.missionQueue ?? createInMemoryMissionQueue(), allowedSources: options.allowedSources, collectors: options.collectors, multimodalIntelligence: options.multimodalIntelligence };
}

/** Ledger whose postings are mirrored to durable storage. Hydration replays them without re-persisting. */
export class DurableLedger extends OperationalLedger {
  constructor(private persistence?: AtlasPersistence) { super(); }
  post(t: FinancialTransaction, actorId: string) {
    const posted = super.post(t, actorId);
    this.persistence?.put("ledger", t.transactionId, t);
    return posted;
  }
  reverse(originalId: string, reversal: FinancialTransaction, actorId: string) {
    const posted = super.reverse(originalId, reversal, actorId);
    const original = this.list().find((x) => x.transactionId === originalId);
    if (original) this.persistence?.put("ledger", originalId, original);
    return posted;
  }
  async hydrate(): Promise<number> {
    const rows = (await this.persistence?.loadAll("ledger")) ?? [];
    const saved = this.persistence;
    this.persistence = undefined;
    try { rows.forEach((r) => OperationalLedger.prototype.post.call(this, r.doc, "system:hydrate")); } finally { this.persistence = saved; }
    return rows.length;
  }
}

/** Builds the pipeline's working set from PostgreSQL. Missions, evidence, scores, audits, ledger and idempotency all survive restart. */
export async function createDurablePipelineDeps(persistence: AtlasPersistence, options: { allowedSources?: string[]; collectors?: EvidenceCollector[]; multimodalIntelligence?: MultimodalIntelligence } = {}): Promise<{ deps: PipelineDeps; ledger: DurableLedger; hydrated: Record<string, number> }> {
  const store = new PipelineStore(persistence);
  const hydrated = await store.hydrate();
  const tasks = (await persistence.loadAll("mission")).map((r) => r.doc as Task).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const missionQueue = createInMemoryMissionQueue(tasks, (next, previous) => {
    const before = new Map(previous.map((t) => [t.taskId, t]));
    for (const t of next) if (before.get(t.taskId) !== t) persistence.put("mission", t.taskId, t);
    const now = new Set(next.map((t) => t.taskId));
    for (const id of before.keys()) if (!now.has(id)) persistence.remove("mission", id);
  });
  const ledger = new DurableLedger(persistence);
  hydrated.ledger = await ledger.hydrate();
  hydrated.missions = tasks.length;
  const restoredEvents = await persistence.loadEvents();
  hydrated.processedEvents = restoredEvents.length;
  return { deps: { store, missionQueue, allowedSources: options.allowedSources, collectors: options.collectors, multimodalIntelligence: options.multimodalIntelligence, persistence, restoredEvents }, ledger, hydrated };
}

export function sourceAllowed(deps: PipelineDeps, business: BusinessIntelligence): boolean {
  if (!deps.allowedSources) return true;
  return business.sourceReferences.some((source) => deps.allowedSources!.includes(source));
}

/** Evidence is only what the discovery record actually contains. */
export function buildProvenanceEvidence(business: BusinessIntelligence, now = new Date().toISOString()): ProvenanceEvidence[] {
  const present: Array<[ProvenanceEvidence["field"], boolean]> = [
    ["name", !!business.canonicalName],
    ["category", !!business.category],
    ["address", !!business.address],
    ["coordinates", typeof business.latitude === "number" && typeof business.longitude === "number"],
    ["phone", !!business.phone],
    ["website", !!business.website],
  ];
  return present.filter(([, has]) => has).map(([field]) => ({
    id: `ev:${business.id}:${field}`,
    businessId: business.id,
    field,
    sources: [...business.sourceReferences],
    recordedAt: now,
  }));
}

const NOT_OBSERVED: Record<string, string> = {
  visibilityWeakness: "The business's own website has not been observed (none listed, or it could not be checked).",
  competitiveGap: "No peer benchmark has been collected.",
  commercialValue: "No commercial-value signal has been collected.",
  conversionReadiness: "No contact or conversion signals have been collected.",
  demandIntent: "No demand-intent signal has been collected.",
  executionFeasibility: "No feasibility assessment has been made.",
};

type Component = OpportunityInput["components"][number];

/**
 * Component convention (matches buildOpportunities, which flags values < 0.7 as improvement areas):
 * normalizedValue is how well the business does on that dimension, 0..1. Every value below is a
 * stated ratio of directly observed checks; unobserved dimensions stay NOT_OBSERVABLE.
 */
export function buildOpportunityInput(business: BusinessIntelligence, evidence: ProvenanceEvidence[], observations: EvidenceRecord[] = []): OpportunityInput {
  const rec = (field: string) => observations.find((r) => r.field === field);
  const yes = (field: string) => rec(field)?.observability === "OBSERVED_PRESENT";
  const ids = (fields: string[]) => fields.map((f) => rec(f)?.evidenceId).filter((x): x is string => !!x);
  const profileFields = 6;
  const pageFields: Array<[string, string]> = [["page title", "title"], ["meta description", "meta_description"], ["primary heading", "primary_heading"]];
  // Evidence only exists for extracted fields, so any HTML field proves a page was actually read.
  const pageRead = pageFields.some(([, f]) => !!rec(f));

  const ratio = (key: keyof typeof OPPORTUNITY_WEIGHTS, checks: Array<[string, boolean]>, refs: string[], confidence: "HIGH" | "MEDIUM", why: string): Component => {
    const passed = checks.filter(([, ok]) => ok).length;
    return {
      key, weight: OPPORTUNITY_WEIGHTS[key], maxValue: checks.length, rawValue: passed, normalizedValue: passed / checks.length, evidenceRefs: refs,
      confidence, observability: "OBSERVED_PRESENT" as const,
      explanation: `${why}: ${checks.map(([name, ok]) => `${name} ${ok ? "yes" : "no"}`).join(", ")}.`,
    };
  };

  const components: Component[] = (Object.keys(OPPORTUNITY_WEIGHTS) as Array<keyof typeof OPPORTUNITY_WEIGHTS>).map((key) => {
    const weight = OPPORTUNITY_WEIGHTS[key];
    if (key === "evidenceQuality") {
      return { key, weight, maxValue: profileFields, rawValue: evidence.length, normalizedValue: evidence.length / profileFields, evidenceRefs: evidence.map((e) => e.id), confidence: "MEDIUM" as const, observability: "OBSERVED_PRESENT" as const, explanation: `${evidence.length} of ${profileFields} profile fields were returned by the discovery provider.` };
    }
    if (key === "visibilityWeakness" && pageRead) {
      return ratio(key, pageFields.map(([name, f]) => [name, yes(f)] as [string, boolean]), ids(pageFields.map(([, f]) => f)), "MEDIUM", "Basic content of a public web page for this business (ownership not independently verified)");
    }
    const peers = rec("peers.websiteRate") as unknown as { value?: { websiteRate: number; subjectHasWebsite: boolean; peerCount: number; peersWithWebsite: number }; evidenceId: string } | undefined;
    if (key === "competitiveGap" && peers?.value) {
      const v = peers.value;
      const normalized = v.subjectHasWebsite ? 1 : 1 - v.websiteRate;
      return { key, weight, maxValue: 1, rawValue: normalized, normalizedValue: normalized, evidenceRefs: [peers.evidenceId], confidence: "MEDIUM" as const, observability: "OBSERVED_PRESENT" as const, explanation: `${v.peersWithWebsite} of ${v.peerCount} nearby same-category peers list a website; this business ${v.subjectHasWebsite ? "also lists one" : "does not"} (directory coverage is a lower bound).` };
    }
    return { key, weight, maxValue: 1, rawValue: null, normalizedValue: null, evidenceRefs: [], confidence: "UNKNOWN" as const, observability: "NOT_OBSERVABLE" as const, explanation: NOT_OBSERVED[key] ?? "Not observed." };
  });
  const observedWeight = components.filter((c) => c.observability !== "NOT_OBSERVABLE").reduce((n, c) => n + c.weight, 0);
  const peersObserved = components.some((c) => c.key === "competitiveGap" && c.observability !== "NOT_OBSERVABLE");
  const opportunities = buildOpportunities(components.map((c) => ({ ...c, weightedContribution: (c.normalizedValue ?? 0) * c.weight })) as never).map((o: { id: string }, i: number) => ({ ...o, id: `opp:${business.id}:${i}` }));
  return { businessId: business.id, components, evidenceCoverage: observedWeight, competitorCoverage: peersObserved ? 100 : 0, opportunities } as OpportunityInput;
}

export interface ScoringOutcome {
  score: OpportunityScore;
  scorable: boolean;
  observedWeight: number;
  missing: string[];
}

/** Applies the minimum-observability gate on top of the existing calculator; never edits component values. */
export function applyScoringGate(raw: OpportunityScore): ScoringOutcome {
  const usable = raw.components.filter((c) => c.normalizedValue !== null && c.observability !== "NOT_OBSERVABLE" && c.observability !== "CONFLICTING");
  const observedWeight = usable.reduce((n, c) => n + c.weight, 0);
  const missing = raw.components.filter((c) => !usable.includes(c)).map((c) => c.key);
  if (observedWeight >= MIN_SCORABLE_WEIGHT) return { score: raw, scorable: true, observedWeight, missing };
  return {
    scorable: false,
    observedWeight,
    missing,
    score: {
      ...raw,
      overallScore: null,
      blockers: [
        ...raw.blockers,
        {
          id: `blocker:${raw.businessId}:insufficient-evidence`,
          title: "Opportunity score withheld",
          reason: `Only ${observedWeight}% of the scoring methodology is observable (minimum ${MIN_SCORABLE_WEIGHT}%). Not observed: ${missing.join(", ")}.`,
          evidenceRefs: raw.evidenceRefs,
          confidence: "HIGH",
        },
      ],
    },
  };
}

/** The only mission type that may start itself: a summary of Atlas-owned data for the operator. No external side effects. */
export const INTERNAL_AUDIT_SUMMARY = "internal_audit_summary";

/** Facts handed to the summary mission, built only from Atlas's own stored state. */
function summaryFacts(business: BusinessIntelligence, outcome: ScoringOutcome, observations: EvidenceRecord[]): string {
  const observed = observations.map((r) => `${r.field}=${r.observability === "OBSERVED_PRESENT" ? "present" : "absent"}`).join("; ") || "none";
  const score = outcome.score.overallScore === null ? "withheld" : `${outcome.score.overallScore}/100`;
  const weak = outcome.score.keyOpportunities.map((o) => o.title).join("; ") || "none identified";
  return `Summarize this audit for the operator using ONLY these facts; do not invent anything. Business: ${business.canonicalName} (${business.category ?? "uncategorized"}, ${business.address ?? "no address"}). Opportunity score: ${score}. Observed website/peer signals: ${observed}. Improvement areas: ${weak}. Not observed: ${outcome.missing.join(", ") || "nothing"}.`;
}

export function buildAuditInput(business: BusinessIntelligence, evidence: ProvenanceEvidence[], outcome: ScoringOutcome, observations: EvidenceRecord[] = [], multimodalObservations: MultimodalObservation[] = []): AuditGeneratorInput {
  const recommendations: AuditRecommendation[] = outcome.scorable
    ? outcome.score.keyOpportunities.map((opportunity): AuditRecommendation => ({
        recommendationId: `rec:${opportunity.id}`,
        action: opportunity.recommendedAction,
        reason: opportunity.description,
        evidenceRefs: [],
        confidence: opportunity.confidence,
        estimatedEffort: opportunity.effort,
        approvalLevel: "INTERNAL_REVIEW",
        status: "OPEN" as const,
      })).concat(summaryRecommendation(business, outcome, observations))
    : [
        {
          recommendationId: `rec:${business.id}:collect-missing-evidence`,
          action: "Collect missing evidence",
          reason: `Opportunity score withheld: only ${outcome.observedWeight}% of the methodology is observable. Needed: ${outcome.missing.join(", ")}.`,
          evidenceRefs: [],
          confidence: "HIGH",
          estimatedEffort: "medium",
          approvalLevel: "INTERNAL_REVIEW",
          missionType: "collect_missing_evidence",
          status: "OPEN" as const,
        },
      ];
  return {
    business,
    evidence: [...evidence, ...observations],
    multimodalObservations,
    evidenceCoverage: outcome.score.evidenceCoverage,
    visibilityScore: null,
    competitorGaps: [],
    competitorBenchmark: null,
    opportunityScore: outcome.score,
    recommendations,
    quickWins: [],
    generatedBy: "atlas-pipeline",
    methodologyVersion: outcome.score.version,
  };
}

function summaryRecommendation(business: BusinessIntelligence, outcome: ScoringOutcome, observations: EvidenceRecord[]): AuditRecommendation[] {
  return [{
    recommendationId: `rec:${business.id}:${INTERNAL_AUDIT_SUMMARY}`,
    action: "Prepare internal audit summary",
    reason: summaryFacts(business, outcome, observations),
    evidenceRefs: [],
    confidence: "HIGH",
    estimatedEffort: "low",
    approvalLevel: "AUTO",
    missionType: INTERNAL_AUDIT_SUMMARY,
    status: "OPEN" as const,
  }];
}
