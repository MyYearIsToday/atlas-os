/** Persisted per-business dossier: staged internal research -> audit -> SWOT -> growth -> action plan. Work product only; never evidence. */
export type StageId = "research" | "profile" | "audit" | "competitor_discovery" | "competitors" | "market" | "swot" | "growth" | "campaign" | "plan";
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
  output: unknown | null;
  recovery?: StageRecovery;
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
  origin?: "search" | "record" | "operator";
  /** "competitor" sources describe another business and are shown/approved separately from the business's own sources. */
  role?: "business" | "competitor";
  check?: { status: "fetched" | "failed" | "not_checked"; at?: string; reason?: string };
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
export interface FollowUpRef { key: string; taskId: string; title: string; assignedAI: string; external: boolean }

export interface Dossier {
  businessId: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed" | "blocked" | "awaiting_sources";
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
}
