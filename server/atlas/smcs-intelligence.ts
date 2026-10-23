/**
 * SMCS creative intelligence (phase 2). Uses the phase-1 campaign library.
 * It drafts original directions for a brand the operator already named.
 * It does not research campaigns, publish, send, or claim to have learned a predictive model.
 *
 * Approved references only. Performance figures are never a retrieval signal.
 * Model output is recovered and checked; a bad response is discarded, not repaired into a fact.
 */
import { randomBytes } from "node:crypto";
import { recoverJsonObject } from "./json-recovery";
import { assessDuplicates, type CampaignReference } from "./smcs-library";
import type { AtlasPersistence } from "../../src/services/persistence/atlas-persistence";
import type { AIProvider } from "../../src/workforce/provider-interface";
import type { ProviderId } from "../../src/workforce/provider-types";
import { defaultWorkforceConfig } from "../../src/workforce/workforce-config";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BRIEF_COLLECTION = "smcs_brief" as const;
const GENERATION_COLLECTION = "smcs_generation" as const;
const FEEDBACK_COLLECTION = "smcs_feedback" as const;
const FEEDBACK_ACTIONS = ["selected", "revised", "approved", "rejected", "comment"] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const norm = (v?: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (v?: string) => new Set(norm(v).split(" ").filter((t) => t.length > 2));
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const t of a) if (b.has(t)) n++;
  return n / (a.size + b.size - n);
};

export class SmcsInputError extends Error {
  constructor(message: string, readonly fields: Array<{ field: string; message: string }> = []) { super(message); }
}
export class SmcsStorageError extends Error {}
export class SmcsModelError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export interface CampaignBrief {
  id: string;
  version: number;
  brandName: string;
  businessId?: string;
  brandSource: "brief_only" | "supplied_brand";
  positioning?: string;
  products: string[];
  constraints: string[];
  audience?: string;
  market?: string;
  country?: string;
  industry?: string;
  objective: string;
  platform?: string;
  desiredAction?: string;
  tone?: string;
  creativeRequirements: string[];
  evidence: string[];
  missingInformation: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedReference {
  id: string;
  title: string;
  brand?: string;
  score: number;
  reasons: string[];
  weakEvidence: boolean;
}
export interface RetrievalResult {
  references: RetrievedReference[];
  collapsed: Array<{ id: string; duplicateOf: string; reasons: string[] }>;
  withheldForDiversity: string[];
  warnings: string[];
  insufficient: boolean;
}

export interface CreativePrinciple {
  id: string;
  statement: string;
  kind: "demonstrated" | "interpretation" | "hypothesis";
  sourceIds: string[];
  attribution: string;
}
export interface CampaignDirection {
  id: string;
  strategicIdea: string;
  rationale: string;
  audienceInsight: string;
  message: string;
  hook: string;
  narrative: string;
  formats: string[];
  platformAdaptations: string[];
  cta: string;
  intendedAction: string;
  principleIds: string[];
  sourceIds: string[];
  assumptions: string[];
  limitations: string[];
  claimsRequiringVerification: string[];
}
export interface DirectionEvaluation {
  id: string;
  advisory: true;
  notAMeasurement: true;
  checks: Record<string, { score: number; rationale: string }>;
  similarityRisk: "low" | "moderate" | "high";
}

export type ModelResult = { ok: true; text: string; provider: string; model: string } | { ok: false; code: string; reason: string };
export type SmcsModel = (prompt: string, lineageId: string) => Promise<ModelResult>;

function listOf(raw: unknown, field: string, max: number, itemMax: number): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SmcsInputError(`${field} must be a list of short text items`, [{ field, message: "must be a list" }]);
  return [...new Set(raw.map((v) => clip(v, itemMax)).filter(Boolean))].slice(0, max);
}

export function missingForBrief(b: { audience?: string; platform?: string; desiredAction?: string; evidence: string[]; positioning?: string }): string[] {
  const missing: string[] = [];
  if (!b.audience) missing.push("target audience was not provided");
  if (!b.platform) missing.push("platform was not specified");
  if (!b.desiredAction) missing.push("desired audience action was not specified");
  if (!b.positioning) missing.push("brand positioning was not provided");
  if (!b.evidence.length) missing.push("no evidence was supplied");
  return missing;
}

/** Fills only blanks from an operator-supplied brand snapshot. Never overwrites a field the brief already has. */
export function parseBrief(input: unknown, now: string, id = `br_${randomBytes(6).toString("hex")}`): CampaignBrief {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SmcsInputError("brief must be a JSON object");
  const src = input as Record<string, unknown>;
  const brand = src.brand && typeof src.brand === "object" && !Array.isArray(src.brand) ? src.brand as Record<string, unknown> : undefined;
  const brandName = clip(src.brandName, 160) || clip(brand?.canonicalName ?? brand?.name, 160);
  const objective = clip(src.objective, 200);
  const fields: Array<{ field: string; message: string }> = [];
  if (!brandName) fields.push({ field: "brandName", message: "brand name is required" });
  if (!objective) fields.push({ field: "objective", message: "campaign objective is required" });
  if (fields.length) throw new SmcsInputError("Campaign brief is not valid", fields);
  const products = listOf(src.products ?? brand?.products ?? brand?.services, "products", 12, 80);
  const evidence = listOf(src.evidence, "evidence", 12, 300);
  const positioning = clip(src.positioning, 500) || clip(brand?.positioning ?? brand?.notes, 500) || undefined;
  const audience = clip(src.audience, 300) || undefined;
  const platform = clip(src.platform, 40) || undefined;
  const desiredAction = clip(src.desiredAction, 200) || undefined;
  const partial = { audience, platform, desiredAction, evidence, positioning };
  return {
    id, version: 1, brandName, objective,
    businessId: clip(src.businessId, 64) || undefined,
    brandSource: brand ? "supplied_brand" : "brief_only",
    positioning, products,
    constraints: listOf(src.constraints, "constraints", 12, 200),
    audience, market: clip(src.market, 80) || clip(brand?.city, 80) || undefined,
    country: clip(src.country, 80) || clip(brand?.country, 80) || undefined,
    industry: clip(src.industry, 80) || clip(brand?.category, 80) || undefined,
    platform, desiredAction, tone: clip(src.tone, 80) || undefined,
    creativeRequirements: listOf(src.creativeRequirements, "creativeRequirements", 12, 200),
    evidence,
    missingInformation: missingForBrief(partial),
    createdAt: now, updatedAt: now,
  };
}

function overlapScore(a: Set<string>, b: Set<string>, points: number): number {
  return jaccard(a, b) >= 0.34 ? points : 0;
}

/** Approved references only. Score is metadata and text overlap, never a performance figure. */
export function retrieveReferences(all: CampaignReference[], brief: Pick<CampaignBrief, "objective" | "audience" | "platform" | "market" | "country" | "positioning" | "brandName" | "industry">, limit = 5): RetrievalResult {
  const approved = all.filter((r) => r.reviewStatus === "approved");
  const warnings: string[] = [];
  if (!approved.length) return { references: [], collapsed: [], withheldForDiversity: [], warnings: ["no approved references in the library"], insufficient: true };
  const industry = brief.industry;
  const scored = approved.map((row) => {
    const reasons: string[] = [];
    let score = 0;
    if (industry && norm(row.industry) && norm(row.industry) === norm(industry)) { score += 25; reasons.push("industry_match"); }
    if (brief.platform && norm(row.platform) === norm(brief.platform)) { score += 20; reasons.push("platform_match"); }
    if (brief.market && norm(row.market) && norm(row.market) === norm(brief.market)) { score += 10; reasons.push("market_match"); }
    if (brief.country && norm(row.country) === norm(brief.country)) { score += 8; reasons.push("country_match"); }
    const obj = overlapScore(tokens(brief.objective), tokens([row.objective, row.concept, row.hook].filter(Boolean).join(" ")), 20);
    if (obj) { score += obj; reasons.push("objective_overlap"); }
    const aud = overlapScore(tokens(brief.audience), tokens(row.audience), 15);
    if (aud) { score += aud; reasons.push("audience_overlap"); }
    const text = overlapScore(tokens([brief.positioning, brief.brandName].filter(Boolean).join(" ")), tokens([row.title, row.concept, row.hook, row.positioning].filter(Boolean).join(" ")), 8);
    if (text) { score += text; reasons.push("text_overlap"); }
    const weakEvidence = !clip(row.hook, 20) && !clip(row.concept, 20) && !clip(row.evidence, 20);
    return { row, score, reasons, weakEvidence };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));

  const selected: RetrievedReference[] = [];
  const collapsed: RetrievalResult["collapsed"] = [];
  const withheldForDiversity: string[] = [];
  const perBrand = new Map<string, number>();
  for (const item of scored) {
    if (selected.length >= limit) break;
    const dup = assessDuplicates(item.row, selected.map((s) => approved.find((r) => r.id === s.id)!).filter(Boolean), item.row.id).find((d) => d.level === "likely");
    if (dup) { collapsed.push({ id: item.row.id, duplicateOf: dup.id, reasons: dup.reasons }); continue; }
    const brandKey = norm(item.row.brand) || item.row.id;
    if ((perBrand.get(brandKey) ?? 0) >= 2) { withheldForDiversity.push(item.row.id); continue; }
    perBrand.set(brandKey, (perBrand.get(brandKey) ?? 0) + 1);
    selected.push({ id: item.row.id, title: item.row.title, brand: item.row.brand, score: item.score, reasons: item.reasons.length ? item.reasons : ["weak_text_overlap"], weakEvidence: item.weakEvidence });
  }
  if (selected.some((s) => s.weakEvidence)) warnings.push("one or more selected references have little creative evidence (no hook, concept, or evidence note)");
  if (collapsed.length) warnings.push("near-duplicate references were collapsed so one source is not counted twice");
  if (withheldForDiversity.length) warnings.push("extra references from the same brand were held back to avoid leaning on one style");
  const insufficient = selected.length < 2 || (selected[0]?.score ?? 0) < 25;
  if (insufficient) warnings.push(selected.length ? "relevant approved references are thin; do not treat them as proof of what works" : "no approved reference matched this brief");
  return { references: selected, collapsed, withheldForDiversity, warnings, insufficient };
}

function refPack(refs: CampaignReference[]): string {
  return refs.map((r) => `- id ${r.id}; brand ${r.brand ?? "unspecified"}; objective ${r.objective ?? "unspecified"}; platform ${r.platform ?? "unspecified"}; hook ${clip(r.hook, 280) || "none"}; concept ${clip(r.concept, 360) || "none"}; narrative ${clip(r.narrative, 360) || "none"}; evidence ${clip(r.evidence, 280) || "none"}; limitations ${clip(r.limitations, 200) || "none"}`).join("\n");
}

const PRINCIPLE_PROMPT = (brief: CampaignBrief, refs: CampaignReference[]) => `You extract transferable creative principles for a different brand. Do not copy distinctive wording, slogans, brand names, imagery or execution from the sources. Do not invent results.
Target brand (do not describe the sources as if they were this brand): ${brief.brandName}. Objective: ${brief.objective}.
Sources:
${refPack(refs)}
Return one JSON object: {"principles":[{"statement":"","kind":"demonstrated|interpretation|hypothesis","sourceIds":["id"],"attribution":"what in the source supports this"}]}
kind demonstrated = something the source text actually shows. interpretation = a reading. hypothesis = something to test, not a fact. Every sourceId must be one of the ids above.`;

const CONCEPT_PROMPT = (brief: CampaignBrief, principles: CreativePrinciple[], warnings: string[]) => `Write original campaign directions for ${brief.brandName} only. Do not rewrite a source campaign and do not reuse its distinctive lines, names or execution.
Objective: ${brief.objective}. Audience: ${brief.audience ?? "NOT PROVIDED"}. Platform: ${brief.platform ?? "NOT PROVIDED"}. Action: ${brief.desiredAction ?? "NOT PROVIDED"}. Tone: ${brief.tone ?? "unspecified"}.
Positioning: ${brief.positioning ?? "NOT PROVIDED"}. Products: ${brief.products.join(", ") || "unspecified"}. Constraints: ${brief.constraints.join("; ") || "none stated"}.
Evidence the operator supplied: ${brief.evidence.join(" | ") || "NONE"}.
Missing, which you must not invent: ${brief.missingInformation.join("; ") || "none listed"}.
Library warnings: ${warnings.join("; ") || "none"}.
Principles you may use (cite their ids; do not cite any other source):
${principles.map((p) => `- ${p.id} [${p.kind}] ${p.statement} (sources ${p.sourceIds.join(",")})`).join("\n") || "NONE — say what is missing instead of inventing a case study."}
Return one JSON object with 3 strategically distinct directions:
{"directions":[{"strategicIdea":"","rationale":"","audienceInsight":"","message":"","hook":"","narrative":"","formats":[],"platformAdaptations":[],"cta":"","intendedAction":"","principleIds":[],"assumptions":[],"limitations":[],"claimsRequiringVerification":[]}]}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function principlesFromModel(text: string, allowedIds: string[]): { principles: CreativePrinciple[]; repairs: string[]; discarded: number } {
  let recovered: { value: unknown; repairs: string[] };
  try { recovered = recoverJsonObject(text); }
  catch (e) { throw new SmcsModelError(e instanceof Error ? e.message : "model output was not JSON", "invalid_model_output"); }
  const root = asRecord(recovered.value);
  const rows = root && Array.isArray(root.principles) ? root.principles : null;
  if (!rows) throw new SmcsModelError("model output had no principles array", "invalid_model_output");
  const allowed = new Set(allowedIds);
  const principles: CreativePrinciple[] = [];
  let discarded = 0;
  for (const row of rows.slice(0, 8)) {
    const rec = asRecord(row);
    const statement = clip(rec?.statement, 400);
    const kind = rec?.kind === "demonstrated" || rec?.kind === "interpretation" || rec?.kind === "hypothesis" ? rec.kind : null;
    const sourceIds = Array.isArray(rec?.sourceIds) ? [...new Set(rec.sourceIds.map((id) => clip(id, 64)).filter((id) => allowed.has(id)))] : [];
    if (!statement || !kind || !sourceIds.length) { discarded++; continue; }
    principles.push({ id: `pr_${principles.length + 1}`, statement, kind, sourceIds, attribution: clip(rec?.attribution, 300) || "source text listed for these ids" });
  }
  if (!principles.length) throw new SmcsModelError("no principle cited an allowed source", "invalid_model_output");
  return { principles, repairs: recovered.repairs, discarded };
}

export function directionsFromModel(text: string, principles: CreativePrinciple[], refs: CampaignReference[]): { directions: CampaignDirection[]; repairs: string[]; discarded: string[] } {
  let recovered: { value: unknown; repairs: string[] };
  try { recovered = recoverJsonObject(text); }
  catch (e) { throw new SmcsModelError(e instanceof Error ? e.message : "model output was not JSON", "invalid_model_output"); }
  const root = asRecord(recovered.value);
  const rows = root && Array.isArray(root.directions) ? root.directions : null;
  if (!rows) throw new SmcsModelError("model output had no directions array", "invalid_model_output");
  const byPrinciple = new Map(principles.map((p) => [p.id, p]));
  const banned = refs.flatMap((r) => [norm(r.hook), norm(r.title)]).filter((s) => s.length > 12);
  const directions: CampaignDirection[] = [];
  const discarded: string[] = [];
  for (const row of rows.slice(0, 4)) {
    const rec = asRecord(row);
    const strategicIdea = clip(rec?.strategicIdea, 240);
    const hook = clip(rec?.hook, 240);
    if (!strategicIdea || !hook) { discarded.push("incomplete direction"); continue; }
    if (banned.some((b) => b && (norm(hook) === b || norm(strategicIdea) === b))) { discarded.push("direction repeated a source line"); continue; }
    const principleIds = Array.isArray(rec?.principleIds) ? [...new Set(rec.principleIds.map((id) => clip(id, 16)).filter((id) => byPrinciple.has(id)))] : [];
    const sourceIds = [...new Set(principleIds.flatMap((id) => byPrinciple.get(id)?.sourceIds ?? []))];
    const limitations = listSafe(rec?.limitations);
    if (!principleIds.length) limitations.push("no traceable source principle; this direction is ungrounded");
    directions.push({
      id: `dir_${directions.length + 1}`,
      strategicIdea, hook,
      rationale: clip(rec?.rationale, 400),
      audienceInsight: clip(rec?.audienceInsight, 300),
      message: clip(rec?.message, 300),
      narrative: clip(rec?.narrative, 600),
      formats: listSafe(rec?.formats).slice(0, 6),
      platformAdaptations: listSafe(rec?.platformAdaptations).slice(0, 6),
      cta: clip(rec?.cta, 160),
      intendedAction: clip(rec?.intendedAction, 200),
      principleIds, sourceIds,
      assumptions: listSafe(rec?.assumptions).slice(0, 8),
      limitations: limitations.slice(0, 8),
      claimsRequiringVerification: listSafe(rec?.claimsRequiringVerification).slice(0, 8),
    });
  }
  if (!directions.length) throw new SmcsModelError("no original direction survived validation", "invalid_model_output");
  return { directions, repairs: recovered.repairs, discarded };
}
function listSafe(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((v) => clip(v, 200)).filter(Boolean) : [];
}

export function evaluateDirections(brief: CampaignBrief, directions: CampaignDirection[], refs: RetrievedReference[]): DirectionEvaluation[] {
  return directions.map((d) => {
    const text = norm([d.strategicIdea, d.message, d.hook, d.narrative].join(" "));
    const checks: DirectionEvaluation["checks"] = {};
    const put = (name: string, score: number, rationale: string) => { checks[name] = { score, rationale }; };
    put("strategicAlignment", tokens(brief.objective).size && jaccard(tokens(brief.objective), tokens(text)) >= 0.2 ? 4 : 2, brief.objective ? "compared with the stated objective only" : "objective tokens were thin");
    put("audienceRelevance", brief.audience && jaccard(tokens(brief.audience), tokens(d.audienceInsight + " " + d.message)) >= 0.2 ? 4 : 2, brief.audience ? "audience words appear in the insight or message" : "audience was missing, so relevance is not established");
    const constraintHit = brief.constraints.some((c) => c.length > 3 && text.includes(norm(c)));
    put("brandConsistency", d.strategicIdea.toLowerCase().includes(brief.brandName.toLowerCase()) || text.includes(norm(brief.brandName)) ? (constraintHit ? 2 : 4) : 3, constraintHit ? "a stated constraint appears inside the copy; review before use" : "brand name presence only; not a brand-system audit");
    const nearOther = directions.some((o) => o.id !== d.id && jaccard(tokens(o.strategicIdea), tokens(d.strategicIdea)) >= 0.75);
    put("distinctiveness", nearOther ? 2 : 4, nearOther ? "the idea is close to another direction in this set" : "the idea is not a near-copy of the other directions");
    put("emotionalClarity", d.hook ? 4 : 1, d.hook ? "a hook was written" : "no hook");
    put("platformSuitability", !brief.platform || d.platformAdaptations.length || text.includes(norm(brief.platform)) ? 4 : 2, brief.platform ? "checked for a platform adaptation or mention" : "no platform was requested");
    put("feasibility", d.formats.length && d.cta ? 4 : 2, "needs a format and a CTA to be executable");
    put("evidenceQuality", brief.evidence.length && d.sourceIds.length ? 4 : 2, d.sourceIds.length ? "tied to retrieved source ids" : "no source principle was cited");
    const similar = refs.some((r) => norm(r.title).length > 12 && (norm(d.hook).includes(norm(r.title)) || norm(d.strategicIdea) === norm(r.title)));
    const similarityRisk = similar || !d.sourceIds.length ? "high" : nearOther ? "moderate" : "low";
    put("similarityRisk", similarityRisk === "high" ? 2 : similarityRisk === "moderate" ? 3 : 4, "advisory only; a high risk means the draft may be too close to a source or is ungrounded");
    return { id: d.id, advisory: true, notAMeasurement: true, checks, similarityRisk };
  });
}

async function ask(model: SmcsModel, prompt: string, lineageId: string): Promise<{ text: string; provider: string; model: string }> {
  const result = await model(prompt, lineageId);
  if (!result.ok) throw new SmcsModelError(result.reason, result.code);
  return result;
}

export async function extractPrinciples(model: SmcsModel, brief: CampaignBrief, refs: CampaignReference[]): Promise<{ principles: CreativePrinciple[]; repairs: string[]; discarded: number; provider: string; model: string }> {
  if (!refs.length) throw new SmcsInputError("no references to extract from");
  const out = await ask(model, PRINCIPLE_PROMPT(brief, refs), `smcs-principles-${brief.id}`);
  return { ...principlesFromModel(out.text, refs.map((r) => r.id)), provider: out.provider, model: out.model };
}

export async function generateDirections(model: SmcsModel, brief: CampaignBrief, principles: CreativePrinciple[], refs: CampaignReference[], warnings: string[]): Promise<{ directions: CampaignDirection[]; repairs: string[]; discarded: string[]; provider: string; model: string }> {
  const out = await ask(model, CONCEPT_PROMPT(brief, principles, warnings), `smcs-concepts-${brief.id}`);
  return { ...directionsFromModel(out.text, principles, refs), provider: out.provider, model: out.model };
}

async function durably(persistence: AtlasPersistence, write: () => void) {
  const before = persistence.health().failedWrites;
  write();
  await persistence.flush();
  const after = persistence.health();
  if (after.failedWrites > before) throw new SmcsStorageError(after.lastError ?? "PostgreSQL write failed");
}

export interface SmcsIntelContext { persistence: AtlasPersistence | null; secretConfigured: boolean; model: SmcsModel }
export interface SmcsIntelResult { status: number; body: unknown }
const err = (status: number, code: string, message: string, extra?: Record<string, unknown>): SmcsIntelResult => ({ status, body: { error: { code, message, ...extra } } });

/**
 * POST /api/smcs/briefs            { brief, brand? } -> { brief }
 * POST /api/smcs/retrieve          { brief } -> retrieval (approved only)
 * POST /api/smcs/principles        { brief, referenceIds } -> { principles, repairs }
 * POST /api/smcs/concepts          { brief } -> draft directions, sources, evaluation. Nothing is published.
 * POST /api/smcs/evaluate          { brief, directions, referenceIds? }
 * POST /api/smcs/feedback          { action, reason?, briefId?, conceptId?, generationId?, revision?, actor? }
 * GET  /api/smcs/feedback?briefId=
 */
export async function handleSmcsIntelligenceRequest(method: string, pathname: string, params: URLSearchParams, readBody: () => Promise<unknown>, ctx: SmcsIntelContext): Promise<SmcsIntelResult> {
  if (!ctx.persistence) return err(503, "postgres_not_configured", "PostgreSQL persistence is not active on the Atlas server (needs ATLAS_PIPELINE_ENABLED=true and DATABASE_URL)");
  if (!ctx.secretConfigured) return err(503, "secret_required", "SMCS is disabled until ATLAS_PROXY_SHARED_SECRET is set");
  const rest = pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(2);
  const action = rest[0];
  if (!action) return err(404, "not_found", "unknown SMCS endpoint");
  const now = new Date().toISOString();
  try {
    if (action === "feedback" && method === "GET") {
      const briefId = params.get("briefId") ?? "";
      const rows = await ctx.persistence.loadAll(FEEDBACK_COLLECTION);
      const items = rows.map((r) => r.doc).filter((d) => d && typeof d === "object" && (!briefId || (d as { briefId?: string }).briefId === briefId));
      return { status: 200, body: { items, learningClaim: "stored for later analysis only; not a predictive model" } };
    }
    if (method !== "POST") return err(405, "method_not_allowed", "this SMCS action is POST only");
    const body = (await readBody()) as Record<string, unknown> | null;
    if (action === "feedback") {
      const kind = body?.action;
      if (typeof kind !== "string" || !(FEEDBACK_ACTIONS as readonly string[]).includes(kind)) throw new SmcsInputError("action must be selected, revised, approved, rejected or comment");
      const item = {
        id: `fb_${randomBytes(6).toString("hex")}`,
        action: kind as FeedbackAction,
        reason: clip(body?.reason, 500) || undefined,
        revision: clip(body?.revision, 1000) || undefined,
        actor: clip(body?.actor, 80) || undefined,
        briefId: clip(body?.briefId, 64) || undefined,
        conceptId: clip(body?.conceptId, 64) || undefined,
        generationId: clip(body?.generationId, 64) || undefined,
        createdAt: now,
        published: false,
        learningClaim: "stored for later analysis only; not a predictive model",
      };
      if ((item.briefId && !ID_PATTERN.test(item.briefId)) || (item.conceptId && !ID_PATTERN.test(item.conceptId))) throw new SmcsInputError("ids must be letters, digits, _ or -");
      await durably(ctx.persistence, () => ctx.persistence!.put(FEEDBACK_COLLECTION, item.id, item));
      return { status: 201, body: { item, published: false, sent: false } };
    }
    const brief = parseBrief(body?.brief ?? body, now, clip(body?.briefId, 64) || undefined);
    if (body?.briefId && !ID_PATTERN.test(brief.id)) throw new SmcsInputError("briefId must be letters, digits, _ or -");
    if (action === "briefs") {
      await durably(ctx.persistence, () => ctx.persistence!.put(BRIEF_COLLECTION, brief.id, brief));
      return { status: 201, body: { brief } };
    }
    const library = (await ctx.persistence.loadAll("smcs_campaign_reference")).map((r) => r.doc as CampaignReference).filter((d) => d && typeof d.id === "string");
    if (action === "retrieve") {
      const industry = clip((body?.brief as Record<string, unknown> | undefined)?.industry ?? (body as Record<string, unknown> | null)?.industry, 80) || undefined;
      return { status: 200, body: retrieveReferences(library, { ...brief, industry: brief.industry ?? industry }) };
    }
    const wantIds = Array.isArray(body?.referenceIds) ? body.referenceIds.map((id) => clip(id, 64)) : [];
    const picked = wantIds.length ? library.filter((r) => wantIds.includes(r.id) && r.reviewStatus === "approved") : [];
    const retrieval = wantIds.length && picked.length === wantIds.length
      ? { references: picked.map((r) => ({ id: r.id, title: r.title, brand: r.brand, score: 0, reasons: ["requested"], weakEvidence: !r.hook && !r.concept })), collapsed: [], withheldForDiversity: [], warnings: picked.length < 2 ? ["fewer than two approved references were supplied"] : [], insufficient: picked.length < 2 }
      : retrieveReferences(library, brief);
    const refs = library.filter((r) => retrieval.references.some((s) => s.id === r.id));
    if (action === "principles" || action === "concepts" || action === "evaluate") {
      if (!refs.length) return err(409, "insufficient_references", "No approved reference matched. Add approved references or narrow the brief. Nothing was invented.", { retrieval });
    }
    if (action === "principles") {
      const extracted = await extractPrinciples(ctx.model, brief, refs);
      return { status: 200, body: { ...extracted, referenceIds: refs.map((r) => r.id), published: false } };
    }
    if (action === "concepts") {
      const extracted = await extractPrinciples(ctx.model, brief, refs);
      const generated = await generateDirections(ctx.model, brief, extracted.principles, refs, [...brief.missingInformation, ...retrieval.warnings]);
      const evaluation = evaluateDirections(brief, generated.directions, retrieval.references);
      const generation = {
        id: `gen_${randomBytes(6).toString("hex")}`,
        brief, retrieval, principles: extracted.principles, directions: generated.directions, evaluation,
        provider: generated.provider, model: generated.model, repairs: [...extracted.repairs, ...generated.repairs],
        discarded: generated.discarded, createdAt: now, published: false, sent: false,
        learningClaim: "a draft for human review, not a measured prediction",
      };
      await durably(ctx.persistence, () => ctx.persistence!.put(GENERATION_COLLECTION, generation.id, generation));
      await durably(ctx.persistence, () => ctx.persistence!.put(BRIEF_COLLECTION, brief.id, brief));
      return { status: 201, body: generation };
    }
    if (action === "evaluate") {
      const parsed = directionsFromModel(JSON.stringify({ directions: body?.directions ?? [] }), [], refs);
      return { status: 200, body: { evaluation: evaluateDirections(brief, parsed.directions, retrieval.references), advisory: true, notAMeasurement: true } };
    }
    return err(404, "not_found", "unknown SMCS endpoint");
  } catch (error) {
    if (error instanceof SmcsInputError) return err(400, "invalid_input", error.message, error.fields.length ? { fields: error.fields } : undefined);
    if (error instanceof SmcsModelError) return err(502, error.code, error.message);
    if (error instanceof SmcsStorageError) return err(502, "postgres_write_failed", error.message);
    if (error instanceof SyntaxError) return err(400, "invalid_input", "Malformed JSON request body");
    throw error;
  }
}

const WRITER_ORDER = defaultWorkforceConfig.workerProviderMap.writer;

/** One completion through the existing writer provider order. Stops at the first success. Does not publish anything. */
export async function completeWithProviders(providers: Record<string, AIProvider>, prompt: string, lineageId: string): Promise<ModelResult> {
  let last: ModelResult = { ok: false, code: "PROVIDER_UNAVAILABLE", reason: "No writer provider is configured" };
  for (const id of WRITER_ORDER) {
    const provider = providers[id as ProviderId];
    if (!provider) continue;
    const result = await provider.execute({
      workerRole: "writer", task: prompt, priority: 1, confidenceTarget: 0.4,
      budgetLimitUsd: Math.min(0.05, defaultWorkforceConfig.dailyCostLimitUsd),
      maxTokens: 1000, temperature: 0.4, timeoutMs: Math.min(20_000, defaultWorkforceConfig.timeoutMs), lineageId,
    });
    if (!result.failed) return { ok: true, text: result.text, provider: result.provider, model: result.model };
    last = { ok: false, code: result.code, reason: result.reason };
    if (result.code !== "MISSING_API_KEY" && result.code !== "PROVIDER_UNAVAILABLE") break;
  }
  return last;
}
