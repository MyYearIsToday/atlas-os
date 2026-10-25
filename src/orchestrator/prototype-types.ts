import type { RoutingRecord } from "./atlas-pipeline";

/**
 * Website prototype work product. The files are generated model output: never evidence, never executed on the server, and shown to
 * the operator only inside an isolated preview. "preview_available" means the files were stored and passed static validation; it does
 * NOT mean the site is published anywhere.
 */
export type PrototypeStatus = "generating" | "preview_available" | "needs_revision" | "failed" | "approved";

export interface PrototypeFile { path: string; content: string; bytes: number }
export interface PrototypeIssue { severity: "error" | "warning"; file?: string; message: string }
export interface PrototypePlaceholder { key: string; file: string; label: string }
export interface PrototypeAsset { id: string; dataUrl: string; sourceId: string; imageId: string; rights: string }

export interface PrototypeVersion {
  n: number; createdAt: string; kind: "initial" | "revision" | "placeholder_fill";
  instruction?: string;
  /** Null once an older version's files were pruned to bound storage (metadata is kept). */
  files: PrototypeFile[] | null;
  changed: string[]; generatedBy?: string; routing?: RoutingRecord;
  issues: PrototypeIssue[]; placeholders: PrototypePlaceholder[]; incompletePages: string[];
}

export interface PrototypeFactRef { label: string; value: string; status: "recorded" | "verified" | "unverified"; sourceRefs: string[] }

export interface Prototype {
  id: string; businessId: string; taskId: string;
  status: PrototypeStatus; statusDetail: string;
  instructions: string; createdAt: string; updatedAt: string;
  versions: PrototypeVersion[]; current: number;
  /** Operator-approved images the generator may reference as asset:<id>. Empty unless rights and identity are confirmed. */
  assets: PrototypeAsset[];
  /** The evidence the generator was given, so the output can be audited against it. */
  facts: PrototypeFactRef[];
  dossierUpdatedAt: string | null;
  error?: string; approvedBy?: string; approvedAt?: string;
}
