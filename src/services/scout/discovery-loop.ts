import type { BusinessDiscoveryProvider, DiscoveryCandidate, DiscoveryQuery } from "../evidence/provider-interfaces";
import { assessDuplicate } from "../evidence/business-deduplication";
import type { BusinessIntelligence } from "../evidence/business-intelligence";
import type { ScoutIntake } from "./intake";
import type { BusinessRepository } from "./business-repository";
import { mergeIntoExisting, nextCandidateId, normalizeCandidate } from "./discovery-normalize";

/** Bridge duplicate vocabulary to the payload validated by the existing handler. */
function toIntakeDuplicateStatus(status: "NO_MATCH" | "POSSIBLE_DUPLICATE" | "LIKELY_DUPLICATE"): ScoutIntake["duplicateStatus"] {
  if (status === "NO_MATCH") return "NONE";
  if (status === "LIKELY_DUPLICATE") return "HUMAN_REVIEW";
  return "POSSIBLE_DUPLICATE";
}

function bestMatch(candidateRecord: BusinessIntelligence, existing: BusinessIntelligence[]) {
  let best: { record: BusinessIntelligence; assessment: ReturnType<typeof assessDuplicate> } | null = null;
  for (const record of existing) {
    const assessment = assessDuplicate(candidateRecord, record);
    if (assessment.status === "NO_MATCH") continue;
    if (!best || assessment.score > best.assessment.score) best = { record, assessment };
  }
  return best;
}

export interface DispatchBusinessDiscovered {
  (type: "BusinessDiscovered", payload: ScoutIntake & { businessId: string }): Promise<void>;
}

export interface ScoutDiscoveryDeps {
  provider: BusinessDiscoveryProvider;
  repository: BusinessRepository;
  dispatch: DispatchBusinessDiscovered;
  query: DiscoveryQuery;
  now?: () => string;
}

export interface CandidateOutcome {
  externalId: string;
  name: string;
  businessId: string;
  action: "CREATED" | "UPDATED_EXISTING";
  duplicateStatus: ScoutIntake["duplicateStatus"];
  published: boolean;
}

export interface ScoutDiscoveryRunResult {
  ok: boolean;
  candidatesFound: number;
  outcomes: CandidateOutcome[];
  error?: string;
}

async function processCandidate(
  candidate: DiscoveryCandidate,
  deps: Required<Pick<ScoutDiscoveryDeps, "repository" | "dispatch" | "now">>,
): Promise<CandidateOutcome> {
  const nowIso = deps.now();
  const existingByKey = deps.repository.findByExternalKey(candidate.source, candidate.externalId);

  let businessId: string;
  let action: CandidateOutcome["action"];
  let duplicateStatus: ScoutIntake["duplicateStatus"];

  if (existingByKey) {
    const merged = mergeIntoExisting(existingByKey, candidate, nowIso);
    deps.repository.upsert(merged, { source: candidate.source, externalId: candidate.externalId });
    businessId = merged.id;
    action = "UPDATED_EXISTING";
    duplicateStatus = "NONE";
  } else {
    const draft = normalizeCandidate(candidate, nextCandidateId(deps.now), nowIso);
    const match = bestMatch(draft, deps.repository.list());

    if (match && match.assessment.status === "LIKELY_DUPLICATE") {
      const merged = mergeIntoExisting(match.record, candidate, nowIso);
      deps.repository.upsert(merged, { source: candidate.source, externalId: candidate.externalId });
      businessId = merged.id;
      action = "UPDATED_EXISTING";
      duplicateStatus = toIntakeDuplicateStatus(match.assessment.status);
    } else {
      deps.repository.upsert(draft, { source: candidate.source, externalId: candidate.externalId });
      businessId = draft.id;
      action = "CREATED";
      duplicateStatus = match ? toIntakeDuplicateStatus(match.assessment.status) : "NONE";
    }
  }

  const intake: ScoutIntake & { businessId: string } = {
    businessId,
    discoveredBusiness: deps.repository.get(businessId),
    duplicateStatus,
    evidenceRefs: [],
    sourceRefs: [candidate.source],
  };
  await deps.dispatch("BusinessDiscovered", intake);

  return { externalId: candidate.externalId, name: candidate.name, businessId, action, duplicateStatus, published: true };
}

/** Discovery -> normalize -> deduplicate -> upsert -> existing event bus handoff. */
export async function runScoutDiscovery(deps: ScoutDiscoveryDeps): Promise<ScoutDiscoveryRunResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  let candidates: DiscoveryCandidate[];
  try {
    candidates = await deps.provider.discover(deps.query);
  } catch (err) {
    return { ok: false, candidatesFound: 0, outcomes: [], error: err instanceof Error ? err.message : "discovery source failed" };
  }

  const outcomes: CandidateOutcome[] = [];
  for (const candidate of candidates) {
    outcomes.push(await processCandidate(candidate, { repository: deps.repository, dispatch: deps.dispatch, now }));
  }
  return { ok: true, candidatesFound: candidates.length, outcomes };
}