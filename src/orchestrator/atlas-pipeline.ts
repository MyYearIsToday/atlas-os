import type { BusinessIntelligence } from "../services/evidence/business-intelligence";
import type { OpportunityInput } from "../services/scoring/opportunity-score";
import type { OpportunityScore } from "../services/scoring/opportunity-types";
import { OPPORTUNITY_WEIGHTS } from "../services/scoring/opportunity-weights";
import type { AuditRecommendation, MapSparkAudit } from "../services/audit/audit-types";
import type { AuditGeneratorInput } from "../services/audit/audit-inputs";
import type { MissionQueueRepository, Task } from "../services/mission-queue";
import { createInMemoryMissionQueue } from "../services/mission-queue";

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

export class PipelineStore {
  readonly businesses = new Map<string, BusinessIntelligence>();
  readonly evidence = new Map<string, ProvenanceEvidence[]>();
  readonly scores = new Map<string, OpportunityScore>();
  readonly audits = new Map<string, MapSparkAudit>();
  readonly missionOutputs = new Map<string, { generatedBy: string; text: string; isEvidence: false }>();
  readonly trace: PipelineTraceEntry[] = [];
  /** Businesses that have entered the pipeline; a re-discovery must not spawn duplicate audits or missions. */
  readonly started = new Set<string>();

  record(entry: Omit<PipelineTraceEntry, "at">) {
    this.trace.push({ at: new Date().toISOString(), ...entry });
  }
}

export interface PipelineDeps {
  store: PipelineStore;
  missionQueue: MissionQueueRepository;
  /** Only businesses with one of these source references enter the pipeline. Undefined = all. */
  allowedSources?: string[];
  /** Called after MissionCreated for every new task; the runner decides whether it may execute. */
  onMissionCreated?: (task: Task) => Promise<void>;
}

export function createPipelineDeps(options: { allowedSources?: string[]; missionQueue?: MissionQueueRepository } = {}): PipelineDeps {
  return { store: new PipelineStore(), missionQueue: options.missionQueue ?? createInMemoryMissionQueue(), allowedSources: options.allowedSources };
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
  visibilityWeakness: "No visibility data (reviews, photos, profile completeness) has been collected.",
  competitiveGap: "No competitor benchmark has been collected.",
  commercialValue: "No commercial-value signal has been collected.",
  conversionReadiness: "No website or booking-flow observation has been collected.",
  demandIntent: "No demand-intent signal has been collected.",
  executionFeasibility: "No feasibility assessment has been made.",
};

export function buildOpportunityInput(business: BusinessIntelligence, evidence: ProvenanceEvidence[]): OpportunityInput {
  const keys = Object.keys(OPPORTUNITY_WEIGHTS) as Array<keyof typeof OPPORTUNITY_WEIGHTS>;
  const profileFields = 6;
  const components = keys.map((key) => {
    const weight = OPPORTUNITY_WEIGHTS[key];
    if (key === "evidenceQuality") {
      return {
        key, weight, maxValue: profileFields, rawValue: evidence.length, normalizedValue: evidence.length / profileFields,
        evidenceRefs: evidence.map((e) => e.id), confidence: "MEDIUM" as const, observability: "OBSERVED_PRESENT" as const,
        explanation: `${evidence.length} of ${profileFields} profile fields were returned by the discovery provider.`,
      };
    }
    return {
      key, weight, maxValue: 1, rawValue: null, normalizedValue: null, evidenceRefs: [],
      confidence: "UNKNOWN" as const, observability: "NOT_OBSERVABLE" as const, explanation: NOT_OBSERVED[key] ?? "Not observed.",
    };
  });
  const observedWeight = components.filter((c) => c.observability !== "NOT_OBSERVABLE").reduce((n, c) => n + c.weight, 0);
  return { businessId: business.id, components, evidenceCoverage: observedWeight, competitorCoverage: 0 };
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

export function buildAuditInput(business: BusinessIntelligence, evidence: ProvenanceEvidence[], outcome: ScoringOutcome): AuditGeneratorInput {
  const recommendations: AuditRecommendation[] = outcome.scorable
    ? outcome.score.keyOpportunities.map((opportunity) => ({
        recommendationId: `rec:${opportunity.id}`,
        action: opportunity.recommendedAction,
        reason: opportunity.description,
        evidenceRefs: [],
        confidence: opportunity.confidence,
        estimatedEffort: opportunity.effort,
        approvalLevel: "INTERNAL_REVIEW",
        status: "OPEN" as const,
      }))
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
    evidence,
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
