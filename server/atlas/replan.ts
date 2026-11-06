import type { Dossier, PlanChange, StageId } from "../../src/orchestrator/dossier-types";
import { recoverJsonObject } from "./json-recovery";

/**
 * Mission re-planning. The planner (a model) judges a discovery against the current plan; this module builds its brief and validates its
 * decision against hard limits. The model may choose WHICH completed sections to keep or revise and WHAT extra specialist work to add;
 * code decides what is allowed: only completed analytic sections can be revised, each at most once, identity-defining sections never,
 * and added tasks are internal analysis for a known specialist. Nothing external can come out of a re-plan.
 *
 * This repository has no separate insights stage. Revisable sections are the analytic stages that actually exist here, plus PR.
 */

export const REVISABLE: ReadonlySet<StageId> = new Set<StageId>(["audit", "competitors", "market", "swot", "growth", "pr", "campaign", "plan"]);
export const MAX_PLAN_CHANGES = 6;
const AGENTS = new Set(["scout", "builder", "operator", "closer"]);
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export interface ReplanDecision {
  decision: PlanChange["decision"]; reason: string; keep: StageId[];
  revise: Array<{ stage: StageId; note: string }>;
  addTasks: Array<{ title: string; description: string; assignedAI: string }>;
}

/** A short, factual view of the plan state for the planner: which sections exist, what each concluded, what is still to run. */
export function planSnapshot(d: Dossier, titles: Record<StageId, string>): string {
  const lines: string[] = [];
  for (const id of Object.keys(titles) as StageId[]) {
    const st = d.stages[id]; if (!st) continue;
    const gist = st.status === "completed" && st.output ? clip(JSON.stringify(st.output), 260) : "";
    lines.push(`- ${id} (${titles[id]}): ${st.status}${(d.revisions?.[id]?.count ?? 0) ? ", already revised once" : ""}${st.staleBecause ? ", marked stale" : ""}${gist ? ` — ${gist}` : ""}`);
  }
  return lines.join("\n");
}

export function buildReplanPrompt(businessName: string, snapshot: string, trigger: string, priorChanges: PlanChange[]): string {
  return [
    `You are the planner of an AI marketing and PR agency, responsible for ONE mission: a coherent, evidence-based dossier and strategy for "${businessName}". A specialist has reported something that may change the direction of the work.`,
    `DISCOVERY OR CHALLENGE:\n${clip(trigger, 800)}`,
    `CURRENT PLAN STATE (section: status, then a fragment of what it concluded):\n${snapshot}`,
    priorChanges.length ? `EARLIER PLAN CHANGES:\n${priorChanges.slice(-3).map((c) => `${c.decision}: ${clip(c.reason, 160)}`).join("\n")}` : "",
    "Decide whether the current plan is still right. Do NOT rerun everything. Prefer: keep sections that remain valid, revise only the sections the discovery actually undermines (a revised section is redone with your note, and its earlier version is preserved), and add specialist work only where a gap is real.",
    'Rules: you may revise only sections whose status is completed and not already revised; never profile or research. At most 2 revisions and 2 added tasks. Added tasks are internal analysis for one of: scout (research), builder (analysis/audit), operator (strategy/planning), closer (PR, creative, client communications drafts). Nothing external can be sent or published. If the plan is still appropriate, decide "continue" and say why.',
    'Reply with JSON only: {"decision":"continue|revise|add_tasks|revise_and_add","reason":"2-3 sentences explaining why the direction does or does not change","keep":["stage ids still valid"],"revise":[{"stage":"swot","note":"what must change and why"}],"addTasks":[{"title":"","description":"what to produce and from which evidence","assignedAI":"scout|builder|operator|closer"}]}',
  ].filter(Boolean).join("\n\n");
}

export function parseReplan(text: string | null, d: Dossier): ReplanDecision | null {
  if (!text) return null;
  let v: Record<string, unknown>;
  try { v = recoverJsonObject(text).value as Record<string, unknown>; } catch { return null; }
  const completed = (id: string): id is StageId => !!d.stages[id as StageId] && d.stages[id as StageId].status === "completed";
  const revise: ReplanDecision["revise"] = [];
  for (const r of (Array.isArray(v.revise) ? v.revise : []).slice(0, 2) as Array<Record<string, unknown>>) {
    const stage = String(r?.stage); const note = clip(r?.note, 400);
    if (!REVISABLE.has(stage as StageId) || !completed(stage) || (d.revisions?.[stage as StageId]?.count ?? 0) >= 1 || note.length < 15 || revise.some((x) => x.stage === stage)) continue;
    revise.push({ stage: stage as StageId, note });
  }
  const addTasks = (Array.isArray(v.addTasks) ? v.addTasks : []).slice(0, 2).map((t) => {
    const x = t as Record<string, unknown>; const title = clip(x?.title, 140), description = clip(x?.description, 700), ai = String(x?.assignedAI ?? "").toLowerCase();
    return title.length >= 8 && description.length >= 30 && AGENTS.has(ai) ? { title, description, assignedAI: ai } : null;
  }).filter((t): t is NonNullable<typeof t> => t !== null);
  const keep = (Array.isArray(v.keep) ? v.keep : []).map(String).filter(completed);
  const reason = clip(v.reason, 600);
  if (reason.length < 15) return null;
  const decision: ReplanDecision["decision"] = revise.length && addTasks.length ? "revise_and_add" : revise.length ? "revise" : addTasks.length ? "add_tasks" : "continue";
  return { decision, reason, keep: keep.filter((k) => !revise.some((r) => r.stage === k)), revise, addTasks };
}

/** Sections built on a revised one. Completed ones are flagged and redone; failed ones are reopened too. Unrelated sections are not included. */
export function dependentsOf(revised: StageId[], deps: Array<{ id: StageId; dependsOn: StageId[]; softDependsOn?: StageId[] }>, d: Dossier, statuses: ReadonlySet<string> = new Set(["completed"])): StageId[] {
  const out = new Set<StageId>(); let grew = true;
  const roots = new Set<StageId>(revised);
  while (grew) {
    grew = false;
    for (const s of deps) {
      if (out.has(s.id) || roots.has(s.id)) continue;
      if ([...s.dependsOn, ...(s.softDependsOn ?? [])].some((p) => roots.has(p) || out.has(p)) && statuses.has(d.stages[s.id]?.status)) { out.add(s.id); grew = true; }
    }
  }
  return [...out];
}
