import { randomUUID } from "node:crypto";
import type { PipelineStore } from "../../src/orchestrator/atlas-pipeline";
import type { AtlasPersistence } from "../../src/services/persistence/atlas-persistence";
import type { Dossier } from "../../src/orchestrator/dossier-types";
import { contextBlock, type DossierEngine } from "./dossier";
import { recoverJsonObject } from "./json-recovery";
import { normalizeUrl, quoteSupported } from "./source-tools";

/**
 * Business-scoped conversation. Every answer is built only from ONE business's record, dossier, evidence ledger and conversation
 * history. The model may ask for ONE bounded round of extra evidence; its citations are checked against the stored source text.
 * Nothing here contacts anyone, publishes, creates accounts or spends: the model can only PROPOSE work, and a proposal becomes a
 * mission only when the operator accepts it, as an Approval Required mission that the existing approval gateway governs.
 */
export interface Proposal { id: string; kind: "revised_recommendation" | "plan" | "campaign_idea" | "mission"; title: string; description: string; assignedAI: string; external: boolean; status: "proposed" | "accepted" | "declined"; taskId?: string }
export interface Citation { sourceId: string; url?: string; title?: string; quote?: string; verified: boolean }
export interface ChatMessage {
  id: string; role: "user" | "assistant"; content: string; at: string;
  status?: "done" | "failed"; replyTo?: string; error?: string;
  citations?: Citation[]; confidence?: "high" | "medium" | "low"; missing?: string[];
  retrieved?: Array<{ id: string; url: string; decision: string; read: boolean; reason: string }>; retrievalNotes?: string[];
  proposals?: Proposal[]; model?: string;
  /** cited = at least one verified-source citation; uncited = answer cites nothing; unstructured = the model did not follow the format. */
  grounding?: "cited" | "uncited" | "unstructured";
}
export interface Conversation { businessId: string; messages: ChatMessage[]; updatedAt: string }

export type ChatModel = (req: { system: string; messages: Array<{ role: "user" | "assistant"; content: string }>; businessId: string }) => Promise<{ ok: true; text: string; provider: string; model: string } | { ok: false; reason: string }>;

const MAX_QUESTION = 2000;
const MAX_MESSAGES = 200;
const HISTORY_TURNS = 8;
const CONTEXT_CHARS = 26_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const STOP = new Set(["what", "which", "that", "this", "with", "from", "have", "does", "about", "their", "there", "would", "could", "should", "your", "them", "they", "will", "been", "more", "than", "into", "also", "when", "where", "why", "how", "the", "and", "for", "are", "you", "can", "not"]);

export const CHAT_SYSTEM = (name: string) => [
  `You are Atlas, the senior strategist of a marketing and PR agency, answering the operator's follow-up questions about ONE business: ${name}.`,
  "Answer the question that was actually asked, directly and specifically, with the reasoning behind it. Do not repeat the dossier, pad, or give generic marketing advice.",
  "Use ONLY the CONTEXT below. Keep three things apart in every answer: what was OBSERVED (cite the source id, e.g. [S3]), what you INFER (say so and why), and what is UNKNOWN or could not be accessed. A source that could not be read was not inspected; never imply it was. A failed or missing source is never proof that something does not exist or is inactive.",
  "If the operator challenges a finding, re-check it against the evidence. If the evidence does not support it, say so plainly and give the corrected view; if it does, show the supporting source. Do not defend the dossier for its own sake and do not simply agree.",
  "If the evidence needed to answer is missing, say exactly what is missing. If one more page or search could settle it, request it in needsEvidence (urls only from this business's own website or known sources; at most one query).",
  "Never invent facts, numbers, quotes, URLs, reviews, competitors or access. Another organisation with a similar name, or a parent institution, is NOT this business.",
  "You cannot send messages, publish, create accounts, contact anyone or spend money. When the operator wants something done, PROPOSE it in proposals; it only happens after the operator approves it in Atlas.",
  'Respond with ONE JSON object only: {"answer": string (markdown allowed, as long as the question needs), "citations": [{"sourceId": "S1", "quote": "optional passage of at least 20 characters copied exactly from that source\'s text"}], "confidence": "high|medium|low", "missing": [string], "needsEvidence": null | {"urls": [string], "query": string}, "proposals": [{"kind": "revised_recommendation|plan|campaign_idea|mission", "title": string, "description": string, "assignedAI": "scout|builder|operator|closer", "external": boolean}]}',
].join("\n");

/** The passages of approved source text that best match the question, so follow-up answers can quote real evidence. */
export function retrieveExcerpts(d: Dossier, question: string, max = 6): string {
  const words = [...new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)))];
  if (!words.length) return "";
  const scored: Array<{ id: string; text: string; score: number }> = [];
  for (const s of d.sources) {
    if (s.decision !== "approved" || !s.pageText || s.role === "competitor") continue;
    for (let i = 0; i < s.pageText.length; i += 450) {
      const chunk = s.pageText.slice(i, i + 600); const low = chunk.toLowerCase();
      const score = words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0);
      if (score) scored.push({ id: s.id, text: chunk, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((c) => `[${c.id}] "${c.text.trim()}"`).join("\n");
}

function knownUrls(d: Dossier, website?: string): Set<string> {
  const set = new Set<string>(d.sources.map((s) => normalizeUrl(s.url)));
  for (const p of d.inspection?.website?.pages ?? []) { set.add(normalizeUrl(p.url)); if (p.finalUrl) set.add(normalizeUrl(p.finalUrl)); }
  for (const o of d.inspection?.social ?? []) set.add(normalizeUrl(o.url));
  if (website) set.add(normalizeUrl(website));
  return set;
}

/** Parses and VERIFIES the model's reply against the stored dossier. Never throws: an unusable reply becomes an unstructured answer. */
export function parseChatReply(text: string, d: Dossier, website?: string): Pick<ChatMessage, "content" | "citations" | "confidence" | "missing" | "proposals" | "grounding"> & { needsEvidence: { urls: string[]; query: string } | null } {
  let o: Record<string, unknown> | null = null;
  try { const v = recoverJsonObject(text).value; if (v && typeof v === "object" && typeof (v as Record<string, unknown>).answer === "string") o = v as Record<string, unknown>; } catch { /* fall through */ }
  const known = knownUrls(d, website);
  const scrub = (t: string) => t.replace(/https?:\/\/[^\s)\]>"']+/g, (u) => (known.has(normalizeUrl(u)) ? u : "[link removed: not a known source]"));
  if (!o) return { content: scrub(clip(text, 6000) ? text.trim().slice(0, 6000) : "The model returned no usable answer."), citations: [], grounding: "unstructured", needsEvidence: null };
  const bySource = new Map(d.sources.filter((s) => s.decision === "approved").map((s) => [s.id, s]));
  const citations: Citation[] = [];
  for (const c of (Array.isArray(o.citations) ? o.citations : []).slice(0, 8) as Array<Record<string, unknown>>) {
    const s = bySource.get(String(c?.sourceId)); if (!s || citations.some((x) => x.sourceId === s.id)) continue;
    const quote = clip(c?.quote, 300);
    citations.push({ sourceId: s.id, url: s.url, title: s.title, ...(quote ? { quote } : {}), verified: !!quote && quoteSupported(quote, s.pageText) });
  }
  // A source id cited inline that does not exist is removed, so the operator is never pointed at evidence that is not there.
  const content = scrub(String(o.answer).trim().slice(0, 8000)).replace(/\[S(\d+)\]/g, (m, n) => (bySource.has(`S${n}`) ? m : "[source not found]"));
  const ne = o.needsEvidence && typeof o.needsEvidence === "object" ? o.needsEvidence as Record<string, unknown> : null;
  const needsEvidence = ne ? { urls: (Array.isArray(ne.urls) ? ne.urls : []).map(String).slice(0, 2), query: clip(ne.query, 200) } : null;
  const proposals: Proposal[] = (Array.isArray(o.proposals) ? o.proposals : []).slice(0, 4).map((p): Proposal | null => {
    const x = p as Record<string, unknown>; const title = clip(x?.title, 160); if (!title) return null;
    const kind = ["revised_recommendation", "plan", "campaign_idea", "mission"].includes(String(x?.kind)) ? String(x.kind) as Proposal["kind"] : "plan";
    const ai = ["scout", "builder", "operator", "closer"].includes(String(x?.assignedAI)) ? String(x.assignedAI) : "operator";
    return { id: randomUUID().slice(0, 8), kind, title, description: clip(x?.description, 1200), assignedAI: ai, external: x?.external === true, status: "proposed" };
  }).filter((p): p is Proposal => p !== null);
  return {
    content: content || "The model returned an empty answer.", citations,
    confidence: ["high", "medium", "low"].includes(String(o.confidence)) ? o.confidence as ChatMessage["confidence"] : "low",
    missing: (Array.isArray(o.missing) ? o.missing : []).map((m) => clip(m, 240)).filter(Boolean).slice(0, 8),
    proposals, grounding: citations.length ? "cited" : "uncited",
    needsEvidence: needsEvidence && (needsEvidence.urls.length || needsEvidence.query) ? needsEvidence : null,
  };
}

export interface ChatDeps { store: PipelineStore; engine: DossierEngine; model?: ChatModel; persistence?: AtlasPersistence | null; now?: () => string }

export class ChatService {
  private convs = new Map<string, Conversation>();
  private inflight = new Set<string>();
  private jobs = new Map<string, Promise<void>>();
  private now: () => string;
  constructor(private d: ChatDeps) { this.now = d.now ?? (() => new Date().toISOString()); }

  async hydrate(): Promise<number> {
    if (!this.d.persistence) return 0;
    const rows = await this.d.persistence.loadAll("conversation");
    for (const r of rows) if (r?.doc && Array.isArray(r.doc.messages)) this.convs.set(r.id, r.doc as Conversation);
    return rows.length;
  }

  get available() { return !!this.d.model; }
  history(businessId: string): Conversation | null {
    if (!SAFE_ID.test(businessId) || !this.d.store.businesses.has(businessId)) return null;
    return this.convs.get(businessId) ?? { businessId, messages: [], updatedAt: this.now() };
  }
  isBusy(businessId: string) { return this.inflight.has(businessId); }
  /** Resolves when the current answer (if any) has been stored. */
  async idle(businessId: string) { await this.jobs.get(businessId); }

  private async persist(c: Conversation) {
    c.updatedAt = this.now(); if (c.messages.length > MAX_MESSAGES) c.messages = c.messages.slice(-MAX_MESSAGES);
    this.convs.set(c.businessId, c); this.d.persistence?.put("conversation", c.businessId, c); await this.d.persistence?.flush();
  }

  /** Records the question and starts the answer in the background (model calls can outlast a gateway request). */
  async ask(businessId: string, question: unknown): Promise<{ status: number; body: unknown }> {
    if (typeof businessId !== "string" || !SAFE_ID.test(businessId)) return { status: 400, body: { ok: false, error: "invalid_business_id" } };
    const b = this.d.store.businesses.get(businessId);
    if (!b) return { status: 404, body: { ok: false, error: "not_found" } };
    const text = typeof question === "string" ? question.trim() : "";
    if (!text) return { status: 400, body: { ok: false, error: "empty_message", message: "Type a question first." } };
    if (text.length > MAX_QUESTION) return { status: 400, body: { ok: false, error: "message_too_long", message: `Keep the question under ${MAX_QUESTION} characters.` } };
    if (!this.d.model) return { status: 503, body: { ok: false, error: "chat_unavailable", message: "The AI Workforce is not enabled on this server, so chat cannot answer yet. Nothing was lost." } };
    if (!this.d.engine.get(businessId)) return { status: 409, body: { ok: false, error: "no_dossier", message: "Start working on this business first so there is research to discuss." } };
    if (this.inflight.has(businessId)) return { status: 409, body: { ok: false, error: "already_answering", message: "Atlas is still answering your previous question." } };
    const conv = this.convs.get(businessId) ?? { businessId, messages: [], updatedAt: this.now() };
    const userMsg: ChatMessage = { id: randomUUID().slice(0, 12), role: "user", content: text, at: this.now(), status: "done" };
    conv.messages.push(userMsg); await this.persist(conv);
    this.inflight.add(businessId);
    const job = this.answer(businessId, userMsg).catch((e) => console.error(`[atlas-chat] answer error: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`)).finally(() => { this.inflight.delete(businessId); this.jobs.delete(businessId); });
    this.jobs.set(businessId, job);
    return { status: 202, body: { ok: true, pending: true, messageId: userMsg.id, conversation: this.convs.get(businessId) } };
  }

  private buildContext(businessId: string, question: string): string {
    const b = this.d.store.businesses.get(businessId)!; const d = this.d.engine.get(businessId)!;
    const plan = d.stages.plan.output ? `\n\n## Action plan (already produced)\n${clip(JSON.stringify(d.stages.plan.output), 3500)}` : "";
    const excerpts = retrieveExcerpts(d, question);
    const rejected = d.sources.filter((s) => s.decision === "rejected" || (s.decision === "pending" && s.role !== "competitor")).slice(0, 8).map((s) => `[${s.id}] NOT USED — ${clip(s.title, 80)} — ${s.url} — ${clip(s.decisionReason ?? (s.reasons ?? []).join("; "), 200)}`).join("\n");
    const block = `${contextBlock(b, d, this.d.store, "plan")}${plan}${excerpts ? `\n\n--- PASSAGES MOST RELEVANT TO THE QUESTION (verbatim from approved sources) ---\n${excerpts}` : ""}${rejected ? `\n\n--- SOURCES REJECTED OR HELD BACK (not about this business, or unconfirmed; never cite) ---\n${rejected}` : ""}`;
    return block.length > CONTEXT_CHARS ? `${block.slice(0, CONTEXT_CHARS)}\n[context truncated]` : block;
  }

  private async answer(businessId: string, userMsg: ChatMessage): Promise<void> {
    const conv = this.convs.get(businessId)!;
    const b = this.d.store.businesses.get(businessId)!;
    const system = CHAT_SYSTEM(b.canonicalName);
    const turns = conv.messages.filter((m) => m !== userMsg && m.status !== "failed").slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: clip(m.content, 1500) }));
    const finish = async (m: Omit<ChatMessage, "id" | "role" | "at" | "replyTo">) => { conv.messages.push({ id: randomUUID().slice(0, 12), role: "assistant", at: this.now(), replyTo: userMsg.id, ...m }); await this.persist(conv); };
    const call = async (context: string) => this.d.model!({ businessId, system, messages: [...turns, { role: "user", content: `--- CONTEXT (this business only) ---\n${context}\n\n--- OPERATOR QUESTION ---\n${userMsg.content}` }] });
    try {
      let r = await call(this.buildContext(businessId, userMsg.content));
      if (!r.ok) { await finish({ content: "Atlas could not get an answer from the AI Workforce just now. Your question is saved; ask again in a moment. Nothing was changed.", status: "failed", error: "model_unavailable" }); return; }
      let parsed = parseChatReply(r.text, this.d.engine.get(businessId)!, b.website);
      let retrieved: ChatMessage["retrieved"]; let notes: string[] | undefined;
      if (parsed.needsEvidence) {
        const got = await this.d.engine.addEvidence(businessId, parsed.needsEvidence);
        retrieved = got.added; notes = got.notes;
        if (got.added.some((a) => a.read) ) {
          const again = await call(`${this.buildContext(businessId, userMsg.content)}\n\n--- EVIDENCE JUST RETRIEVED FOR THIS QUESTION ---\n${got.added.map((a) => `[${a.id}] ${a.url} — ${a.read ? "read" : "not read"}; ${a.decision}: ${a.reason}`).join("\n")}\nRetrieval is done for this question: answer now, set needsEvidence to null.`);
          if (again.ok) { r = again; parsed = parseChatReply(again.text, this.d.engine.get(businessId)!, b.website); }
        } else if (got.notes.length || got.added.length) {
          parsed.missing = [...(parsed.missing ?? []), ...got.notes, ...got.added.map((a) => `${a.url}: ${a.reason}`)].slice(0, 8);
        }
      }
      const { needsEvidence: _n, ...rest } = parsed;
      await finish({ ...rest, status: "done", ...(retrieved?.length ? { retrieved } : {}), ...(notes?.length ? { retrievalNotes: notes } : {}), model: `${r.provider}/${r.model}` });
    } catch (e) {
      console.error(`[atlas-chat] failed businessId=${businessId}: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`);
      await finish({ content: "Atlas hit an error while preparing that answer. Your question is saved; try again. Nothing was changed.", status: "failed", error: "answer_failed" });
    }
  }

  /** The operator accepts a proposal: it becomes an Approval Required mission. Nothing runs, sends or publishes. */
  async decideProposal(businessId: string, messageId: string, proposalId: string, decision: "accept" | "decline"): Promise<{ status: number; body: unknown }> {
    if (!SAFE_ID.test(businessId) || !SAFE_ID.test(messageId) || !SAFE_ID.test(proposalId)) return { status: 400, body: { ok: false, error: "invalid_id" } };
    const conv = this.convs.get(businessId); const p = conv?.messages.find((m) => m.id === messageId)?.proposals?.find((x) => x.id === proposalId);
    if (!conv || !p) return { status: 404, body: { ok: false, error: "not_found" } };
    if (p.status !== "proposed") return { status: 409, body: { ok: false, error: "already_decided", proposal: p } };
    if (decision === "decline") { p.status = "declined"; await this.persist(conv); return { status: 200, body: { ok: true, proposal: p } }; }
    const made = await this.d.engine.createProposedMission(businessId, { title: p.title, description: `${p.kind.replace("_", " ")}: ${p.description}`, assignedAI: p.assignedAI, external: p.external });
    if (!made) return { status: 409, body: { ok: false, error: "no_dossier", message: "This business has no dossier to attach the mission to." } };
    p.status = "accepted"; p.taskId = made.taskId; await this.persist(conv);
    return { status: 200, body: { ok: true, proposal: p, note: "Created as an Approval Required mission. It will not run, send or publish anything until you approve it in the Mission Queue." } };
  }
}
