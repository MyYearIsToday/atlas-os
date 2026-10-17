import test from "node:test";
import assert from "node:assert/strict";
import { deriveStates } from "./scout-actions";
import { STAGES } from "./dossier";
import { createPipelineDeps, sourceAllowed, PipelineStore } from "../../src/orchestrator/atlas-pipeline";
import { AUTONOMOUS_SAFE_MISSION_TYPES } from "../../src/orchestrator/mission-runner";
import { buildAutonomyState } from "../../src/services/autonomy/controller";
import type { Dossier } from "../../src/orchestrator/dossier-types";

const biz = (id: string) => ({ id, canonicalName: "Test Cafe", category: "catering.cafe", address: "Accra", sourceReferences: ["geoapify"] }) as never;
const row = (over: Record<string, unknown> = {}) => ({ businessId: "b1", opportunity: { scored: false, score: null, scoreWithheld: false, auditAt: null }, lead: [], missions: [], approvals: [], ...over }) as never;
const dossier = (status: Dossier["status"], stages: Partial<Record<string, string>> = {}): Dossier => ({ businessId: "b1", createdAt: "", updatedAt: "", status, manualRetries: 0, sources: [], limitations: [], followUps: [],
  stages: Object.fromEntries(STAGES.map((s) => [s.id, { status: stages[s.id] ?? "pending", taskId: null, attempts: 0, startedAt: null, completedAt: null, lastAttemptAt: null, error: null, generatedBy: null, output: null }])) as never });

test("explicit authorisation bypasses the source filter for that business only", () => {
  const deps = createPipelineDeps({ allowedSources: ["manual"] });
  assert.equal(sourceAllowed(deps, biz("b1")), false);
  deps.authorizedBusinessIds = new Set(["b1"]);
  assert.equal(sourceAllowed(deps, biz("b1")), true);
  assert.equal(sourceAllowed(deps, biz("b2")), false);
});

test("states are truthful: unstarted stays awaiting, evidence vs score withheld, blocked and completed dossiers", () => {
  assert.deepEqual(deriveStates(row(), { inPipeline: false, observationCount: 0 }), ["awaiting_authorization"]);
  const withheld = row({ opportunity: { scored: true, score: null, scoreWithheld: true, auditAt: null } });
  assert.deepEqual(deriveStates(withheld, { inPipeline: true, observationCount: 0 }), ["evidence_insufficient"]);
  assert.deepEqual(deriveStates(withheld, { inPipeline: true, observationCount: 2 }), ["score_withheld"]);
  assert.equal(deriveStates(row(), { inPipeline: true, observationCount: 0, dossier: dossier("active", { research: "completed" }) })[0], "researching");
  assert.equal(deriveStates(row(), { inPipeline: true, observationCount: 0, dossier: dossier("blocked", { profile: "blocked" }) })[0], "blocked");
  assert.equal(deriveStates(row(), { inPipeline: true, observationCount: 0, dossier: dossier("active", { profile: "failed" }) })[0], "failed");
  assert.equal(deriveStates(row(), { inPipeline: true, observationCount: 0, dossier: dossier("completed") })[0], "completed");
  const pendingFollowUp = row({ missions: [{ taskId: "t", status: "Pending", approvalRequired: "Approval Required", missionType: "dossier_followup" }] });
  assert.equal(deriveStates(pendingFollowUp, { inPipeline: true, observationCount: 0, dossier: dossier("completed") }).slice(0, 2).join(), "mission_awaiting_approval,completed");
  assert.equal(deriveStates(row({ lead: [{ prospectId: "p" }] }), { inPipeline: true, observationCount: 0 })[0], "lead_created");
});

test("dossier stage types are on the internal allowlist; follow-up type is not", () => {
  for (const t of ["dossier_profile", "dossier_audit", "dossier_swot", "dossier_growth", "dossier_plan"]) assert.ok(AUTONOMOUS_SAFE_MISSION_TYPES.has(t));
  assert.equal(AUTONOMOUS_SAFE_MISSION_TYPES.has("dossier_followup"), false);
});

test("autonomy only works on started businesses (hydration also loads unstarted Scout records)", () => {
  const store = new PipelineStore();
  store.businesses.set("a", biz("a")); store.businesses.set("b", biz("b"));
  store.started.add("a");
  const lifecycle = { prospects: new Map(), engagements: new Map(), invoices: new Map() } as never;
  const state = buildAutonomyState({ now: new Date().toISOString(), pipeline: store, missions: [], lifecycle, spentTodayUsd: 0 });
  assert.deepEqual(state.businesses.map((b) => b.businessId), ["a"]);
});
