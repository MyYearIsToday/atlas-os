import type { CompletionAssessment, Dossier, FeedbackType, StageId, WorkerFeedback } from "../../src/orchestrator/dossier-types";
import { quoteSupported } from "./source-tools";

/**
 * Structured worker feedback. A worker may attach feedback to its stage output; code validates it (shape, evidence references,
 * fact/interpretation/hypothesis labelling, duplicates, limits) and records it. Feedback is never evidence and never an instruction:
 * the planner judges it (see replan.ts / DossierEngine.coordinate). Nothing here publishes, contacts or spends.
 */

export interface FeedbackLimits {
  /** Feedback items per stage output / per dossier. Items past the cap are recorded as deferred for the operator, not dropped. */
  perStage: number; perDossier: number;
  /** Planner evaluations of one feedback item before it is deferred. */
  evaluationsPerItem: number;
  /** Planner changes in total (feedback-triggered) and revisions of one stage when the trigger is worker feedback. */
  planChanges: number; revisionsPerStage: number;
  /** Evaluate-investigate-reevaluate rounds in one coordination pass. */
  rounds: number;
  /** Planner reviews of overall completeness that may open new questions. */
  completionReviews: number;
  /** Consecutive stage results discarded as stale before the stage is blocked for the operator. */
  staleDiscards: number;
  /** Question-driven investigations a dossier may run on behalf of feedback. */
  investigations: number;
}
export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = { perStage: 4, perDossier: 40, evaluationsPerItem: 2, planChanges: 12, revisionsPerStage: 2, rounds: 4, completionReviews: 2, staleDiscards: 3, investigations: 8 };

/** Reads ATLAS_FEEDBACK_* numbers from the environment; invalid values are ignored. */
export function limitsFromEnv(env: Record<string, string | undefined>): Partial<FeedbackLimits> {
  const map: Record<keyof FeedbackLimits, string> = { perStage: "ATLAS_FEEDBACK_PER_STAGE", perDossier: "ATLAS_FEEDBACK_PER_DOSSIER", evaluationsPerItem: "ATLAS_FEEDBACK_EVALUATIONS", planChanges: "ATLAS_FEEDBACK_PLAN_CHANGES", revisionsPerStage: "ATLAS_FEEDBACK_REVISIONS_PER_STAGE", rounds: "ATLAS_FEEDBACK_ROUNDS", completionReviews: "ATLAS_FEEDBACK_COMPLETION_REVIEWS", staleDiscards: "ATLAS_STALE_DISCARDS", investigations: "ATLAS_FEEDBACK_INVESTIGATIONS" };
  const out: Partial<FeedbackLimits> = {};
  for (const k of Object.keys(map) as Array<keyof FeedbackLimits>) { const n = Number(env[map[k]]); if (Number.isInteger(n) && n >= 1 && n <= 100) out[k] = n; }
  return out;
}

const TYPES: ReadonlySet<string> = new Set<FeedbackType>(["finding", "challenge", "needs_evidence", "alternative_direction", "dependency_warning", "completion_assessment"]);
const BASES = new Set(["observed", "interpretation", "hypothesis", "unknown"]);
const ACTIONS = new Set(["none", "investigate", "revise_stage", "add_task", "consult_specialist", "reopen_downstream"]);
const SPECIALISTS = new Set(["scout", "builder", "operator", "closer"]);
const STAGE_IDS = new Set<string>(["audit", "competitor_discovery", "competitors", "market", "swot", "insights", "growth", "pr", "campaign", "plan", "profile", "research"]);
/** Mission purpose → one section. Ambiguous purposes are omitted on purpose. Titles are never used. */
const PURPOSE_STAGE: Record<string, StageId> = { competitor_analysis: "competitors", market_analysis: "market" };
function asStage(v: unknown): StageId | null { return typeof v === "string" && STAGE_IDS.has(v) ? v as StageId : null; }
function attributeOrdinaryStage(c: ParseCtx, affected: StageId[], itemTarget: unknown): StageId | "unassigned" {
  if (affected[0]) return affected[0];
  const meta = asStage(c.targetStage) ?? asStage(itemTarget);
  if (meta && c.known.has(meta)) return meta;
  const purpose = asStage(c.source?.missionType) ?? PURPOSE_STAGE[c.source?.missionType ?? ""];
  if (purpose && c.known.has(purpose)) return purpose;
  return "unassigned";
}
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 3));
function similar(a: string, b: string): boolean {
  const x = tokens(a), y = tokens(b); if (!x.size || !y.size) return false;
  let n = 0; for (const t of x) if (y.has(t)) n++;
  return n / Math.min(x.size, y.size) >= 0.8;
}

/** The instruction appended to every analytic worker's task. Feedback is optional: an empty list is the right answer when there is nothing to report. */
export const FEEDBACK_CLAUSE = [
  'OPTIONAL KEY "workerFeedback" (array, max 4). Add an entry ONLY when you noticed something the planner should act on; use [] when there is nothing meaningful. Do not pad. Each entry: {',
  '"type":"finding|challenge|needs_evidence|alternative_direction|dependency_warning|completion_assessment",',
  '"title":"short","observation":"what you saw","reasoning":"why it matters","businessImpact":"effect on the business assessment or strategy",',
  '"affectedStages":["stage ids such as swot, growth, pr"],"evidenceRefs":["approved source ids only, e.g. S2"],"quote":"for basis observed: a passage copied exactly from that source",',
  '"basis":"observed (a fact quoted from an approved source) | interpretation (reasoning from cited approved sources) | hypothesis | unknown",',
  '"confidence":"high|medium|low","proposedAction":{"kind":"none|investigate|revise_stage|add_task|consult_specialist|reopen_downstream","detail":""},',
  '"researchQuestions":["specific questions that more research could answer"],"recommendedSpecialist":"scout|builder|operator|closer or empty",',
  '"complete":true/false and "unresolved":[...] ONLY for completion_assessment (say honestly whether your assignment is complete and what remains)}.',
  "Use challenge when evidence contradicts an earlier section or a claim is unsupported. You propose; the planner decides. Never present an unsupported statement as observed.",
].join(" ");

/** Same contract for ordinary missions whose output is prose: an optional trailing marker line carrying the JSON list. */
export const FEEDBACK_MARKER = "ATLAS_FEEDBACK_JSON:";
export const FEEDBACK_CLAUSE_PROSE = [
  `OPTIONAL WORKER FEEDBACK. Only if, while doing this assignment, you noticed something the planner should act on (a meaningful discovery, a conclusion in the dossier that the evidence contradicts, a claim that needs more evidence, a better direction, a section that new information affects, or a doubt that your own work is complete), end your answer with one final line starting with ${FEEDBACK_MARKER} followed by a JSON array.`,
  "If there is nothing meaningful to report, add nothing at all; do not pad. Each entry uses exactly this contract:",
  FEEDBACK_CLAUSE.replace(/^OPTIONAL KEY "workerFeedback" \(array, max 4\)\. Add an entry ONLY when you noticed something the planner should act on; use \[\] when there is nothing meaningful\. Do not pad\. Each entry: /, "Entry: "),
  "Cite only approved source ids that appear in the context. Do not name businesses, sources or relationships that are not in the context.",
].join(" ");

/** Pulls the optional trailing feedback array out of a prose output. A marker with no complete array is a withheld payload, not a successful extract. */
export const FEEDBACK_EXTRACT_LIMIT = 20_000;
export interface ProseFeedbackExtract { items: unknown[] | null; withheld?: string }
export function readProseFeedback(text: string): ProseFeedbackExtract | null {
  const i = text.lastIndexOf(FEEDBACK_MARKER);
  if (i < 0) return null;
  const rest = text.slice(i + FEEDBACK_MARKER.length);
  const start = rest.indexOf("[");
  if (start < 0) return { items: null, withheld: "A worker-feedback marker was present but no JSON array followed it. Nothing was extracted." };
  let depth = 0, inStr = false, esc = false;
  const end = Math.min(rest.length, FEEDBACK_EXTRACT_LIMIT);
  for (let k = start; k < end; k++) {
    const ch = rest[k];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(rest.slice(start, k + 1));
          if (!Array.isArray(v)) return { items: null, withheld: "The worker-feedback payload was JSON but not an array. It was not extracted." };
          return { items: v };
        } catch { return { items: null, withheld: "The worker-feedback JSON could not be parsed. It was not treated as extracted." }; }
      }
    }
  }
  const oversized = rest.length > FEEDBACK_EXTRACT_LIMIT;
  return { items: null, withheld: oversized
    ? `Worker feedback exceeded ${FEEDBACK_EXTRACT_LIMIT} characters before the JSON array closed. It was not parsed and was not counted as extracted.`
    : "The worker-feedback JSON array was truncated before it closed. It was not parsed and was not counted as extracted." };
}
export function extractProseFeedback(text: string): unknown[] | null {
  const read = readProseFeedback(text);
  return read && !read.withheld ? read.items : null;
}

export interface FeedbackParse { accepted: WorkerFeedback[]; deferred: WorkerFeedback[]; rejected: Array<{ title: string; reason: string }> }

export interface ParseCtx { /** When true, attribute the section instead of using stageId. stageId is ignored for ordinary missions. */ deriveStage?: boolean; /** Explicit mission target stage, not a title. */ targetStage?: string | null; source?: { taskId: string; missionType: string }; stageId: StageId; workerId: string; refs: Set<string>; text: Map<string, string>; now: string; generation: number; existing: WorkerFeedback[]; limits: FeedbackLimits; known: Set<string> }

/** Validates raw model feedback. Never throws; malformed items are reported in `rejected`. Evidence references that do not resolve to approved sources are dropped, and a fact without a verifiable quote is downgraded. */
export function parseWorkerFeedback(raw: unknown, c: ParseCtx): FeedbackParse {
  const out: FeedbackParse = { accepted: [], deferred: [], rejected: [] };
  if (!Array.isArray(raw)) return out;
  let seq = c.existing.length;
  let sawCompletion = c.existing.some((f) => f.type === "completion_assessment" && (c.source ? f.sourceTaskId === c.source.taskId : f.stageId === c.stageId && f.stageGeneration === c.generation));
  for (const r of raw.slice(0, c.limits.perStage + 4)) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const title = clip(o.title, 140), type = String(o.type);
    const reject = (reason: string) => out.rejected.push({ title: title || "(untitled)", reason });
    if (!TYPES.has(type)) { reject("unknown feedback type"); continue; }
    const observation = clip(o.observation, 700), reasoning = clip(o.reasoning, 600), impact = clip(o.businessImpact, 400);
    if (title.length < 6 || observation.length < 20) { reject("title or observation too short to act on"); continue; }
    if (type !== "completion_assessment" && (reasoning.length < 15 || impact.length < 10)) { reject("missing reasoning or business impact"); continue; }
    const notes: string[] = [];
    const refsIn = (Array.isArray(o.evidenceRefs) ? o.evidenceRefs : []).map(String);
    const refs = [...new Set(refsIn.filter((x) => c.refs.has(x)))].slice(0, 8);
    if (refs.length < refsIn.length) notes.push(`${refsIn.length - refs.length} evidence reference(s) did not resolve to an approved source and were dropped`);
    let basis = (BASES.has(String(o.basis)) ? String(o.basis) : "hypothesis") as WorkerFeedback["basis"];
    const quote = clip(o.quote, 300);
    if (basis === "observed" && !refs.some((x) => quoteSupported(quote, c.text.get(x)))) { basis = refs.length ? "interpretation" : "hypothesis"; notes.push("downgraded from observed: the quoted passage was not found in an approved source's text"); }
    if (basis === "interpretation" && !refs.length) { basis = "hypothesis"; notes.push("downgraded from interpretation: no approved source cited"); }
    const questions = (Array.isArray(o.researchQuestions) ? o.researchQuestions : []).map((q) => clip(q, 200)).filter((q) => q.length >= 10).slice(0, 4);
    if (type === "needs_evidence" && !questions.length) { reject("needs_evidence must name at least one specific research question"); continue; }
    const affected = [...new Set((Array.isArray(o.affectedStages) ? o.affectedStages : []).map(String).filter((s) => STAGE_IDS.has(s)))] as StageId[];
    if (type === "completion_assessment") { if (sawCompletion) { reject("only one completion assessment per stage output"); continue; } sawCompletion = true; }
    const pa = (o.proposedAction && typeof o.proposedAction === "object" ? o.proposedAction : {}) as Record<string, unknown>;
    const kind = ACTIONS.has(String(pa.kind)) ? String(pa.kind) as WorkerFeedback["proposedAction"]["kind"] : "none";
    const spec = String(o.recommendedSpecialist ?? "").toLowerCase();
    const stageId = c.deriveStage ? attributeOrdinaryStage(c, affected, o.targetStage) : c.stageId;
    if (stageId === "unassigned") notes.push("Not attributed to a section. No valid affectedStages, no mission target stage, and the mission purpose did not map to one section. It was not filed under plan.");
    const fp = `${type}|${stageId}|${norm(title)}`;
    const peers = [...c.existing, ...out.accepted, ...out.deferred].filter((f) => f.status !== "superseded");
    if (peers.some((f) => `${f.type}|${f.stageId}|${norm(f.title)}` === fp || (f.type === type && f.stageId === stageId && similar(f.observation, observation)))) { reject("duplicate of earlier feedback"); continue; }
    seq++;
    const fb: WorkerFeedback = {
      id: `F${seq}`, workerId: c.workerId, stageId, ...(c.source ? { sourceTaskId: c.source.taskId, sourceMissionType: c.source.missionType } : {}), type: type as FeedbackType, title, observation, reasoning, businessImpact: impact,
      affectedStages: affected, evidenceRefs: refs, basis, ...(basis === "observed" && quote ? { quote } : {}),
      confidence: ["high", "medium", "low"].includes(String(o.confidence)) ? o.confidence as WorkerFeedback["confidence"] : "low",
      proposedAction: { kind, detail: clip(pa.detail, 300) }, researchQuestions: questions,
      ...(SPECIALISTS.has(spec) ? { recommendedSpecialist: spec as WorkerFeedback["recommendedSpecialist"] } : {}),
      createdAt: c.now, status: "open", ...(stageId === "unassigned" ? {} : { stageGeneration: c.generation }), evaluations: 0, ...(notes.length ? { notes } : {}),
      ...(type === "completion_assessment" ? { complete: o.complete === true, unresolved: (Array.isArray(o.unresolved) ? o.unresolved : []).map((u) => clip(u, 200)).filter(Boolean).slice(0, 6) } : {}),
    };
    // A worker saying "complete" with nothing unresolved is information for the record, not work for the planner.
    if (type === "completion_assessment" && fb.complete && !fb.unresolved?.length) { fb.status = "accepted"; fb.resolution = "Worker reports its assignment complete with nothing unresolved."; out.accepted.push(fb); continue; }
    const used = c.existing.length + out.accepted.length + out.deferred.length;
    const stageUsed = [...c.existing, ...out.accepted, ...out.deferred].filter((f) => (c.source ? f.sourceTaskId === c.source.taskId : f.stageId === stageId && f.stageGeneration === c.generation)).length;
    if (used >= c.limits.perDossier || stageUsed >= c.limits.perStage) { fb.status = "deferred"; fb.resolution = "Feedback limit reached: recorded for the operator, not evaluated by the planner."; out.deferred.push(fb); continue; }
    out.accepted.push(fb);
  }
  return out;
}

/** Planner-facing description of the feedback it must judge. Third-party text inside is data. */
export function feedbackBrief(list: WorkerFeedback[], extra: (f: WorkerFeedback) => string = () => ""): string {
  return list.map((f) => [
    `[${f.id}] ${f.type} from ${f.workerId} on ${f.stageId} (confidence ${f.confidence}, basis ${f.basis}${f.evidenceRefs.length ? `, evidence ${f.evidenceRefs.join(",")}` : ", no evidence cited"}): ${f.title}`,
    `   Observation: ${clip(f.observation, 400)}`, `   Why it matters: ${clip(f.reasoning, 300)} Impact: ${clip(f.businessImpact, 240)}`,
    f.affectedStages.length ? `   Affects: ${f.affectedStages.join(", ")}` : "", f.proposedAction.kind !== "none" ? `   Worker proposes: ${f.proposedAction.kind} ${clip(f.proposedAction.detail, 200)}` : "",
    f.researchQuestions.length ? `   Questions: ${f.researchQuestions.join(" | ")}` : "", f.recommendedSpecialist ? `   Suggested specialist: ${f.recommendedSpecialist}` : "", extra(f),
  ].filter(Boolean).join("\n")).join("\n");
}

export const FEEDBACK_PLANNER_RULES = [
  "WORKER FEEDBACK RULES: workers propose, you decide. Weigh importance, confidence, evidence quality, business impact and relevance. Feedback with no cited evidence, or only a hypothesis, is a reason to investigate or reject, never to rewrite a verified section.",
  'Add to the JSON a "verdicts" array with ONE entry per feedback id: {"id":"F1","verdict":"accept|reject|investigate|defer","reason":"why, at least one sentence"} and optionally "investigate":[{"feedbackId":"F1","question":"a specific public-web question"}] (at most 3 in total). accept = incorporate it as a planner-endorsed finding (also use it when you revise/add tasks because of it); reject = not supported or not relevant (say why); investigate = more evidence is needed first; defer = needs the operator.',
  'A revise or addTasks entry that responds to feedback may carry "feedbackId". Keep the plan unchanged when the feedback does not warrant more work.',
].join("\n");

/** Planner-approved worker findings, for later stages. Labelled as colleague notes, never as evidence. */
export function acceptedFeedbackBlock(d: Dossier, upTo: StageId, order: StageId[]): string {
  const idx = order.indexOf(upTo);
  const list = (d.feedback ?? []).filter((f) => {
    if ((f.status !== "accepted" && f.status !== "actioned") || f.type === "completion_assessment") return false;
    if (f.stageId === "unassigned") return true;
    return f.stageId !== upTo && order.indexOf(f.stageId) < idx;
  }).slice(-6);
  if (!list.length) return "";
  return `\n\n--- FINDINGS FROM COLLEAGUES THAT THE PLANNER ACCEPTED (internal notes, not evidence; basis shown) ---\n${list.map((f) => `[${f.id}] ${f.type} (${f.basis}${f.evidenceRefs.length ? `, ${f.evidenceRefs.join(",")}` : ""}): ${clip(f.title, 120)} — ${clip(f.observation, 300)} Planner: ${clip(f.resolution, 160)}`).join("\n")}`;
}

const HIGH = (f: WorkerFeedback) => f.confidence !== "low" && (f.type === "challenge" || f.type === "finding" || f.type === "alternative_direction" || f.type === "dependency_warning" || f.type === "needs_evidence");
/** Keyword hit is enough to call a conflict high-impact. A miss is uncertainty, not a reason to treat it as non-material. */
const MATERIAL_CONFLICT = /\b(phone|email|address|location|owner|ownership|identity|name|closed|closure|operating|trading|founded|price|pricing|licen[cs]e|regulat|legal|same business|different business|distinct|tax|taxation|fraud|litigation|lawsuit|suing|sued|insolvency|insolvent|bankruptcy|bankrupt|sanction|sanctions|embargo|banned|ban|prohibited|cease|indictment|conviction|criminal|fine|penalty|receivership|winding[- ]up|money laundering|embezzl|defaulted|seizure|court order|regulatory)\b/i;

function basisCounts(v: unknown): { backed: number; total: number } {
  let backed = 0, total = 0;
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const r = o as Record<string, unknown>;
    if (typeof r.basis === "string") { total++; if (r.basis === "verified" || r.basis === "inference") backed++; }
    Object.values(r).forEach(walk);
  };
  walk(v);
  return { backed, total };
}

/**
 * Deterministic completion facts. Code lists what is unresolved and whether each item is MATERIAL (blocks completion) or DISCLOSED
 * (carried as a stated limitation). A planner may add words, acknowledge a material source conflict, or open new questions, never hide an item.
 */
export function assessCompletion(d: Dossier, stages: Array<{ id: StageId; title: string }>, now: string, opts: { plannerJudgedComplete?: boolean } = {}): CompletionAssessment {
  const reasons: string[] = []; const unresolved: CompletionAssessment["unresolved"] = [];
  let stagePending = false, blocked = false, investigating = false;
  for (const s of stages) {
    const st = d.stages[s.id];
    if (st.status === "blocked") { blocked = true; unresolved.push({ kind: "stage", ref: s.id, detail: `${s.title} is blocked${st.error ? `: ${clip(st.error, 140)}` : ""}`, material: true }); }
    else if (st.status !== "completed") { stagePending = true; unresolved.push({ kind: "stage", ref: s.id, detail: `${s.title} is ${st.status}`, material: true }); }
    else if (st.staleBecause || d.revisions?.[s.id]?.pending) { stagePending = true; unresolved.push({ kind: "stale", ref: s.id, detail: `${s.title} was invalidated by newer information and has not been re-run`, material: true }); }
    else if (["swot", "insights", "growth", "pr"].includes(s.id)) {
      const c = basisCounts(st.output);
      if (c.total >= 4 && c.backed === 0) unresolved.push({ kind: "unsupported", ref: s.id, detail: `${s.title} rests entirely on hypotheses and unknowns: no item cites an approved source`, material: false });
    }
  }
  for (const f of d.feedback ?? []) {
    if (f.status === "investigating" || f.status === "awaiting_reevaluation") { investigating = true; unresolved.push({ kind: "investigation", ref: f.id, detail: `research for ${f.type} ${f.id} has not been reconsidered by the planner: ${clip(f.title, 100)}`, material: true }); }
    else if (f.status === "open") { stagePending = true; unresolved.push({ kind: "feedback", ref: f.id, detail: `${f.type} awaiting the planner: ${clip(f.title, 100)}`, material: true }); }
    else if (f.status === "deferred") { const material = HIGH(f) || f.type === "completion_assessment"; unresolved.push({ kind: "feedback", ref: f.id, detail: `${f.type} not resolved (${clip(f.resolution, 120)}): ${clip(f.title, 100)}`, material }); }
  }
  for (const h of d.handoffs ?? []) if (h.status === "open" && h.from !== "chat") {
    if (h.from === "planner") { stagePending = true; unresolved.push({ kind: "specialist", ref: h.id, detail: `specialist assignment still open: ${clip(h.detail, 100)}`, material: true }); }
    else { investigating = true; unresolved.push({ kind: "handoff", ref: h.id, detail: `handoff still open: ${clip(h.detail, 100)}`, material: true }); }
  }
  for (const c of d.planLog ?? []) for (const t of c.tasks) if (t.status === "failed" && !(d.feedback ?? []).some((f) => t.feedbackIds?.includes(f.id) && f.status === "deferred")) unresolved.push({ kind: "specialist", ref: t.id, detail: `specialist task "${clip(t.title, 80)}" (${t.assignedAI}) failed: ${clip(t.error, 100)}`, material: false });
  const conflicts = d.inspection?.conflicts ?? [];
  for (const c of conflicts) {
    const named = MATERIAL_CONFLICT.test(c);
    unresolved.push({ kind: "contradiction", ref: "inspection", detail: named ? `approved sources conflict (high-impact): ${clip(c, 140)}` : `approved sources conflict (wording did not match a high-impact keyword; held for review): ${clip(c, 140)}`, material: !opts.plannerJudgedComplete });
  }
  const approved = d.sources.filter((u) => u.decision === "approved" && u.role !== "competitor").length;
  const feedback = d.feedback ?? [];
  const tally = (st: string) => feedback.filter((f) => f.status === st).length;
  const material = unresolved.filter((u) => u.material), disclosed = unresolved.filter((u) => !u.material);
  let state: CompletionAssessment["state"];
  if (stagePending) { state = "in_progress"; reasons.push("Work is still moving: a section, revision, specialist assignment or feedback item has not settled."); }
  else if (blocked) { state = "blocked"; reasons.push("At least one section is blocked and cannot continue without the operator."); }
  else if (investigating) { state = "awaiting_investigation"; reasons.push("Research the planner ordered has not come back to it yet."); }
  else if (material.length) { state = "awaiting_decision"; reasons.push(`${material.length} material item(s) remain for the planner or the operator. An unresolved source conflict stays material until it is reviewed, including when its wording does not match a keyword list.`); }
  else if (disclosed.length) { state = "complete_with_limitations"; reasons.push(`All ${stages.length} sections completed on current output. ${disclosed.length} limitation(s) are judged non-material and are disclosed rather than blocking.`); }
  else { state = "complete"; reasons.push(`All ${stages.length} sections completed on current upstream output, nothing is invalidated, and nothing is unresolved.`); }
  reasons.push(`${approved} approved source(s) back the dossier. Worker feedback: ${feedback.length} recorded (${tally("accepted")} accepted, ${tally("actioned")} actioned, ${tally("rejected")} rejected, ${tally("deferred")} deferred).`);
  if (conflicts.length && opts.plannerJudgedComplete) reasons.push("The planner reviewed the source conflicts and judged the work sufficient; they remain disclosed.");
  return { at: now, state, reasons, unresolved: unresolved.slice(0, 30), assessedBy: "code" };
}

export function buildCompletionPrompt(businessName: string, a: CompletionAssessment, snapshot: string): string {
  return [
    `You are the planner of an AI marketing and PR agency, responsible for ONE mission: a coherent, evidence-based dossier for "${businessName}". Judge whether the work is genuinely sufficient, not merely whether every section returned output.`,
    `CODE'S ASSESSMENT: ${a.state}. ${a.reasons.join(" ")}${a.unresolved.length ? `\nUNRESOLVED:\n${a.unresolved.map((u) => `- ${u.kind} ${u.ref}: ${u.detail}`).join("\n")}` : ""}`,
    `SECTIONS:\n${snapshot}`,
    'Reply with JSON only: {"verdict":"complete|continue","note":"2-3 sentences recording why the work is complete, blocked or awaiting a decision","openQuestions":["specific public-web questions still worth answering, max 2, only if verdict is continue"]}. Say continue only if a specific answerable question would materially change the advice; do not ask for perfection.',
  ].join("\n\n");
}
export function parseCompletionVerdict(text: string | null, recover: (t: string) => { value: unknown }): { verdict: "complete" | "continue"; note: string; openQuestions: string[] } | null {
  if (!text) return null;
  try {
    const v = recover(text).value as Record<string, unknown>;
    if (v?.verdict !== "complete" && v?.verdict !== "continue") return null;
    const note = clip(v.note, 500); if (note.length < 15) return null;
    return { verdict: v.verdict, note, openQuestions: (Array.isArray(v.openQuestions) ? v.openQuestions : []).map((q) => clip(q, 200)).filter((q) => q.length >= 10).slice(0, 2) };
  } catch { return null; }
}
