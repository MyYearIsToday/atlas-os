import { evidenceLevel } from "./source-validation";
import { buildBusinessView } from "./business-view";
import { DOSSIER_MISSION_TYPES } from "../../src/orchestrator/atlas-pipeline";
import type { PipelineDeps } from "../../src/orchestrator/atlas-pipeline";
import type { AtlasOrchestrator } from "../../src/orchestrator/orchestrator";
import type { BusinessIntelligence } from "../../src/services/evidence/business-intelligence";
import type { BusinessRepository } from "../../src/services/scout/business-repository";
import type { AutonomyRuntime } from "../../src/services/autonomy/observability";
import type { AutonomyCycle } from "../../src/services/autonomy/loop";
import type { Dossier } from "../../src/orchestrator/dossier-types";
import { STAGES, imageSummary, type DossierEngine } from "./dossier";

/**
 * Scout visibility + operator authorisation ("Start working") + bounded "process now".
 * Nothing here sends, publishes or contacts anyone. Dossier output is a work product, never evidence,
 * and a withheld score stays withheld: the existing scoring gate is untouched.
 */

export type CandidateState =
  | "awaiting_authorization" | "awaiting_source_approval" | "processing" | "researching" | "evidence_insufficient" | "score_withheld"
  | "lead_created" | "mission_awaiting_approval" | "completed" | "failed" | "blocked";

const PRIORITY: CandidateState[] = ["blocked", "failed", "awaiting_source_approval", "mission_awaiting_approval", "lead_created", "researching", "awaiting_authorization", "completed", "evidence_insufficient", "score_withheld", "processing"];

const NEXT_ACTION: Record<CandidateState, string> = {
  awaiting_authorization: "Press “Start working” to authorise internal research on this business. Nothing runs until you do.",
  awaiting_source_approval: "Atlas found conflicting sources: the same business name appears in different places. Open the results and confirm which one is yours (approve those, reject the rest). Everything else runs automatically.",
  processing: "Atlas is processing this business. Refresh shortly.",
  researching: "The research dossier is being produced stage by stage. It continues on the server even if you close the browser.",
  evidence_insufficient: "No observed evidence (no website or peer data found), so the score stays withheld. The dossier still works from the saved record and web sources.",
  score_withheld: "Some evidence was observed but not enough to score. The score is not forced.",
  lead_created: "A lead exists for this business. Open CRM & Leads.",
  mission_awaiting_approval: "A follow-up mission needs your approval. Open Mission Queue to review it. Nothing external happens without it.",
  completed: "The dossier is complete. Open the results below.",
  failed: "A stage failed and will be retried automatically (bounded). Press “Start working” to retry now.",
  blocked: "A stage is blocked and needs you. See the blocker in the results, then press “Retry”.",
};

const DOSSIER_TYPES = new Set<string>(DOSSIER_MISSION_TYPES);
const terminal = (status: string) => status === "Completed" || status === "Failed";

type ViewRow = ReturnType<typeof buildBusinessView>[number];

export function deriveStates(row: ViewRow, ctx: { inPipeline: boolean; observationCount: number; dossier?: Dossier }): CandidateState[] {
  if (!ctx.inPipeline) return ["awaiting_authorization"];
  const found = new Set<CandidateState>();
  const d = ctx.dossier;
  const stageStatuses = d ? STAGES.map((s) => d.stages[s.id].status) : [];
  if (d?.status === "blocked" || stageStatuses.includes("blocked")) found.add("blocked");
  if (stageStatuses.includes("failed") || row.missions.some((m) => m.status === "Failed" && !DOSSIER_TYPES.has(String(m.missionType)))) found.add("failed");
  if (d?.status === "awaiting_sources") found.add("awaiting_source_approval");
  if (row.missions.some((m) => !terminal(m.status) && (m.status === "Waiting Approval" || (m.approvalRequired && m.approvalRequired !== "Auto")))) found.add("mission_awaiting_approval");
  if (row.lead.length) found.add("lead_created");
  if (d && d.status === "active" && !stageStatuses.includes("failed")) found.add("researching");
  if (d?.status === "completed") found.add("completed");
  if (row.opportunity.scoreWithheld) found.add(ctx.observationCount === 0 ? "evidence_insufficient" : "score_withheld");
  if (!found.size) found.add("processing");
  return PRIORITY.filter((s) => found.has(s));
}

export function summarizeDossier(d: Dossier | undefined, missions: Array<{ taskId: string; status: string }> = []) {
  if (!d) return null;
  return {
    status: d.status, updatedAt: d.updatedAt, manualRetries: d.manualRetries, sources: d.sources.length, sourceApproval: d.sourceApproval ?? null, sourcesApproved: d.sources.filter((s) => s.decision === "approved").length, sourcesPending: d.sources.filter((s) => (s.decision ?? "pending") === "pending").length, limitations: d.limitations,
    images: imageSummary(d),
    stages: STAGES.map((s) => { const st = d.stages[s.id]; return { id: s.id, title: s.title, status: st.status, taskId: st.taskId, missionStatus: missions.find((m) => m.taskId === st.taskId)?.status ?? null, attempts: st.attempts, error: st.error, completedAt: st.completedAt, generatedBy: st.generatedBy, dependsOn: s.dependsOn, softDependsOn: s.softDependsOn ?? [], recovery: st.recovery ? { final: st.recovery.final, attempts: st.recovery.attempts } : null }; }),
    followUps: d.followUps.map((f) => ({ ...f, missionStatus: missions.find((m) => m.taskId === f.taskId)?.status ?? null })),
  };
}

export interface CandidateContext {
  discovered: BusinessIntelligence[];
  pipeline: { deps: PipelineDeps; autonomy: AutonomyRuntime };
}

export function buildCandidateView(ctx: CandidateContext) {
  const { deps, autonomy } = ctx.pipeline;
  const byId = new Map<string, BusinessIntelligence>();
  for (const b of ctx.discovered) byId.set(b.id, b);
  for (const b of deps.store.businesses.values()) if (!byId.has(b.id)) byId.set(b.id, b);
  const tasks = deps.missionQueue.getSnapshot();
  const rows = buildBusinessView({ businesses: byId.values(), scores: deps.store.scores, audits: deps.store.audits, tasks, prospects: autonomy.lifecycle.prospects.values(), approvals: autonomy.lifecycle.approvals.values(), outputs: deps.store.missionOutputs });
  return rows.map((row) => {
    // "In the pipeline" means started/authorised. Hydration also loads unstarted Scout records into store.businesses.
    const inPipeline = deps.store.started.has(row.businessId);
    const dossier = deps.store.dossiers.get(row.businessId);
    const states = deriveStates(row, { inPipeline, observationCount: (deps.store.observations.get(row.businessId) ?? []).length, dossier });
    return { ...row, inPipeline, state: states[0], states, nextAction: NEXT_ACTION[states[0]], dossier: summarizeDossier(dossier, tasks) };
  }).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/** Full persisted dossier for one business (structured outputs, sources, follow-ups), for the business record view. */
export function readDossier(deps: PipelineDeps, businessId: string) {
  const d = deps.store.dossiers.get(businessId);
  if (!d) return null;
  const tasks = deps.missionQueue.getSnapshot();
  return { ...summarizeDossier(d, tasks), businessId, createdAt: d.createdAt, sourcesList: d.sources.map(({ pageText, ...s }) => ({ ...s, evidenceLevel: evidenceLevel({ ...s, pageText } as typeof d.sources[number]), decision: s.decision ?? "pending", relevance: s.relevance ?? "possible", pageTextChars: pageText?.length ?? 0 })), images: d.images ?? [], sourceApproval: d.sourceApproval ?? null, competitorApproval: d.competitorApproval ?? null, outputs: Object.fromEntries(STAGES.map((s) => [s.id, d.stages[s.id].output])) };
}

// ---------------------------------------------------------------- start one business

export interface ActionContext {
  repository: BusinessRepository;
  orchestrator: AtlasOrchestrator;
  pipeline: { deps: PipelineDeps; autonomy: AutonomyRuntime; persistence: { flush(): Promise<void> } | null };
  engine: DossierEngine;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const startsInFlight = new Set<string>();

/**
 * "Start working on this business": authorises THIS business, puts it through the same pipeline whether it came from
 * Scout or manual entry, then starts its dossier in the background. Idempotent: repeated calls never create a second
 * pipeline, dossier or mission; a repeat call on a blocked/failed dossier gives it a fresh bounded attempt.
 */
export async function startCandidate(ctx: ActionContext, businessId: unknown, waitMs = 15_000): Promise<{ status: number; body: unknown }> {
  if (typeof businessId !== "string" || !SAFE_ID.test(businessId)) return { status: 400, body: { ok: false, error: "invalid_business_id" } };
  const business = ctx.repository.get(businessId) ?? ctx.pipeline.deps.store.businesses.get(businessId);
  if (!business) return { status: 404, body: { ok: false, error: "not_found" } };
  if (startsInFlight.has(businessId)) return { status: 409, body: { ok: false, error: "already_running", businessId } };

  const { deps } = ctx.pipeline;
  startsInFlight.add(businessId);
  const work = (async () => {
    let dispatch = "SKIPPED_ALREADY_STARTED";
    if (!deps.store.started.has(businessId)) {
      // Explicit operator action: authorises internal processing for THIS business only.
      (deps.authorizedBusinessIds ??= new Set()).add(businessId);
      const logged = ctx.orchestrator.log.all().length;
      await ctx.orchestrator.dispatch("BusinessDiscovered", { businessId, discoveredBusiness: business, duplicateStatus: "NONE", evidenceRefs: [], sourceRefs: business.sourceReferences ?? [] }, { eventId: `scout-start:${businessId}` });
      dispatch = ctx.orchestrator.log.all().slice(logged).find((e) => e.event === "BusinessDiscovered")?.outcome ?? "UNKNOWN";
    }
    const inPipeline = deps.store.started.has(businessId);
    if (!inPipeline) return { ok: false as const, businessId, dispatch, pipeline: "not_started" };
    const existing = ctx.engine.get(businessId);
    ctx.engine.ensure(business);
    const resumed = existing ? ctx.engine.resume(businessId) : { ok: true };
    const kick = ctx.engine.kick(businessId);
    await ctx.pipeline.persistence?.flush();
    return { ok: true as const, businessId, dispatch, pipeline: "started", dossier: existing ? "existing" : "created", resume: resumed, engine: kick, summary: summarizeDossier(ctx.engine.get(businessId), deps.missionQueue.getSnapshot()) };
  })().finally(() => startsInFlight.delete(businessId));

  const timeout = Symbol("timeout");
  const result = await Promise.race([work.catch((e: unknown) => ({ failed: e instanceof Error ? e.message : String(e) })), new Promise<typeof timeout>((r) => setTimeout(r, waitMs))]);
  if (result === timeout) { void work.catch(() => undefined); return { status: 202, body: { ok: true, running: true, businessId, note: "Still starting; refresh to see progress." } }; }
  if ("failed" in result) return { status: 502, body: { ok: false, error: "start_failed", businessId } };
  return { status: result.ok ? 200 : 409, body: result };
}

// ---------------------------------------------------------------- process now

export interface ProcessSummary {
  startedAt: string; finishedAt: string | null; running: boolean;
  dossiers: { kicked: number; queued: number; stagesCompleted: number; stagesFailed: number; blocked: string[] };
  failed: string[];
  autonomy: { started: boolean; reason?: string; status?: string; executed?: number; skipped?: number; failedSteps?: number; stopReason?: string | null } | null;
  pending: { awaitingAuthorization: number; awaitingApproval: number; activeDossiers: number };
}

const countStages = (ctx: ActionContext, status: string) => [...ctx.pipeline.deps.store.dossiers.values()].reduce((n, d) => n + STAGES.filter((s) => d.stages[s.id].status === status).length, 0);

export class ProcessController {
  private current: Promise<void> | null = null;
  private last: ProcessSummary | null = null;
  status() { return { running: this.current !== null, last: this.last }; }

  /** Starts one bounded run unless one is already in progress. */
  begin(ctx: ActionContext, discovered: BusinessIntelligence[]): { started: boolean; done: Promise<void> } {
    if (this.current) return { started: false, done: this.current };
    const summary: ProcessSummary = { startedAt: new Date().toISOString(), finishedAt: null, running: true, dossiers: { kicked: 0, queued: 0, stagesCompleted: 0, stagesFailed: 0, blocked: [] }, failed: [], autonomy: null, pending: { awaitingAuthorization: 0, awaitingApproval: 0, activeDossiers: 0 } };
    this.last = summary;
    this.current = this.run(ctx, discovered, summary).catch((e) => { summary.failed.push(e instanceof Error ? e.message : String(e)); }).finally(() => { summary.running = false; summary.finishedAt = new Date().toISOString(); this.current = null; });
    return { started: true, done: this.current };
  }

  private async run(ctx: ActionContext, discovered: BusinessIntelligence[], summary: ProcessSummary) {
    const { deps, autonomy } = ctx.pipeline;
    // 1) Advance every runnable dossier: at most 2 businesses at once, at most 3 stages each (stale In Progress missions are recovered).
    const before = countStages(ctx, "completed");
    const failedBefore = countStages(ctx, "failed");
    const t = await ctx.engine.tick(3);
    summary.dossiers.kicked = t.kicked; summary.dossiers.queued = t.queued;
    summary.dossiers.stagesCompleted = countStages(ctx, "completed") - before;
    summary.dossiers.stagesFailed = Math.max(0, countStages(ctx, "failed") - failedBefore);
    for (const d of deps.store.dossiers.values()) {
      for (const s of STAGES) { const st = d.stages[s.id]; if (st.status === "blocked" || st.status === "failed") summary.failed.push(`${d.businessId}/${s.id}: ${st.status}${st.error ? ` (${st.error})` : ""}`); if (st.status === "blocked") summary.dossiers.blocked.push(`${d.businessId}/${s.id}`); }
    }
    // 2) One existing autonomy cycle (internal decisions only, its own limits/breaker, never overlaps the scheduled one).
    const woke = await autonomy.scheduler.wake("manual");
    const cycle: AutonomyCycle | undefined = woke.cycle;
    summary.autonomy = { started: woke.started, ...(woke.reason ? { reason: woke.reason } : {}), ...(cycle ? { status: cycle.status, executed: cycle.steps.filter((s) => s.action === "EXECUTED").length, skipped: cycle.steps.filter((s) => s.action === "SKIPPED").length, failedSteps: cycle.steps.filter((s) => s.action === "FAILED").length, stopReason: cycle.stopReason } : {}) };
    if (cycle?.failure) summary.failed.push(`autonomy cycle: ${cycle.failure}`);
    await ctx.pipeline.persistence?.flush();
    const view = buildCandidateView({ discovered, pipeline: { deps, autonomy } });
    summary.pending = { awaitingAuthorization: view.filter((v) => v.state === "awaiting_authorization").length, awaitingApproval: view.filter((v) => v.states.includes("mission_awaiting_approval")).length, activeDossiers: [...deps.store.dossiers.values()].filter((d) => d.status === "active").length };
  }
}

// ---------------------------------------------------------------- mission results

/**
 * What a mission actually produced, with an honest outcome. "Completed" alone never means meaningful findings:
 * a completed mission without saved output is reported as such. Model output is a work product, never evidence.
 */
export function readMissionResult(deps: PipelineDeps, taskId: string) {
  const t = deps.missionQueue.getSnapshot().find((m) => m.taskId === taskId);
  if (!t) return null;
  const out = deps.store.missionOutputs.get(taskId);
  const text = out?.text?.trim() ?? "";
  const outcome = t.status === "Failed" ? "failed" : t.status !== "Completed" ? (t.status === "In Progress" ? "running" : "not_run") : text ? "result" : "completed_without_output";
  const dossier = t.clientId ? deps.store.dossiers.get(t.clientId) : undefined;
  const stage = dossier ? STAGES.find((s) => dossier.stages[s.id].taskId === taskId) : undefined;
  return {
    taskId, title: t.title, businessId: t.clientId ?? null, missionType: t.missionType ?? null, status: t.status, approvalRequired: t.approvalRequired,
    completedAt: t.completedAt ?? null, attempts: t.executionHistory.length, lastFailureReason: t.lastFailureReason ?? null, outcome,
    scope: String(t.description ?? "").replace(/\s+/g, " ").slice(0, 400),
    output: out && text ? { text: out.text.slice(0, 40_000), generatedBy: out.generatedBy, routing: (out as { routing?: unknown }).routing ?? null, isEvidence: false as const, note: "AI work product for the operator. It is not verified evidence." } : null,
    stage: stage ? { id: stage.id, title: stage.title, status: dossier!.stages[stage.id].status, parsed: dossier!.stages[stage.id].output ?? null } : null,
    history: t.executionHistory.slice(-5).map((h) => ({ attempt: h.attempt, outcome: h.outcome, at: h.completedAt, reason: h.reason ?? null })),
  };
}
