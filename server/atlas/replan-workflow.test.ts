import test from "node:test";
import assert from "node:assert/strict";
import { GOOD, biz, setup, start } from "./dossier.test";
import { readDossier } from "./scout-actions";
import { STAGES } from "./dossier";
import type { StageId } from "../../src/orchestrator/dossier-types";

const REVISE_SWOT = JSON.stringify({ decision: "revise", reason: "New evidence shows the SWOT overstated a weakness that the approved source does not support.", keep: ["profile", "audit", "competitors", "market"], revise: [{ stage: "swot", note: "Replace the weakness that is not supported by the approved sources." }], addTasks: [] });
const ADD_TASK = (title: string) => JSON.stringify({ decision: "add_tasks", reason: "A specialist should check one gap without reopening the finished sections.", keep: ["profile", "swot", "growth"], revise: [], addTasks: [{ title, description: "Write an internal note on the gap using only approved sources. Do not contact anyone.", assignedAI: "builder" }] });
const GARBAGE = "not a plan";
const LONG = "Observed\n\nThe approved source describes Mesa UGBS as a student association.\n\nUnknown\n\nNo membership count was stated.";

function swotText(n: number) {
  if (n === 1) return JSON.stringify(GOOD.dossier_swot);
  const base = GOOD.dossier_swot as { strengths: Array<Record<string, unknown>> };
  return JSON.stringify({ ...base, strengths: [{ ...base.strengths[0], text: "Revised brand position after the new source" }] });
}

test("planner revision archives the previous output and regenerates only dependent stages", async () => {
  const order: string[] = [];
  const c = setup({
    reason: async () => REVISE_SWOT,
    script: (type, n) => {
      order.push(`${type}#${n}`);
      if (type === "dossier_swot") return swotText(n);
      return JSON.stringify(GOOD[type]);
    },
  });
  const before = await start(c);
  const profileTask = before.stages.profile.taskId;
  const auditOut = JSON.stringify(before.stages.audit.output);
  const oldSwot = JSON.stringify(before.stages.swot.output);
  c.deps.store.businesses.get("b1")!.website = "https://example.com";
  const change = await c.engine.replan("b1", { kind: "operator", ids: ["evidence-1"], summary: "A newly read page contradicts the SWOT weakness." });
  assert.ok(change);
  assert.equal(change!.decision, "revise");
  assert.deepEqual(change!.revised, ["swot"]);
  assert.ok(change!.stale.includes("growth") && change!.stale.includes("pr") && change!.stale.includes("campaign") && change!.stale.includes("plan"));
  assert.equal(change!.stale.includes("profile" as StageId), false);
  assert.equal(change!.stale.includes("audit" as StageId), false);
  assert.equal(change!.stale.includes("market" as StageId), false);
  const opened = c.engine.get("b1")!;
  assert.equal(opened.stages.swot.history?.[0].output && JSON.stringify(opened.stages.swot.history[0].output), oldSwot);
  assert.equal(opened.revisionLog?.some((r) => r.stage === "swot" && r.planChangeId === change!.id), true);
  assert.equal(opened.history?.[0].kind, "revision");
  assert.equal(opened.history?.[0].planChangeId, change!.id);
  for (const id of ["profile", "audit", "competitors", "market", "swot", "growth", "pr", "campaign", "plan"] as StageId[]) assert.ok(opened.history?.[0].stages[id], id);
  await c.engine.idle();
  const after = c.engine.get("b1")!;
  assert.equal(after.status, "completed");
  assert.equal(after.stages.profile.taskId, profileTask);
  assert.equal(JSON.stringify(after.stages.audit.output), auditOut);
  assert.match(JSON.stringify(after.stages.swot.output), /Revised brand position/);
  assert.equal(JSON.stringify(after.stages.swot.history?.[0].output), oldSwot);
  const rerun = order.filter((x) => x.endsWith("#2")).map((x) => x.split("#")[0]);
  assert.deepEqual(rerun, ["dossier_swot", "dossier_insights", "dossier_growth", "dossier_pr", "dossier_campaign", "dossier_plan"]);
  assert.equal(rerun.includes("dossier_profile"), false);
  const again = await c.engine.replan("b1", { kind: "operator", ids: ["evidence-1"], summary: "A newly read page contradicts the SWOT weakness." });
  assert.equal(again, change);
  assert.equal(c.engine.get("b1")!.planLog?.length, 1);
  const view = readDossier(c.deps, "b1") as { history: Array<{ stages: Record<string, { output: unknown }> }>; revisionLog: unknown[] };
  assert.equal(view.history[0].stages.pr.output != null, true);
  assert.ok(view.revisionLog.length >= 1);
  const roundTrip = JSON.parse(JSON.stringify(c.deps.store.dossiers.get("b1")));
  assert.equal(roundTrip.history[0].stages.campaign.output != null || roundTrip.history[0].stages.campaign.status === "completed", true);
});

test("a bad planner response and a failed specialist task leave the finished dossier intact", async () => {
  let mode: "bad" | "task" | "dup" = "bad";
  const c = setup({
    reason: async () => (mode === "bad" ? GARBAGE : ADD_TASK("Check the evidence gap")),
    script: (type) => (type === "dossier_replan_task" ? "FAIL" : JSON.stringify(GOOD[type])),
  });
  const done = await start(c);
  const fingerprint = JSON.stringify(done.stages);
  const bad = await c.engine.replan("b1", { kind: "chat", ids: ["H1"], summary: "The operator challenged the growth recommendation." });
  assert.equal(bad?.decision, "continue");
  assert.equal(JSON.stringify(c.engine.get("b1")!.stages), fingerprint);
  mode = "task";
  const added = await c.engine.replan("b1", { kind: "chat", ids: ["H2"], summary: "Look at the gap without rewriting the plan." });
  assert.equal(added?.tasks[0].status, "failed");
  assert.equal(added?.tasks[0].assignedAI, "builder");
  const mission = c.deps.missionQueue.getSnapshot().find((t) => t.taskId === added!.tasks[0].taskId)!;
  assert.equal(mission.missionType, "dossier_replan_task");
  assert.equal(mission.approvalRequired, "Auto");
  assert.equal(JSON.stringify(c.engine.get("b1")!.stages.plan.output), JSON.stringify(done.stages.plan.output));
  mode = "dup";
  const dup = await c.engine.replan("b1", { kind: "operator", ids: ["H3"], summary: "The same gap was asked for again by the operator." });
  assert.equal(dup?.tasks[0].status, "skipped");
  assert.equal(c.deps.missionQueue.getSnapshot().filter((t) => t.missionType === "dossier_replan_task").length, 1);
});

test("specialist success is recorded, and investigation rejects untrusted pages and stops at the budget", async () => {
  let step = 0;
  const c = setup({
    reason: async (prompt) => {
      if (prompt.includes("ONE mission")) return ADD_TASK("Explain the source gap");
      if (step === 0) { step++; return JSON.stringify({ decision: "read", url: "https://evil.example/phish", why: "try a page that is not this business", enough: false }); }
      if (step === 1) { step++; return JSON.stringify({ decision: "search", query: "Mesa UGBS Legon", why: "search for the association by name", enough: false }); }
      return JSON.stringify({ decision: "stop", why: "enough of the association page was read", enough: true, finding: "The page identifies Mesa UGBS as a student association." });
    },
    script: (type) => (type === "dossier_replan_task" ? LONG : JSON.stringify(GOOD[type])),
  });
  await start(c);
  const added = await c.engine.replan("b1", { kind: "operator", ids: ["gap"], summary: "Need a note on the source gap, not a new plan." });
  assert.equal(added?.tasks[0].status, "completed");
  assert.match(added!.tasks[0].result ?? "", /student association/);
  const first = await c.engine.investigate("b1", "What does the public page say Mesa UGBS is?", "operator");
  assert.ok(first);
  assert.equal(first!.retrieved.some((r) => r.url.includes("evil.example") && r.decision === "approved"), false);
  assert.equal(c.engine.get("b1")!.sources.some((s) => s.url.includes("evil.example") && s.decision === "approved"), false);
  assert.equal(first!.retrieved.some((r) => r.url.includes("wine.example") && r.decision === "approved"), false);
  assert.equal(first!.retrieved.some((r) => r.decision === "approved" && r.read), true);
  for (let i = 0; i < 3; i++) assert.ok(await c.engine.investigate("b1", `Follow-up question number ${i} about Mesa UGBS`, "operator"));
  assert.equal(await c.engine.investigate("b1", "This fifth investigation must be refused", "operator"), null);
});

test("a failed revision can resume without losing history, and re-research keeps the full analytical archive", async () => {
  let failSwot = false;
  const c = setup({
    reason: async () => REVISE_SWOT,
    script: (type, n) => {
      if (type === "dossier_swot" && n > 1 && failSwot) return "FAIL";
      if (type === "dossier_swot") return swotText(n);
      return JSON.stringify(GOOD[type]);
    },
  });
  await start(c);
  failSwot = true;
  const change = await c.engine.replan("b1", { kind: "operator", ids: ["retry"], summary: "Revise the SWOT and keep every earlier version." });
  await c.engine.idle();
  const failed = c.engine.get("b1")!;
  assert.equal(failed.stages.swot.status, "failed");
  assert.ok(failed.stages.swot.history?.length);
  const archived = JSON.stringify(failed.history?.[0].stages.growth);
  assert.equal(c.engine.resume("b1").ok, true);
  failSwot = false;
  c.engine.kick("b1");
  await c.engine.idle();
  const recovered = c.engine.get("b1")!;
  assert.equal(recovered.stages.swot.status, "completed");
  assert.equal(JSON.stringify(recovered.history?.[0].stages.growth), archived);
  assert.match(JSON.stringify(recovered.stages.swot.output), /Revised brand position/);
  const fresh = await c.engine.reresearch("b1", "Operator asked for a new research pass.");
  assert.equal(fresh.ok, true);
  const archivedRound = c.engine.get("b1")!;
  assert.equal(archivedRound.researchRound, 1);
  assert.equal(archivedRound.stages.profile.status, "pending");
  const snap = archivedRound.history?.find((h) => h.kind === "reresearch") ?? archivedRound.history?.at(-1);
  for (const id of ["profile", "audit", "competitor_discovery", "competitors", "market", "swot", "insights", "growth", "pr", "campaign", "plan"] as StageId[]) assert.ok(snap?.stages[id], id);
  assert.ok((archivedRound.revisionLog ?? []).some((r) => r.stage === "plan"));
  assert.equal(archivedRound.execution, undefined);
});

test("the PR stage runs after growth and before campaign, and follow-ups stay behind approval", async () => {
  const c = setup();
  const d = await start(c);
  assert.deepEqual(c.calls, ["dossier_profile", "dossier_audit", "dossier_competitors", "dossier_market", "dossier_swot", "dossier_insights", "dossier_growth", "dossier_pr", "dossier_campaign", "dossier_plan"]);
  const pr = STAGES.find((s) => s.id === "pr")!;
  const campaign = STAGES.find((s) => s.id === "campaign")!;
  assert.deepEqual(pr.dependsOn, ["growth"]);
  assert.ok(campaign.softDependsOn?.includes("pr"));
  const prTask = c.deps.missionQueue.getSnapshot().find((t) => t.taskId === d.stages.pr.taskId)!;
  assert.equal(prTask.approvalRequired, "Auto");
  assert.equal(prTask.missionType, "dossier_pr");
  const follow = c.deps.missionQueue.getSnapshot().filter((t) => t.missionType === "dossier_followup");
  assert.ok(follow.length >= 1);
  assert.ok(follow.every((t) => t.approvalRequired === "Approval Required"));
});
