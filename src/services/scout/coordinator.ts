import {
  businessIntelligenceFromCandidate,
  createEvidenceRecord,
  evidenceForCandidate,
  type RecordFactoryOptions,
} from "../evidence/constructors";
import { assessDuplicate, type DuplicateAssessment } from "../evidence/business-deduplication";
import { fieldState } from "../evidence/conflicts";
import type { BusinessIntelligence } from "../evidence/business-intelligence";
import type {
  BusinessDiscoveryProvider,
  DiscoveryCandidate,
  GeocoderProvider,
} from "../evidence/provider-interfaces";
import type { EvidenceRecord } from "../evidence/evidence";
import { calculateOpportunityScore, type OpportunityInput } from "../scoring/opportunity-score";
import { validateOpportunityScore } from "../scoring/opportunity-validation";
import type { OpportunityScore, OpportunityScoreComponent } from "../scoring/opportunity-types";
import {
  createLocalPhase1Repositories,
  type Phase1Repositories,
} from "../phase1-repositories";
import { createScoutRun, updateScoutRun, type ScoutRun, type ScoutTargetArea } from "./scout-run";
import type { ScoutWorkflowState } from "./workflow";

export interface ScoutCoordinatorInput {
  target: string;
  radiusMeters: number;
  categories: string[];
}

export interface ScoutScoreBuilder {
  build(
    business: BusinessIntelligence,
    evidence: EvidenceRecord[],
  ): Pick<OpportunityInput, "components" | "competitorCoverage">;
}

export interface ScoutCoordinatorOptions {
  geocoder: GeocoderProvider;
  discovery: BusinessDiscoveryProvider;
  repositories?: Phase1Repositories;
  scoreBuilder?: ScoutScoreBuilder;
  minimumEvidenceRecords?: number;
  minimumEvidenceCoverage?: number;
  recordFactory?: RecordFactoryOptions;
  now?: () => Date;
}

export interface ScoutWorkflowResult {
  run: ScoutRun;
  businesses: BusinessIntelligence[];
  evidence: EvidenceRecord[];
  scores: OpportunityScore[];
  duplicateAssessments: Array<{ businessId: string; assessment: DuplicateAssessment }>;
  workflowStates: Record<string, ScoutWorkflowState>;
  validationErrors: string[];
}

function transitionState(
  from: ScoutWorkflowState,
  to: ScoutWorkflowState,
): ScoutWorkflowState {
  const transitions: Record<ScoutWorkflowState, ScoutWorkflowState[]> = {
    DISCOVERED: ["QUALIFIED", "BLOCKED"],
    QUALIFIED: ["EVIDENCE_COLLECTION", "BLOCKED"],
    EVIDENCE_COLLECTION: ["SCORED", "BLOCKED"],
    SCORED: ["AUDIT_READY", "BLOCKED"],
    AUDIT_READY: ["AUDIT_GENERATED", "BLOCKED"],
    AUDIT_GENERATED: ["ACTION_RECOMMENDED", "BLOCKED"],
    ACTION_RECOMMENDED: ["MISSION_CREATED", "BLOCKED"],
    MISSION_CREATED: [],
    BLOCKED: [],
  };
  if (!transitions[from].includes(to)) throw new Error(`Invalid Scout transition: ${from} -> ${to}`);
  return to;
}

function scoreIsAllowed(
  evidence: EvidenceRecord[],
  minimumEvidenceRecords: number,
  minimumEvidenceCoverage: number,
): boolean {
  if (evidence.length < minimumEvidenceRecords) return false;
  const fields = new Set(evidence.map((item) => item.field));
  return fields.size >= minimumEvidenceRecords && (fields.size / minimumEvidenceRecords) * 100 >= minimumEvidenceCoverage;
}

export class ScoutCoordinator {
  private readonly repositories: Phase1Repositories;
  private readonly now: () => Date;
  private readonly recordFactory: RecordFactoryOptions;

  constructor(private readonly options: ScoutCoordinatorOptions) {
    this.repositories = options.repositories ?? createLocalPhase1Repositories();
    this.now = options.now ?? (() => new Date());
    this.recordFactory = { ...options.recordFactory, now: this.now };
  }

  getRepositories(): Phase1Repositories {
    return this.repositories;
  }

  async run(input: ScoutCoordinatorInput): Promise<ScoutWorkflowResult> {
    const targetArea: ScoutTargetArea = {
      query: input.target.trim(),
      radiusMeters: input.radiusMeters,
      categories: [...input.categories],
    };
    const initialRun = createScoutRun({
      targetArea,
      idFactory: this.recordFactory.idFactory,
      now: this.now,
    });
    await this.repositories.scoutRuns.create(initialRun);

    const startedAt = this.now().toISOString();
    let run = updateScoutRun(initialRun, { status: "RUNNING", startedAt }, this.now);
    await this.repositories.scoutRuns.update(run.runId, run);

    const businesses: BusinessIntelligence[] = [];
    const evidence: EvidenceRecord[] = [];
    const scores: OpportunityScore[] = [];
    const duplicateAssessments: Array<{ businessId: string; assessment: DuplicateAssessment }> = [];
    const workflowStates: Record<string, ScoutWorkflowState> = {};
    const validationErrors: string[] = [];

    try {
      const geocoded = await this.options.geocoder.geocode(input.target);
      if (!geocoded) throw new Error(`Target area could not be geocoded: ${input.target}`);
      run = updateScoutRun(
        run,
        { targetArea: { ...targetArea, latitude: geocoded.latitude, longitude: geocoded.longitude } },
        this.now,
      );
      await this.repositories.scoutRuns.update(run.runId, run);

      const candidates = await this.options.discovery.discover({
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        radiusMeters: input.radiusMeters,
        categories: input.categories,
      });

      for (const candidate of candidates) {
        let business: BusinessIntelligence;
        try {
          business = businessIntelligenceFromCandidate(candidate, this.recordFactory);
        } catch (error) {
          validationErrors.push(error instanceof Error ? error.message : "Invalid discovery candidate");
          continue;
        }

        let state: ScoutWorkflowState = "DISCOVERED";
        const workflowId = `${run.runId}:${business.id}`;
        workflowStates[workflowId] = state;
        const existingBusinesses = [
          ...this.repositories.businesses.list(),
          ...businesses,
        ].filter((item) => item.id !== business.id);
        const assessment = existingBusinesses.reduce<DuplicateAssessment | null>(
          (best, existing) => {
            const current = assessDuplicate(existing, business);
            if (!best || current.score > best.score) return current;
            return best;
          },
          null,
        ) ?? { status: "NO_MATCH", score: 0, reasons: [], humanReviewRequired: false };
        duplicateAssessments.push({ businessId: business.id, assessment });

        const businessEvidence = evidenceForCandidate(business, candidate, this.recordFactory);
        const previousEvidence = this.repositories.evidence.listByBusiness(business.id);
        const conflictFields = new Set(
          businessEvidence
            .map((item) => item.field)
            .filter((field) => fieldState([...previousEvidence.filter((item) => item.field === field), ...businessEvidence.filter((item) => item.field === field)]) === "CONFLICTING"),
        );
        if (conflictFields.size > 0) {
          business = { ...business, status: "CONFLICT", updatedAt: this.now().toISOString() };
        }

        state = transitionState(state, "QUALIFIED");
        workflowStates[workflowId] = state;
        state = transitionState(state, "EVIDENCE_COLLECTION");
        workflowStates[workflowId] = state;

        const evidenceWithRefs = businessEvidence.map((item) => ({
          ...item,
          humanReviewRequired: item.humanReviewRequired || conflictFields.has(item.field) || assessment.humanReviewRequired,
        }));
        business = {
          ...business,
          evidenceReferences: evidenceWithRefs.map((item) => item.evidenceId),
          updatedAt: this.now().toISOString(),
        };

        await this.repositories.businesses.upsert(business);
        for (const item of evidenceWithRefs) await this.repositories.evidence.upsert(item);
        businesses.push(business);
        evidence.push(...evidenceWithRefs);

        let score: OpportunityScore | undefined;
        if (
          this.options.scoreBuilder &&
          assessment.status === "NO_MATCH" &&
          conflictFields.size === 0 &&
          scoreIsAllowed(
            evidenceWithRefs,
            this.options.minimumEvidenceRecords ?? 3,
            this.options.minimumEvidenceCoverage ?? 100,
          )
        ) {
          const scoreInput = this.options.scoreBuilder.build(business, evidenceWithRefs);
          const candidateScore = calculateOpportunityScore({
            businessId: business.id,
            evidenceCoverage: Math.min(100, (new Set(evidenceWithRefs.map((item) => item.field)).size / 3) * 100),
            competitorCoverage: scoreInput.competitorCoverage,
            components: scoreInput.components as Array<Omit<OpportunityScoreComponent, "weightedContribution">>,
            idFactory: this.recordFactory.idFactory,
            generatedAt: this.now().toISOString(),
          });
          const scoreErrors = validateOpportunityScore(candidateScore);
          if (scoreErrors.length === 0 && candidateScore.overallScore !== null) {
            score = candidateScore;
            await this.repositories.opportunityScores.upsert(score);
            scores.push(score);
          } else if (scoreErrors.length > 0) {
            validationErrors.push(...scoreErrors.map((error) => `${business.id}: ${error}`));
          }
        }

        if (score) {
          state = transitionState(state, "SCORED");
        } else {
          state = transitionState(state, "BLOCKED");
        }
        workflowStates[workflowId] = state;
      }

      run = updateScoutRun(
        run,
        {
          status: validationErrors.length > 0 ? "PARTIAL" : "COMPLETED",
          businessIds: businesses.map((item) => item.id),
          evidenceIds: evidence.map((item) => item.evidenceId),
          opportunityScoreIds: scores.map((item) => item.id),
          workflowIds: Object.keys(workflowStates),
          workflowStates,
          completedAt: this.now().toISOString(),
        },
        this.now,
      );
      await this.repositories.scoutRuns.update(run.runId, run);
      return { run, businesses, evidence, scores, duplicateAssessments, workflowStates, validationErrors };
    } catch (error) {
      run = updateScoutRun(
        run,
        { status: "FAILED", error: error instanceof Error ? error.message : "Scout run failed", completedAt: this.now().toISOString() },
        this.now,
      );
      await this.repositories.scoutRuns.update(run.runId, run);
      throw error;
    }
  }
}