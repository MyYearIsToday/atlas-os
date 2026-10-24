/**
 * SMCS campaign-reference library (phase 1).
 *
 * A private, curated catalogue of marketing campaigns Atlas may later learn from.
 * This module stores only what an operator supplies. It never researches campaigns
 * and never fills in missing facts. A performance figure is stored only when the
 * operator supplies the number, the source that stated it, and an explicit
 * verification status. Missing figures stay absent. Nothing is guessed.
 *
 * Storage is the existing `atlas_documents` table (collection `smcs_campaign_reference`),
 * the same PostgreSQL handle as workspace records. No migration and no second database.
 * Search is in-process over those documents (metadata + text), which is enough for a
 * library of hundreds and adds no index or extension.
 *
 * Fail-closed, matching workspace:
 *  - no PostgreSQL -> 503 postgres_not_configured
 *  - no ATLAS_PROXY_SHARED_SECRET -> 503 secret_required
 * Only GET and POST, so the proxy CORS allow-list stays "GET, POST, OPTIONS".
 */
import { randomBytes } from "node:crypto";
import type { AtlasPersistence } from "../../src/services/persistence/atlas-persistence";

export const SMCS_COLLECTION = "smcs_campaign_reference" as const;
export const REVIEW_STATUSES = ["candidate", "approved", "rejected"] as const;
export const LICENSE_STATUSES = ["unknown", "attributed", "licensed", "restricted", "internal"] as const;
export const PERFORMANCE_METRICS = ["reach", "impressions", "engagement", "conversions", "roi"] as const;
export const METRIC_VERIFICATION = ["source_stated", "independently_checked", "unverified"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];
export type MetricVerification = (typeof METRIC_VERIFICATION)[number];

/** One source-attributed result. Every field the caller omits stays omitted; verification is never assumed. */
export interface AttributedResult {
  value: number;
  source: string;
  verification: MetricVerification;
  unit?: string;
  sourceUrl?: string;
  asOf?: string;
  note?: string;
}
export interface CampaignPerformance {
  reach?: AttributedResult;
  impressions?: AttributedResult;
  engagement?: AttributedResult;
  conversions?: AttributedResult;
  roi?: AttributedResult;
  note?: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DOC_CHARS = 100_000;
const MAX_IMPORT = 25;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const TEXT_FIELDS = [
  "title", "brand", "sourceName", "sourceUrl", "provenance",
  "industry", "country", "market", "platform", "objective", "audience", "funnelStage", "product", "positioning",
  "hook", "concept", "audienceInsight", "emotionalAppeal", "narrative", "messageHierarchy", "proof", "cta",
  "format", "visualDirection", "designPrinciples",
  "observedPatterns", "transferablePrinciples", "evidence", "interpretations", "hypotheses", "limitations",
  "attribution", "retentionNotes", "qualityNotes", "reviewNote", "reviewedBy", "duplicateOf",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const LIMITS: Record<TextField, number> = {
  title: 200, brand: 160, sourceName: 200, sourceUrl: 500, provenance: 500,
  industry: 80, country: 80, market: 80, platform: 40, objective: 120, audience: 300, funnelStage: 40, product: 200, positioning: 500,
  hook: 500, concept: 1000, audienceInsight: 1000, emotionalAppeal: 300, narrative: 2000, messageHierarchy: 1000, proof: 1000, cta: 300,
  format: 80, visualDirection: 1000, designPrinciples: 1000,
  observedPatterns: 2000, transferablePrinciples: 2000, evidence: 2000, interpretations: 2000, hypotheses: 2000, limitations: 2000,
  attribution: 500, retentionNotes: 1000, qualityNotes: 1000, reviewNote: 500, reviewedBy: 80, duplicateOf: 64,
};

/** Bare numbers are not results. A sourced figure belongs under `performance`, with verification. */
const FORBIDDEN_FIELDS = ["metrics", "results", "roi", "impressions", "reach", "engagement", "conversions", "engagementRate", "spend", "revenue", "likes", "views", "ctr"] as const;

export interface FieldError { field: string; message: string }

export interface CampaignReference {
  id: string;
  version: number;
  title: string;
  brand?: string;
  sourceName?: string;
  sourceUrl?: string;
  provenance?: string;
  industry?: string;
  country?: string;
  market?: string;
  platform?: string;
  objective?: string;
  audience?: string;
  funnelStage?: string;
  product?: string;
  positioning?: string;
  hook?: string;
  concept?: string;
  audienceInsight?: string;
  emotionalAppeal?: string;
  narrative?: string;
  messageHierarchy?: string;
  proof?: string;
  cta?: string;
  format?: string;
  visualDirection?: string;
  designPrinciples?: string;
  observedPatterns?: string;
  transferablePrinciples?: string;
  evidence?: string;
  interpretations?: string;
  hypotheses?: string;
  limitations?: string;
  attribution?: string;
  licenseStatus: LicenseStatus;
  retentionNotes?: string;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  tags: string[];
  qualityNotes?: string;
  duplicateOf?: string;
  duplicateIndicators: string[];
  /** Present only when the operator supplied at least one sourced result. Never a placeholder. */
  performance?: CampaignPerformance;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  brand?: string;
  reviewStatus: ReviewStatus;
  score: number;
  level: "possible" | "likely";
  reasons: string[];
}

export class SmcsInputError extends Error {
  constructor(message: string, readonly fields: FieldError[] = []) { super(message); }
}
export class SmcsStorageError extends Error {}
export class SmcsConflictError extends Error {
  constructor(message: string, readonly duplicates: DuplicateMatch[]) { super(message); }
}

const clip = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const norm = (value?: string) => (value ?? "").toLowerCase().replace(/https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value?: string) => new Set(norm(value).split(" ").filter((t) => t.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

export function websiteKey(raw?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "").toLowerCase();
  } catch { return null; }
}

function readText(input: Record<string, unknown>, field: TextField, errors: FieldError[], required = false): string | undefined {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === "") {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof raw !== "string") { errors.push({ field, message: `${field} must be text` }); return undefined; }
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) { if (required) errors.push({ field, message: `${field} is required` }); return undefined; }
  if (value.length > LIMITS[field]) { errors.push({ field, message: `${field} must be at most ${LIMITS[field]} characters` }); return undefined; }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) { errors.push({ field, message: `${field} contains invalid characters` }); return undefined; }
  return value;
}

function readTags(input: Record<string, unknown>, errors: FieldError[]): string[] {
  if (input.tags === undefined || input.tags === null) return [];
  if (!Array.isArray(input.tags)) { errors.push({ field: "tags", message: "tags must be a list of short labels" }); return []; }
  if (input.tags.length > 20) errors.push({ field: "tags", message: "at most 20 tags" });
  const out: string[] = [];
  for (const tag of input.tags) {
    if (typeof tag !== "string") { errors.push({ field: "tags", message: "each tag must be text" }); continue; }
    const value = tag.replace(/\s+/g, " ").trim().toLowerCase();
    if (!value || value.length > 40 || /[^a-z0-9 _-]/.test(value)) { errors.push({ field: "tags", message: "tags are 1-40 letters, numbers, spaces, _ or -" }); continue; }
    if (!out.includes(value)) out.push(value);
  }
  return out.slice(0, 20);
}

function rejectForbidden(input: Record<string, unknown>, errors: FieldError[]) {
  for (const field of FORBIDDEN_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") continue;
    const structured = (PERFORMANCE_METRICS as readonly string[]).includes(field);
    errors.push({
      field,
      message: structured
        ? `Performance figures cannot be a bare ${field}. Put it under performance.${field} with value, source and verification, or leave it out.`
        : "Performance figures without a named source are not stored. Leave them out rather than guessing.",
    });
  }
}

function readShort(raw: unknown, field: string, max: number, errors: FieldError[], required = false): string | undefined {
  if (raw === undefined || raw === null || raw === "") {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof raw !== "string") { errors.push({ field, message: `${field} must be text` }); return undefined; }
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) { if (required) errors.push({ field, message: `${field} is required` }); return undefined; }
  if (value.length > max) errors.push({ field, message: `${field} must be at most ${max} characters` });
  return value || undefined;
}

/** A metric is stored only with an explicit number, source and verification. No field is defaulted. */
function readMetric(name: PerformanceMetric, raw: unknown, errors: FieldError[]): AttributedResult | undefined {
  if (raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ field: `performance.${name}`, message: `${name} must be an object with value, source and verification` });
    return undefined;
  }
  const src = raw as Record<string, unknown>;
  const metric: AttributedResult = { value: Number.NaN, source: "", verification: "unverified" };
  let ok = true;
  if (typeof src.value !== "number" || !Number.isFinite(src.value)) {
    errors.push({ field: `performance.${name}.value`, message: "value must be a finite number supplied by the source, not text or a guess" });
    ok = false;
  } else metric.value = src.value;
  const source = readShort(src.source, `performance.${name}.source`, 300, errors, true);
  if (source) metric.source = source; else ok = false;
  if (!(METRIC_VERIFICATION as readonly string[]).includes(String(src.verification ?? ""))) {
    errors.push({ field: `performance.${name}.verification`, message: "verification must be source_stated, independently_checked or unverified" });
    ok = false;
  } else metric.verification = src.verification as MetricVerification;
  const unit = readShort(src.unit, `performance.${name}.unit`, 40, errors);
  if (unit) metric.unit = unit;
  if ("sourceUrl" in src && src.sourceUrl != null && src.sourceUrl !== "") {
    const sourceUrl = readShort(src.sourceUrl, `performance.${name}.sourceUrl`, 500, errors);
    if (sourceUrl && !websiteKey(sourceUrl)) errors.push({ field: `performance.${name}.sourceUrl`, message: "sourceUrl must be an http(s) URL" });
    else if (sourceUrl) metric.sourceUrl = sourceUrl;
  }
  if ("asOf" in src && src.asOf != null && src.asOf !== "") {
    const asOf = readShort(src.asOf, `performance.${name}.asOf`, 10, errors);
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) errors.push({ field: `performance.${name}.asOf`, message: "asOf must be YYYY-MM-DD" });
    else if (asOf) metric.asOf = asOf;
  }
  const note = readShort(src.note, `performance.${name}.note`, 500, errors);
  if (note) metric.note = note;
  return ok ? metric : undefined;
}

function readPerformance(input: Record<string, unknown>, errors: FieldError[]): CampaignPerformance | null | undefined {
  if (!("performance" in input)) return undefined;
  if (input.performance === null) return null;
  if (!input.performance || typeof input.performance !== "object" || Array.isArray(input.performance)) {
    errors.push({ field: "performance", message: "performance must be an object of sourced metrics, or omitted" });
    return undefined;
  }
  const src = input.performance as Record<string, unknown>;
  const known = new Set<string>([...PERFORMANCE_METRICS, "note"]);
  for (const key of Object.keys(src)) if (!known.has(key)) errors.push({ field: `performance.${key}`, message: "unknown performance field" });
  const performance: CampaignPerformance = {};
  for (const name of PERFORMANCE_METRICS) {
    if (!(name in src) || src[name] == null) continue;
    const metric = readMetric(name, src[name], errors);
    if (metric) performance[name] = metric;
  }
  const note = readShort(src.note, "performance.note", 500, errors);
  if (note) performance.note = note;
  if (!PERFORMANCE_METRICS.some((name) => performance[name]) && !performance.note) return null;
  return performance;
}

export interface ParsedReference {
  fields: Partial<CampaignReference>;
  tags: string[];
  reviewStatus?: ReviewStatus;
  licenseStatus?: LicenseStatus;
  duplicateIndicators?: string[];
  /** undefined: not in the payload. null: clear stored results. */
  performance?: CampaignPerformance | null;
}

/** Validates operator input. Missing optional facts stay absent. Nothing is inferred. */
export function parseReference(input: unknown, opts: { requireTitle?: boolean } = {}): ParsedReference {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SmcsInputError("record must be a JSON object");
  const src = input as Record<string, unknown>;
  const errors: FieldError[] = [];
  rejectForbidden(src, errors);
  const fields: Partial<CampaignReference> = {};
  for (const field of TEXT_FIELDS) {
    if (field === "title") continue;
    if (!(field in src)) continue;
    const value = readText(src, field, errors);
    if (value !== undefined) (fields as Record<string, string>)[field] = value;
    else if (src[field] === null) (fields as Record<string, undefined>)[field] = undefined;
  }
  if ("title" in src || opts.requireTitle) {
    const title = readText(src, "title", errors, true);
    if (title) fields.title = title;
  }
  if ("sourceUrl" in src && fields.sourceUrl && !websiteKey(fields.sourceUrl)) errors.push({ field: "sourceUrl", message: "sourceUrl must be an http(s) URL" });
  let reviewStatus: ReviewStatus | undefined;
  if ("reviewStatus" in src && src.reviewStatus != null && src.reviewStatus !== "") {
    if (!(REVIEW_STATUSES as readonly string[]).includes(String(src.reviewStatus))) errors.push({ field: "reviewStatus", message: "reviewStatus must be candidate, approved or rejected" });
    else reviewStatus = src.reviewStatus as ReviewStatus;
  }
  let licenseStatus: LicenseStatus | undefined;
  if ("licenseStatus" in src && src.licenseStatus != null && src.licenseStatus !== "") {
    if (!(LICENSE_STATUSES as readonly string[]).includes(String(src.licenseStatus))) errors.push({ field: "licenseStatus", message: "licenseStatus must be unknown, attributed, licensed, restricted or internal" });
    else licenseStatus = src.licenseStatus as LicenseStatus;
  }
  const tags = "tags" in src ? readTags(src, errors) : [];
  const performance = readPerformance(src, errors);
  let duplicateIndicators: string[] | undefined;
  if ("duplicateIndicators" in src) {
    if (!Array.isArray(src.duplicateIndicators) || src.duplicateIndicators.some((v) => typeof v !== "string")) errors.push({ field: "duplicateIndicators", message: "duplicateIndicators must be a list of reasons" });
    else duplicateIndicators = src.duplicateIndicators.map((v) => clip(v, 80)).filter(Boolean).slice(0, 8);
  }
  if (errors.length) throw new SmcsInputError("Campaign reference is not valid", errors);
  return { fields, tags: "tags" in src ? tags : [], reviewStatus, licenseStatus, duplicateIndicators, performance };
}

export function assessDuplicates(candidate: Pick<CampaignReference, "title" | "brand" | "sourceUrl">, existing: CampaignReference[], ignoreId?: string): DuplicateMatch[] {
  const title = norm(candidate.title);
  const brand = norm(candidate.brand);
  const url = websiteKey(candidate.sourceUrl);
  const titleTokens = tokens(candidate.title);
  const matches: DuplicateMatch[] = [];
  for (const row of existing) {
    if (row.id === ignoreId) continue;
    const reasons: string[] = [];
    let score = 0;
    const rowUrl = websiteKey(row.sourceUrl);
    const overlap = jaccard(titleTokens, tokens(row.title));
    if (url && rowUrl && url === rowUrl) { score += 70; reasons.push("source_url_match"); }
    const sameTitle = !!title && title === norm(row.title) && (!brand || !norm(row.brand) || brand === norm(row.brand));
    if (sameTitle) { score += 60; reasons.push("title_match"); }
    else if (overlap >= 0.8 && (!brand || !norm(row.brand) || brand === norm(row.brand))) { score += 40; reasons.push("title_near_match"); }
    else if (overlap >= 0.6) { score += 30; reasons.push("title_similar"); }
    if (brand && brand === norm(row.brand) && overlap >= 0.4) { score += 15; reasons.push("brand_match"); }
    if (!reasons.length) continue;
    const level = score >= 60 ? "likely" : score >= 35 ? "possible" : null;
    if (!level) continue;
    matches.push({ id: row.id, title: row.title, brand: row.brand, reviewStatus: row.reviewStatus, score, level, reasons });
  }
  return matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 8);
}

function newId(): string {
  return `cr_${randomBytes(6).toString("hex")}`;
}

export class SmcsLibrary {
  constructor(private readonly persistence: AtlasPersistence, private readonly now: () => string = () => new Date().toISOString()) {}

  private async durably(write: () => void): Promise<void> {
    const before = this.persistence.health().failedWrites;
    write();
    await this.persistence.flush();
    const after = this.persistence.health();
    if (after.failedWrites > before) throw new SmcsStorageError(`PostgreSQL write failed${after.lastError ? `: ${after.lastError}` : ""}`);
  }

  async all(): Promise<CampaignReference[]> {
    const rows = await this.persistence.loadAll(SMCS_COLLECTION);
    return rows
      .map((row) => row.doc as CampaignReference)
      .filter((doc) => doc && typeof doc === "object" && typeof doc.id === "string" && typeof doc.title === "string");
  }

  async get(id: string): Promise<CampaignReference | undefined> {
    if (!ID_PATTERN.test(id)) return undefined;
    return (await this.all()).find((row) => row.id === id);
  }

  private async save(doc: CampaignReference): Promise<CampaignReference> {
    if (JSON.stringify(doc).length > MAX_DOC_CHARS) throw new SmcsInputError("record is too large");
    await this.durably(() => this.persistence.put(SMCS_COLLECTION, doc.id, doc));
    return doc;
  }

  async create(input: unknown, acknowledgeDuplicate = false): Promise<{ item: CampaignReference; duplicates: DuplicateMatch[] }> {
    const parsed = parseReference(input, { requireTitle: true });
    if (!parsed.fields.title) throw new SmcsInputError("Campaign reference is not valid", [{ field: "title", message: "title is required" }]);
    if (parsed.reviewStatus && parsed.reviewStatus !== "candidate") throw new SmcsInputError("New references start as candidate. Approve or reject them with the review endpoint.");
    const existing = await this.all();
    const duplicates = assessDuplicates({ title: parsed.fields.title, brand: parsed.fields.brand, sourceUrl: parsed.fields.sourceUrl }, existing);
    if (duplicates.some((d) => d.level === "likely") && !acknowledgeDuplicate) throw new SmcsConflictError("This looks like a campaign already in the library. Resend with acknowledgeDuplicate to keep both.", duplicates);
    const stamp = this.now();
    const top = duplicates[0];
    const item: CampaignReference = {
      ...(parsed.fields as CampaignReference),
      id: newId(),
      version: 1,
      title: parsed.fields.title,
      licenseStatus: parsed.licenseStatus ?? "unknown",
      reviewStatus: "candidate",
      tags: parsed.tags,
      ...(parsed.performance ? { performance: parsed.performance } : {}),
      duplicateOf: top?.level === "likely" ? top.id : parsed.fields.duplicateOf,
      duplicateIndicators: top ? top.reasons : [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    return { item: await this.save(item), duplicates };
  }

  async update(id: unknown, patch: unknown, expectedVersion?: number, acknowledgeDuplicate = false): Promise<{ item: CampaignReference; duplicates: DuplicateMatch[] }> {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new SmcsInputError("id must be 1-64 characters of letters, digits, _ or -");
    const current = await this.get(id);
    if (!current) throw new SmcsInputError("unknown campaign reference");
    if (expectedVersion !== undefined && expectedVersion !== current.version) throw new SmcsConflictError(`version ${current.version} is current; reload before saving`, []);
    const patchObj = (patch ?? {}) as Record<string, unknown>;
    const parsed = parseReference(patch);
    if ("reviewStatus" in patchObj) throw new SmcsInputError("reviewStatus changes go through the review endpoint");
    const next: CampaignReference = { ...current, tags: "tags" in patchObj ? parsed.tags : current.tags };
    for (const field of TEXT_FIELDS) {
      if (!(field in patchObj)) continue;
      const value = parsed.fields[field];
      if (value) (next as unknown as Record<string, string>)[field] = value;
      else delete (next as unknown as Record<string, unknown>)[field];
    }
    if (!next.title) throw new SmcsInputError("Campaign reference is not valid", [{ field: "title", message: "title is required" }]);
    if (parsed.licenseStatus) next.licenseStatus = parsed.licenseStatus;
    if ("performance" in patchObj) {
      if (parsed.performance) next.performance = parsed.performance;
      else delete next.performance;
    }
    const duplicates = assessDuplicates(next, await this.all(), id);
    if (duplicates.some((d) => d.level === "likely") && !acknowledgeDuplicate) throw new SmcsConflictError("This looks like a campaign already in the library. Resend with acknowledgeDuplicate to keep both.", duplicates);
    const top = duplicates.find((d) => d.level === "likely");
    const item: CampaignReference = {
      ...next,
      id: current.id,
      version: current.version + 1,
      createdAt: current.createdAt,
      reviewStatus: current.reviewStatus,
      reviewedBy: current.reviewedBy,
      reviewedAt: current.reviewedAt,
      duplicateOf: top ? top.id : next.duplicateOf,
      duplicateIndicators: top ? top.reasons : (parsed.duplicateIndicators ?? current.duplicateIndicators),
      updatedAt: this.now(),
    };
    return { item: await this.save(item), duplicates };
  }

  async review(id: unknown, decision: unknown, reviewedBy?: unknown, note?: unknown): Promise<CampaignReference> {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new SmcsInputError("id must be 1-64 characters of letters, digits, _ or -");
    if (typeof decision !== "string" || !(REVIEW_STATUSES as readonly string[]).includes(decision)) throw new SmcsInputError("decision must be candidate, approved or rejected");
    const current = await this.get(id);
    if (!current) throw new SmcsInputError("unknown campaign reference");
    const who = reviewedBy == null || reviewedBy === "" ? undefined : clip(reviewedBy, 80);
    if (reviewedBy != null && reviewedBy !== "" && !who) throw new SmcsInputError("reviewedBy must be text");
    const reviewNote = note == null || note === "" ? undefined : clip(note, 500);
    const item: CampaignReference = { ...current, reviewStatus: decision as ReviewStatus, reviewedBy: who ?? current.reviewedBy, reviewedAt: this.now(), reviewNote: reviewNote ?? current.reviewNote, version: current.version + 1, updatedAt: this.now() };
    return this.save(item);
  }

  async remove(id: unknown): Promise<void> {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new SmcsInputError("id must be 1-64 characters of letters, digits, _ or -");
    if (!(await this.get(id))) throw new SmcsInputError("unknown campaign reference");
    await this.durably(() => this.persistence.remove(SMCS_COLLECTION, id));
  }

  async query(params: URLSearchParams): Promise<{ items: CampaignReference[]; page: number; pageSize: number; total: number; eligibleOnly: boolean }> {
    const eligibleOnly = params.get("eligible") === "1" || params.get("eligible") === "true" || params.get("forRetrieval") === "1";
    const q = norm(params.get("q") ?? "");
    const filters: Array<[keyof CampaignReference, string]> = (["industry", "country", "market", "platform", "objective", "funnelStage", "brand", "reviewStatus"] as const)
      .flatMap((key) => { const value = params.get(key); return value ? [[key, norm(value)] as [keyof CampaignReference, string]] : []; });
    const tag = params.get("tag")?.trim().toLowerCase() ?? "";
    let rows = await this.all();
    if (eligibleOnly) rows = rows.filter((row) => row.reviewStatus === "approved");
    if (filters.length) rows = rows.filter((row) => filters.every(([key, value]) => norm(String(row[key] ?? "")) === value));
    if (tag) rows = rows.filter((row) => row.tags.includes(tag));
    if (q) rows = rows.filter((row) => searchable(row).includes(q));
    const sort = params.get("sort") === "title" || params.get("sort") === "createdAt" || params.get("sort") === "brand" ? params.get("sort")! : "updatedAt";
    const dir = params.get("order") === "asc" ? 1 : -1;
    rows.sort((a, b) => dir * String(a[sort as "title"] ?? "").localeCompare(String(b[sort as "title"] ?? "")) || a.id.localeCompare(b.id));
    const pageSize = clampInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const page = clampInt(params.get("page"), 1, 1, 10_000);
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize);
    return { items, page, pageSize, total, eligibleOnly };
  }
}

function searchable(row: CampaignReference): string {
  return norm([row.title, row.brand, row.hook, row.concept, row.industry, row.platform, row.objective, row.sourceName, row.provenance, row.tags.join(" ")].filter(Boolean).join(" "));
}
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new SmcsInputError(`${raw} is not a valid page`);
  return n;
}

export interface SmcsContext { persistence: AtlasPersistence | null; secretConfigured: boolean }
export interface SmcsResult { status: number; body: unknown }
const err = (status: number, code: string, message: string, extra?: Record<string, unknown>): SmcsResult => ({ status, body: { error: { code, message, ...extra } } });

/**
 * Routes (behind the proxy shared-secret check, and fail-closed without PostgreSQL):
 *   GET  /api/smcs/status
 *   GET  /api/smcs/references?q&status fields&tag&sort&order&page&pageSize&eligible=1
 *   GET  /api/smcs/references/:id
 *   POST /api/smcs/references                 { record, acknowledgeDuplicate? } -> { item, duplicates }
 *   POST /api/smcs/references/import          { records, acknowledgeDuplicate? }
 *   POST /api/smcs/references/update          { id, record, expectedVersion?, acknowledgeDuplicate? }
 *   POST /api/smcs/references/delete          { id }
 *   POST /api/smcs/references/review          { id, decision, reviewedBy?, note? }
 *   POST /api/smcs/references/duplicates      { record }
 *   POST /api/smcs/references/validate        { record }
 * eligible=1 returns only reviewStatus "approved" (the set creative retrieval may use).
 */
export async function handleSmcsRequest(method: string, pathname: string, params: URLSearchParams, readBody: () => Promise<unknown>, ctx: SmcsContext): Promise<SmcsResult> {
  const rest = pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(2);
  const blocked = (): SmcsResult | null => {
    if (!ctx.persistence) return err(503, "postgres_not_configured", "PostgreSQL persistence is not active on the Atlas server (needs ATLAS_PIPELINE_ENABLED=true and DATABASE_URL)");
    if (!ctx.secretConfigured) return err(503, "secret_required", "The campaign library is disabled until ATLAS_PROXY_SHARED_SECRET is set");
    return null;
  };
  if (rest.length === 1 && rest[0] === "status") {
    if (method !== "GET") return err(405, "method_not_allowed", "status is GET only");
    const why = blocked();
    return { status: 200, body: { durable: !why, store: "postgres", collection: SMCS_COLLECTION, reviewStatuses: REVIEW_STATUSES, retrieval: "approved", ...(ctx.persistence ? { persistence: ctx.persistence.health() } : {}), ...(why ? { reason: (why.body as { error: { message: string } }).error.message } : {}) } };
  }
  if (rest[0] !== "references") return err(404, "not_found", "unknown SMCS endpoint");
  const unavailable = blocked();
  if (unavailable) return unavailable;
  const library = new SmcsLibrary(ctx.persistence!);
  try {
    if (rest.length === 1 && method === "GET") return { status: 200, body: await library.query(params) };
    if (rest.length === 2 && method === "GET" && ID_PATTERN.test(rest[1])) {
      const item = await library.get(rest[1]);
      return item ? { status: 200, body: { item } } : err(404, "not_found", "unknown campaign reference");
    }
    if (method !== "POST") return err(405, "method_not_allowed", "use GET to read and POST to change the library");
    const body = (await readBody()) as Record<string, unknown> | null;
    const acknowledge = body?.acknowledgeDuplicate === true;
    if (rest.length === 1) {
      const created = await library.create(body?.record ?? body, acknowledge);
      return { status: 201, body: created };
    }
    const action = rest[1];
    if (action === "validate") {
      parseReference(body?.record ?? body, { requireTitle: true });
      return { status: 200, body: { valid: true } };
    }
    if (action === "duplicates") {
      const parsed = parseReference(body?.record ?? body, { requireTitle: true });
      return { status: 200, body: { duplicates: assessDuplicates({ title: parsed.fields.title!, brand: parsed.fields.brand, sourceUrl: parsed.fields.sourceUrl }, await library.all(), typeof body?.ignoreId === "string" ? body.ignoreId : undefined) } };
    }
    if (action === "import") {
      const records = body?.records;
      if (!Array.isArray(records) || records.length === 0 || records.length > MAX_IMPORT) throw new SmcsInputError(`records must be 1 to ${MAX_IMPORT} campaign references`);
      const created: CampaignReference[] = [];
      const errors: Array<{ index: number; message: string; fields?: FieldError[]; duplicates?: DuplicateMatch[] }> = [];
      for (let index = 0; index < records.length; index++) {
        try { created.push((await library.create(records[index], acknowledge)).item); }
        catch (error) {
          if (error instanceof SmcsInputError) errors.push({ index, message: error.message, fields: error.fields });
          else if (error instanceof SmcsConflictError) errors.push({ index, message: error.message, duplicates: error.duplicates });
          else throw error;
        }
      }
      return { status: errors.length ? 207 : 201, body: { created, errors } };
    }
    if (action === "update") return { status: 200, body: await library.update(body?.id, body?.record, typeof body?.expectedVersion === "number" ? body.expectedVersion : undefined, acknowledge) };
    if (action === "delete") { await library.remove(body?.id); return { status: 200, body: { deleted: true } }; }
    if (action === "review") return { status: 200, body: { item: await library.review(body?.id, body?.decision, body?.reviewedBy, body?.note) } };
    return err(404, "not_found", "unknown SMCS endpoint");
  } catch (error) {
    if (error instanceof SmcsInputError) {
      if (error.message === "unknown campaign reference") return err(404, "not_found", error.message);
      return err(400, "invalid_input", error.message, error.fields.length ? { fields: error.fields } : undefined);
    }
    if (error instanceof SmcsConflictError) return err(error.duplicates.length ? 409 : 409, error.duplicates.length ? "likely_duplicate" : "stale_version", error.message, error.duplicates.length ? { duplicates: error.duplicates } : undefined);
    if (error instanceof SyntaxError) return err(400, "invalid_input", "Malformed JSON request body");
    if (error instanceof SmcsStorageError) return err(502, "postgres_write_failed", error.message);
    throw error;
  }
}
