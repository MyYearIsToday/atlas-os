/** Persisted per-business dossier: staged internal research -> audit -> SWOT -> growth -> action plan. Work product only; never evidence. */
export type StageId = "research" | "profile" | "audit" | "competitor_discovery" | "competitors" | "market" | "swot" | "insights" | "growth" | "pr" | "campaign" | "plan";
export type StageStatus = "pending" | "running" | "completed" | "failed" | "blocked";

/** One attempt to get a usable structured output for an AI stage. Every attempt is kept, failed ones included. */
export interface RecoveryAttempt {
  n: number;
  kind: "initial" | "corrective_prompt" | "alternative_model";
  taskId: string;
  provider?: string;
  model?: string;
  outcome: "valid" | "repaired" | "invalid";
  /** Mechanical repairs applied to the model text before it parsed (e.g. removed_trailing_comma, closed_truncated_output). */
  repairs: string[];
  validationError?: string;
  at: string;
}
export interface StageRecovery {
  attempts: RecoveryAttempt[];
  /** "repaired" = usable only after mechanical repair; "failed" = no valid output after every bounded attempt. */
  final: "valid" | "repaired" | "failed" | null;
  /** Models that already answered unusably; the alternative-model attempt must not reuse them. */
  avoidModels?: string[];
  /** Index into attempts where the current bounded round began (operator retries start a new round; history is kept). */
  round?: number;
}

export interface StageRecord {
  status: StageStatus;
  taskId: string | null;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  generatedBy: string | null;
  /** Earlier outputs of this stage, kept when it was revised. The canonical copy also lives on the dossier revision log. */
  history?: Array<{ at: string; reason: string; output: unknown; revisionId?: string }>;
  /** Set when the stage was built on a section that was later revised and has not been re-run. */
  staleBecause?: string;
  output: unknown | null;
  recovery?: StageRecovery;
  /** Output generation. Bumped whenever this stage's committed output changes or is invalidated. Dependents record the generations they were built on. */
  generation?: number;
  /** Upstream generations captured when this stage's mission was written (the exact moment its context was fixed). Checked again before the output is committed. */
  inputs?: Partial<Record<StageId, number>>;
  /** Results that finished on out-of-date upstream output and were therefore not committed. The discarded output is kept on the revision log. */
  discards?: StageDiscard[];
  /** Consecutive discards since the last successful commit; a circuit breaker, not a completion criterion. */
  discardCount?: number;
}
export interface StageDiscard {
  at: string; reason: string;
  stale: Array<{ stage: StageId; captured: number; current: number }>;
  revisionId?: string;
}

export type SourceDecision = "pending" | "approved" | "rejected";
export interface SourceRef {
  id: string; url: string; title: string; snippet: string; query: string; retrievedAt: string;
  /** "checked" only when the page text was actually fetched; a search snippet alone is never checked. */
  confidence: "unverified" | "checked";
  kind?: "official_site" | "social" | "directory" | "article" | "event" | "review" | "other";
  relevance?: "match" | "possible" | "unrelated";
  reasons?: string[];
  decision?: SourceDecision;
  /** Who made the decision. "auto" = Atlas validated it for INTERNAL use; it never makes a claim verified by itself. */
  decidedBy?: "auto" | "operator";
  decisionReason?: string;
  official?: boolean;
  origin?: "search" | "record" | "operator" | "website" | "chat";
  /** "competitor" sources describe another business and are shown/approved separately from the business's own sources. */
  role?: "business" | "competitor";
  check?: { status: "fetched" | "failed" | "not_checked"; at?: string; reason?: string };
  /** How strongly this source is judged to belong to THIS business (domain, identity, branding, contact details, content, corroboration). Evidence for ranking and ambiguity only; never makes a claim verified. */
  rank?: { score: number; level: "strong" | "moderate" | "weak"; factors: string[] };
  /** Fetched page text (bounded). The only text a claim may be verified against. */
  pageText?: string;
}
export interface ImageObservation { observation: string; category: string; confidence: string }
export type ImageDecision = "pending" | "confirmed" | "rejected" | "needs_user_confirmation" | "skipped";
export interface ImageClue { kind: string; detail: string }
/** What the vision model reported about ONE image, kept apart from verified text evidence (these are AI observations, never facts). */
export interface ImageAssessment {
  at: string;
  status: "assessed" | "unavailable" | "failed";
  reason?: string;
  provider?: string; model?: string;
  association?: "match" | "mismatch" | "uncertain";
  /** What the image is in relation to the business: only "business_itself" can be auto-confirmed. */
  relationship?: "business_itself" | "reseller_or_stockist" | "partner_or_sponsor" | "unrelated_brand" | "stock_or_generic" | "unclear";
  /** How a confirmation was reached: the business name read from the image, a visual match to a confirmed reference image, or distinctive visual clues from the business's own site. */
  basis?: "name_text" | "visual_reference" | "visual_clues";
  /** Reference images (already confirmed brand assets) the candidate was compared with, and the model's comparison. */
  referenceIds?: string[];
  referenceComparison?: { compared: boolean; sameBrandMark: "yes" | "no" | "similar_but_different" | "cannot_tell"; matchingFeatures: Array<ImageClue & { distinctiveness: "high" | "medium" | "low" }>; differences: string[] };
  confidence?: "high" | "medium" | "low";
  reasoning?: string;
  imageType?: string;
  visibleText?: string[];
  supportingClues?: ImageClue[];
  conflictingClues?: ImageClue[];
  attempts: Array<{ outcome: "ok" | "invalid_output" | "provider_failed" | "unavailable"; error?: string; provider?: string; model?: string }>;
}
export interface ImageRef {
  id: string; url: string; pageUrl: string; sourceId: string; role: string;
  decision: ImageDecision;
  /** Who made the current decision and why. An operator decision is never overwritten by the AI. */
  decidedBy?: "ai" | "operator";
  decisionReason?: string;
  decidedAt?: string;
  /** Retrieval record: the bytes are not stored, only what identifies them. */
  retrievedAt?: string; sha256?: string; mimeType?: string; bytes?: number;
  retrieval?: { status: "ok" | "failed"; reason?: string; at: string; userCanResolve: boolean };
  duplicateOf?: string;
  assessment?: ImageAssessment;
  /** Observations are unverified AI readings of the image. They may inform hypotheses and never become verified facts. */
  analysis?: { status: "analyzed" | "unavailable" | "failed"; at: string; reason?: string; generatedBy?: string; observations: ImageObservation[] };
  /** Association with the business is NOT permission to reuse the image in published marketing. */
  rights: { status: "unknown" | "owner_permission" | "licensed" | "not_permitted"; note: string; updatedBy?: string; updatedAt?: string };
}
export const DEFAULT_IMAGE_RIGHTS = { status: "unknown" as const, note: "Belongs to the business or a third party. Reuse in published marketing needs the owner's permission or a licence; none is recorded." };

// ---- deep research evidence ledger (what was actually inspected, and what was not)
export type PageRole = "home" | "about" | "services" | "contact" | "team" | "portfolio" | "pricing" | "events" | "blog" | "other";
export interface InspectedPage {
  url: string; finalUrl?: string; role: PageRole; at: string;
  status: "read" | "failed";
  reason?: string; httpStatus?: number;
  title?: string; description?: string; headings: string[]; textChars: number; excerpt: string;
  emails: string[]; phones: string[]; socialLinks: string[];
  rendering: "static" | "js_required";
}
export interface WebsiteInspection {
  /** Set when Atlas found this site itself (the business record had no website). It is a candidate, never recorded as the official site. */
  discovered?: boolean;
  site: string; startedAt: string; finishedAt: string;
  pages: InspectedPage[];
  /** Set when the supplied address ended on a different domain. The content is still the operator-supplied site, but this is flagged. */
  redirectedToOtherDomain?: string;
  contacts: { emails: string[]; phones: string[] };
  socialLinks: string[];
  limits: string[];
}
export type SocialAccess = "full_page" | "meta_only" | "login_wall" | "unreachable" | "not_checked";
export interface SocialObservation {
  platform: string; url: string; handle?: string;
  access: SocialAccess; checkedAt: string; reason?: string;
  title?: string; bio?: string;
  followers?: string; following?: string; posts?: string; likes?: string;
  /** Plain statements taken directly from readable text. */
  observed: string[];
  /** Interpretation of the observed text only; never presented as fact. */
  inferred: string[];
  /** What Atlas could not see, so nobody mistakes a gap for a finding. */
  inaccessible: string[];
  themes: string[];
}
/** One investigation round of the adaptive research loop: what was missing, what was chosen, what happened. */
export interface ResearchLoopRound {
  round: number; planner: "ai" | "fallback"; reasoning?: string;
  gaps: Array<{ kind: string; detail: string }>;
  actions: Array<{ type: "search" | "fetch" | "inspect_site"; target: string; gap?: string; outcome: string; newSources: number; read: number }>;
}
export interface ResearchLoopTrace {
  startedAt: string; finishedAt: string;
  rounds: ResearchLoopRound[];
  /** sufficient | max_rounds | budget | deadline | no_new_actions | ambiguous | no_search_configured */
  stopReason: string;
  used: { searches: number; fetches: number; plannerCalls: number };
  limits: { maxRounds: number; maxSearches: number; maxFetches: number; maxPlannerCalls: number; deadlineMs: number };
  remainingGaps: Array<{ kind: string; detail: string }>;
}
/** Operator decision on one growth recommendation. Only approved strategies can produce deliverables. */
export interface StrategyDecision { key: string; title: string; decision: "approved" | "declined"; decidedBy: string; decidedAt: string; reason?: string }
/** An internal deliverable mission created from an approved strategy. Always Approval Required; nothing is published or sent. */
export interface Deliverable {
  id: string; kind: "campaign_brief" | "content_draft" | "creative_asset"; strategyKey: string; strategyTitle: string;
  campaign?: string; contentIndex?: number; taskId: string; title: string; sourceRefs: string[]; createdAt: string; createdBy: string;
}
/** Results typed in by the operator from a real platform. Atlas never generates, estimates or imports these on its own. */
export interface PerformanceRecord {
  id: string; campaign: string; deliverableId?: string; metric: string; value: number; unit?: string;
  period: { from: string; to: string }; origin: "operator_entered"; recordedBy: string; recordedAt: string; note?: string;
}
export interface DossierExecution { strategies: StrategyDecision[]; deliverables: Deliverable[]; performance: PerformanceRecord[] }

export interface FollowUpRef { key: string; taskId: string; title: string; assignedAI: string; external: boolean }

export interface Dossier {
  businessId: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed" | "blocked" | "awaiting_sources" | "awaiting_decision";
  stages: Record<StageId, StageRecord>;
  sources: SourceRef[];
  limitations: string[];
  followUps: FollowUpRef[];
  manualRetries: number;
  /** Sources are validated automatically after research. Stages wait only when mode is not set and status is awaiting (ambiguous identity). */
  sourceApproval?: { status: "awaiting" | "approved"; approvedAt?: string; approvedBy?: string; approvedCount?: number; mode?: "auto" | "operator"; reason?: "ambiguous_identity"; detail?: string };
  /** Second operator checkpoint: candidate competitors. Only approved competitor sources are analysed. */
  competitorApproval?: { status: "awaiting" | "approved"; approvedAt?: string; approvedBy?: string; approvedCount?: number; mode?: "auto" | "operator"; rejectedCount?: number };
  images?: ImageRef[];
  /** Strategy approvals, deliverables and operator-entered results linked to this dossier's recommendations and campaigns. */
  execution?: DossierExecution;
  /** Evidence ledger from deep inspection: website pages read, social profiles observed, conflicts found, research quality. */
  inspection?: { website?: WebsiteInspection; social: SocialObservation[]; conflicts: string[]; loop?: ResearchLoopTrace; /** Count-based heuristic (pages/profiles read, sources validated). It rates how much evidence was gathered, not how good it is. */ quality?: { level: "sufficient" | "thin" | "insufficient"; reasons: string[]; assessedAt: string } };
  /** Entity identity established by the profile stage and used by every later stage. */
  identity?: { entityType: string; distinctFrom: string[] };
  /** Planner decisions, newest last. */
  planLog?: PlanChange[];
  /** Stages sent back for revision. The earlier output is preserved; pending means the redo has not finished. */
  revisions?: Partial<Record<StageId, { reason: string; at: string; count: number; pending: boolean; previous: unknown }>>;
  /** Question-driven investigations Atlas actually ran. */
  investigations?: Investigation[];
  /** Operator or chat challenges recorded for the planner. */
  handoffs?: Handoff[];
  /** Earlier versions kept when the business was researched again or the plan was revised. Never the only copy of a discarded output. */
  history?: DossierVersion[];
  /** Per-stage outputs taken before a section was replaced, linked to the plan change that caused it. */
  revisionLog?: StageRevision[];
  /** Suggested next place in Scout → CRM → Clients → content. A suggestion only; nothing is created or sent. */
  pipelineLink?: PipelineLink;
  researchRound?: number;
  /** Structured feedback from workers. Never evidence by itself: it points at evidence and is judged by the planner. */
  feedback?: WorkerFeedback[];
  /** Why the planner (and the deterministic checks) consider the overall work complete, blocked or awaiting a decision. */
  completion?: CompletionAssessment;
}

export type FeedbackType = "finding" | "challenge" | "needs_evidence" | "alternative_direction" | "dependency_warning" | "completion_assessment";
/** observed = a fact quoted from an approved source; interpretation = reasoning from cited approved sources; hypothesis; unknown. */
export type FeedbackBasis = "observed" | "interpretation" | "hypothesis" | "unknown";
export type FeedbackStatus = "open" | "accepted" | "rejected" | "investigating" | "awaiting_reevaluation" | "actioned" | "deferred" | "superseded";
export interface WorkerFeedback {
  id: string;
  workerId: string;
  stageId: StageId | "unassigned";
  type: FeedbackType;
  title: string;
  observation: string;
  reasoning: string;
  businessImpact: string;
  affectedStages: StageId[];
  /** Resolved against the dossier's approved sources when the feedback was recorded. */
  evidenceRefs: string[];
  basis: FeedbackBasis;
  quote?: string;
  confidence: "high" | "medium" | "low";
  proposedAction: { kind: "none" | "investigate" | "revise_stage" | "add_task" | "consult_specialist" | "reopen_downstream"; detail: string };
  researchQuestions: string[];
  recommendedSpecialist?: "scout" | "builder" | "operator" | "closer";
  createdAt: string;
  status: FeedbackStatus;
  resolution?: string;
  /** completion_assessment only: the worker's own view of whether its assignment is complete. */
  complete?: boolean;
  unresolved?: string[];
  /** Links. */
  stageGeneration?: number;
  /** Set when the feedback came from an ordinary (non-stage) mission: the mission that produced it. */
  sourceTaskId?: string;
  sourceMissionType?: string;
  handoffId?: string;
  investigationIds?: string[];
  planChangeIds?: string[];
  missionTaskIds?: string[];
  evaluations?: number;
  notes?: string[];
}

export interface CompletionAssessment {
  at: string;
  /** complete_with_limitations: finished, with limits the planner or code judged non-material and disclosed. awaiting_investigation: research the planner ordered has not come back. */
  state: "in_progress" | "awaiting_investigation" | "complete" | "complete_with_limitations" | "blocked" | "awaiting_decision";
  /** Plain statements of why this state was chosen. */
  reasons: string[];
  unresolved: Array<{ kind: "stage" | "feedback" | "handoff" | "contradiction" | "limitation" | "stale" | "investigation" | "specialist" | "unsupported"; ref: string; detail: string; /** Material items block completion; disclosed ones are carried as stated limitations. */ material?: boolean }>;
  /** The planner's own explanation, when a planner model was available and there was something to judge. */
  plannerNote?: string;
  assessedBy: "code" | "planner";
  reviews?: number;
}

export interface Handoff {
  id: string;
  from: StageId | "chat" | "planner" | "investigation" | "unassigned";
  fromEmployee?: string;
  kind: "needs_evidence" | "challenge" | "alternative_direction" | "finding" | "dependency_warning" | "completion_assessment";
  /** Explicit links. The investigation or worker feedback that produced this handoff, and the plan change that evaluated it. */
  investigationId?: string;
  feedbackId?: string;
  planChangeId?: string;
  /** Planner evaluations of this handoff that produced no usable decision. Bounded. */
  attempts?: number;
  detail: string;
  sourceRefs: string[];
  at: string;
  status: "open" | "investigated" | "considered";
  resolvedBy?: StageId | "planner";
  resolution?: string;
}
export interface Investigation {
  id: string;
  question: string;
  origin: "handoff" | "chat" | "operator";
  at: string;
  retrieved: Array<{ id: string; url: string; read: boolean; decision: string }>;
  notes: string[];
  steps?: InvestigationStep[];
  stopReason?: "enough" | "budget" | "no_progress" | "planner_unavailable" | "nothing_to_do";
  concluded?: boolean;
  /** Approved sources this investigation actually read. A finding without one of these is not evidence. */
  approvedSourceIds?: string[];
  finding?: string;
  /** The handoff this investigation created and the plan change that evaluated it. */
  handoffId?: string;
  planChangeId?: string;
  /** Worker feedback that asked for this investigation. */
  feedbackId?: string;
}
export interface InvestigationStep { action: "search" | "read" | "stop"; target?: string; why: string; newSources: number }

/** One planner decision: what changed, what was kept, what was revised, what was added. */
export interface PlanChange {
  id: string;
  at: string;
  /** ids are HANDOFF ids for handoff/worker_feedback triggers. investigationIds names the investigations behind them. */
  trigger: { kind: "handoff" | "chat" | "operator" | "worker_feedback"; ids: string[]; summary: string; investigationIds?: string[]; feedbackIds?: string[] };
  decision: "continue" | "revise" | "add_tasks" | "revise_and_add";
  reason: string;
  kept: StageId[];
  revised: StageId[];
  stale: StageId[];
  tasks: PlannedTask[];
  /** False when no planner model was available. */
  plannerModel: boolean;
  /** False when the planner gave no usable decision: nothing was resolved and the trigger may be evaluated again (bounded). */
  evaluated?: boolean;
  /** Planner verdicts on worker feedback, in the planner's own words. */
  feedbackVerdicts?: Array<{ feedbackId: string; verdict: string; reason: string }>;
  /** Investigations this change started (their ids). */
  investigationIds?: string[];
}
export interface PlannedTask {
  feedbackIds?: string[];
  id: string; taskId?: string; title: string; assignedAI: string; why: string; at: string;
  status: "completed" | "failed" | "skipped";
  result?: string; error?: string;
}
export interface StageRevision {
  id: string;
  stage: StageId;
  at: string;
  reason: string;
  planChangeId?: string;
  versionId?: string;
  output: unknown;
  completedAt: string | null;
  generatedBy: string | null;
  sourceRefs: string[];
}
/** One archived picture of the analytical dossier. Older records may store a stage output directly; newer ones store an ArchivedStage. */
export interface ArchivedStage {
  status: string;
  output: unknown;
  completedAt: string | null;
  generatedBy: string | null;
  sourceRefs: string[];
  staleBecause?: string;
}
export interface DossierVersion {
  id?: string;
  round: number;
  archivedAt: string;
  reason: string;
  kind?: "reresearch" | "revision";
  planChangeId?: string;
  triggerSummary?: string;
  stages: Partial<Record<StageId, unknown>>;
  sourceDigest: Array<{ id: string; url: string; retrievedAt: string; decision?: string; relevance?: string }>;
  limitations?: string[];
  planDecisions?: Array<{ id: string; at: string; decision: string; reason: string; revised: StageId[] }>;
  investigations?: Array<{ id: string; question: string; at: string; finding?: string; stopReason?: string }>;
}
export interface PipelineLink {
  scoutBusinessId: string;
  crm: { status: "suggested"; stage: "Prospect"; businessName: string; category: string | null; location: string | null; website: string | null; note: string };
  client: { status: "not_created"; reason: string };
  contentStack: { status: "drafts_only" | "none"; items: Array<{ title: string; channel: string; approval: "Approval Required" }>; note: string };
}
