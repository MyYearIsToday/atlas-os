import test from "node:test";
import assert from "node:assert/strict";
import { DossierEngine } from "./dossier";
import { buildCandidateView, readDossier, summarizeDossier } from "./scout-actions";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

/** A dossier exactly as the pre-merge code (323e133) persisted it: six stages only, no competitor/market/campaign records, images without `rights`. */
const legacy = (status: string) => {
  const st = (s: string) => ({ status: s, taskId: null, attempts: 0, startedAt: null, completedAt: null, lastAttemptAt: null, error: null, output: s === "completed" ? { ok: 1 } : undefined });
  return {
    businessId: "b1", createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", status, manualRetries: 0,
    stages: { research: st("completed"), profile: st("completed"), audit: st("completed"), swot: st("completed"), growth: st("completed"), plan: st("completed") },
    sources: [{ id: "S1", url: "https://a.example", title: "A", snippet: "", query: "q", retrievedAt: "2026-10-16T00:00:00Z", confidence: "checked", decision: "approved", relevance: "match" }],
    limitations: [], followUps: [], sourceApproval: { status: "approved", approvedBy: "op", approvedAt: "2026-10-16T00:00:00Z", approvedCount: 1 },
    images: [{ id: "I1", url: "https://a.example/l.png", pageUrl: "https://a.example", sourceId: "S1", role: "logo", decision: "confirmed" }],
  };
};
const biz = { id: "b1", canonicalName: "Mesa UGBS", category: "education", address: "Legon, Accra", sourceReferences: ["manual"] } as never;

for (const status of ["completed", "active", "awaiting_sources"]) {
  test(`a dossier persisted before the stage-graph change (${status}) is readable by the candidate list, the dossier view and the engine`, async () => {
    const deps = createPipelineDeps({});
    deps.store.businesses.set("b1", biz); deps.store.started.add("b1");
    deps.store.dossiers.set("b1", legacy(status) as never); // what hydrate() puts in the store from PostgreSQL
    const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner: { async run() { return { outcome: "FAILED", reason: "not used" }; } } as never, retryCooldownMs: 0 });
    const d = deps.store.dossiers.get("b1")!;
    assert.equal(Object.keys(d.stages).length, 10, "missing stage records were added");
    assert.equal(d.stages.profile.status, "completed", "existing results are untouched");
    assert.deepEqual(d.stages.profile.output, { ok: 1 });
    assert.equal(d.sources.length, 1); assert.equal(d.images![0].decision, "confirmed"); assert.equal(d.images![0].rights.status, "unknown");
    assert.doesNotThrow(() => summarizeDossier(d, []));
    assert.doesNotThrow(() => readDossier(deps, "b1"));
    const view = buildCandidateView({ discovered: [biz], pipeline: { deps, autonomy: { lifecycle: { prospects: new Map(), approvals: new Map() } } as never } });
    assert.equal(view.length, 1);
    assert.equal(view[0].dossier?.stages.length, 10);
    await engine.tick(); await engine.idle(); // the scheduler path must not throw on legacy state either
    assert.equal(deps.store.dossiers.get("b1")!.stages.profile.status, "completed");
    assert.equal(engine.get("b1")?.status === "completed" || engine.get("b1")?.status === "active" || engine.get("b1")?.status === "awaiting_sources" || engine.get("b1")?.status === "blocked", true);
  });
}
