import type { ArchivedStage, Dossier, DossierVersion, StageId, StageRecord, StageRevision } from "../../src/orchestrator/dossier-types";

/** Analytical sections whose previous conclusions must survive a revision or a fresh research pass. Research itself is retrieval, not a conclusion. */
export const ARCHIVED_STAGES: readonly StageId[] = ["profile", "audit", "competitor_discovery", "competitors", "market", "swot", "growth", "pr", "campaign", "plan"];
const MAX_VERSIONS = 12;
const MAX_REVISION_LOG = 60;

const stable = (v: unknown) => { try { return JSON.stringify(v); } catch { return ""; } };

export function citedSourceRefs(output: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const item of v) walk(item); return; }
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.sourceRefs)) for (const r of o.sourceRefs) if (/^S\d+$/.test(String(r))) ids.add(String(r));
    for (const val of Object.values(o)) if (val && typeof val === "object") walk(val);
  };
  walk(output);
  return [...ids];
}

export function stageOutput(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "output" in (raw as object) && "status" in (raw as object)) return (raw as ArchivedStage).output;
  return raw;
}

export function presentStage(raw: unknown): ArchivedStage {
  if (raw && typeof raw === "object" && "output" in (raw as object) && "status" in (raw as object)) {
    const s = raw as ArchivedStage;
    return { status: s.status, output: s.output, completedAt: s.completedAt ?? null, generatedBy: s.generatedBy ?? null, sourceRefs: s.sourceRefs ?? citedSourceRefs(s.output), ...(s.staleBecause ? { staleBecause: s.staleBecause } : {}) };
  }
  return { status: "completed", output: raw, completedAt: null, generatedBy: null, sourceRefs: citedSourceRefs(raw) };
}

function snapshotStage(st: StageRecord | undefined): ArchivedStage | null {
  if (!st || st.status === "pending" || st.status === "running") return null;
  if (st.output == null && st.status !== "completed" && st.status !== "blocked" && st.status !== "failed") return null;
  return { status: st.status, output: st.output, completedAt: st.completedAt, generatedBy: st.generatedBy, sourceRefs: citedSourceRefs(st.output), ...(st.staleBecause ? { staleBecause: st.staleBecause } : {}) };
}

/** Full analytical snapshot. Does not copy page text. */
export function archiveVersion(x: Dossier, now: string, reason: string, meta: { kind: "reresearch" | "revision"; planChangeId?: string; triggerSummary?: string }): DossierVersion {
  const stages: DossierVersion["stages"] = {};
  for (const id of ARCHIVED_STAGES) {
    const snap = snapshotStage(x.stages[id]);
    if (snap) stages[id] = snap;
  }
  const version: DossierVersion = {
    id: `H${(x.history?.length ?? 0) + 1}-${now}`,
    round: x.researchRound ?? 0,
    archivedAt: now,
    reason,
    kind: meta.kind,
    ...(meta.planChangeId ? { planChangeId: meta.planChangeId } : {}),
    ...(meta.triggerSummary ? { triggerSummary: meta.triggerSummary } : {}),
    stages,
    sourceDigest: x.sources.slice(0, 60).map((u) => ({ id: u.id, url: u.url, retrievedAt: u.retrievedAt, ...(u.decision ? { decision: u.decision } : {}), ...(u.relevance ? { relevance: u.relevance } : {}) })),
    limitations: x.limitations.slice(-12),
    planDecisions: (x.planLog ?? []).slice(-8).map((c) => ({ id: c.id, at: c.at, decision: c.decision, reason: c.reason, revised: c.revised })),
    investigations: (x.investigations ?? []).slice(-8).map((i) => ({ id: i.id, question: i.question, at: i.at, ...(i.finding ? { finding: i.finding } : {}), ...(i.stopReason ? { stopReason: i.stopReason } : {}) })),
  };
  (x.history ??= []).push(version);
  retainHistory(x);
  return version;
}

/** Keep the previous output of one section. This is the copy that must survive even if a short inline history is trimmed. */
export function archiveStageOutput(x: Dossier, stage: StageId, now: string, reason: string, link?: { planChangeId?: string; versionId?: string }): StageRevision | null {
  const st = x.stages[stage];
  if (!st || st.output == null) return null;
  const rec: StageRevision = {
    id: `R${(x.revisionLog?.length ?? 0) + 1}-${stage}`,
    stage, at: now, reason,
    ...(link?.planChangeId ? { planChangeId: link.planChangeId } : {}),
    ...(link?.versionId ? { versionId: link.versionId } : {}),
    output: st.output, completedAt: st.completedAt, generatedBy: st.generatedBy, sourceRefs: citedSourceRefs(st.output),
  };
  (x.revisionLog ??= []).push(rec);
  retainHistory(x);
  return rec;
}

function outputKey(stage: string, output: unknown) { return `${stage}:${stable(output)}`; }

/** Drop only snapshots whose outputs are already kept. A unique conclusion is copied onto the revision log before its snapshot goes. */
export function retainHistory(x: Dossier): void {
  const hist = x.history ?? [];
  const log = (x.revisionLog ??= []);
  const kept = new Set<string>();
  for (const r of log) kept.add(outputKey(r.stage, r.output));
  for (let i = hist.length - 1; i >= 0; i--) {
    const within = i >= hist.length - MAX_VERSIONS;
    for (const [stage, raw] of Object.entries(hist[i].stages)) {
      const output = stageOutput(raw);
      if (output == null) continue;
      const key = outputKey(stage, output);
      if (within) { kept.add(key); continue; }
      if (!kept.has(key)) {
        log.push({ id: `Rkeep-${hist[i].id ?? i}-${stage}`, stage: stage as StageId, at: hist[i].archivedAt, reason: `Kept when an older snapshot was folded: ${hist[i].reason}`, output, completedAt: null, generatedBy: null, sourceRefs: citedSourceRefs(output), ...(hist[i].id ? { versionId: hist[i].id } : {}), ...(hist[i].planChangeId ? { planChangeId: hist[i].planChangeId } : {}) });
        kept.add(key);
      }
    }
  }
  if (hist.length > MAX_VERSIONS) x.history = hist.slice(-MAX_VERSIONS);
  if (log.length > MAX_REVISION_LOG) {
    const newest = new Set<string>();
    for (let i = log.length - 1; i >= 0; i--) {
      const key = outputKey(log[i].stage, log[i].output);
      if (i >= log.length - MAX_REVISION_LOG || !newest.has(key)) newest.add(key);
    }
    const folded: StageRevision[] = [];
    const seen = new Set<string>();
    for (let i = log.length - 1; i >= 0 && folded.length < MAX_REVISION_LOG; i--) {
      const key = outputKey(log[i].stage, log[i].output);
      if (seen.has(key) && i < log.length - MAX_REVISION_LOG) continue;
      seen.add(key);
      folded.push(log[i]);
    }
    // If the cap would drop a unique output, keep the log as it is.
    const foldedKeys = new Set(folded.map((r) => outputKey(r.stage, r.output)));
    if ([...kept].every((k) => foldedKeys.has(k) || hist.slice(-MAX_VERSIONS).some((v) => Object.entries(v.stages).some(([s, raw]) => outputKey(s, stageOutput(raw)) === k)))) x.revisionLog = folded.reverse();
  }
}

export function presentVersions(history: DossierVersion[] | undefined) {
  return (history ?? []).map((v) => ({
    id: v.id ?? `round-${v.round}-${v.archivedAt}`,
    round: v.round, archivedAt: v.archivedAt, reason: v.reason, kind: v.kind ?? "reresearch",
    planChangeId: v.planChangeId ?? null, triggerSummary: v.triggerSummary ?? null,
    limitations: v.limitations ?? [], planDecisions: v.planDecisions ?? [], investigations: v.investigations ?? [],
    sourceDigest: v.sourceDigest,
    stages: Object.fromEntries(Object.entries(v.stages).map(([id, raw]) => [id, presentStage(raw)])),
  }));
}
