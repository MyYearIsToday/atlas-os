import test from "node:test";
import assert from "node:assert/strict";
import { GOOD, setup, start } from "./dossier.test";
import { assessCompletion, extractProseFeedback, parseWorkerFeedback, DEFAULT_FEEDBACK_LIMITS, FEEDBACK_MARKER } from "./worker-feedback";
import { STAGES } from "./dossier";
import type { WorkerFeedback } from "../../src/orchestrator/dossier-types";

// NOT RUN: written for the worker-autonomy patch, which was delivered without verification.

const CHALLENGE = { type: "challenge", title: "Weakness unsupported by sources", observation: "The audit lists a weakness that no approved source supports at all.", reasoning: "A claim without evidence should not stand in the strategy.", businessImpact: "It could mislead the growth priorities.", affectedStages: ["growth"], confidence: "medium", basis: "hypothesis", proposedAction: { kind: "revise_stage", detail: "recheck the weakness" } };

test("a result that finishes on superseded upstream output is archived, not committed, and the stage reruns", async () => {
  let c!: ReturnType<typeof setup>;
  c = setup({ onRun: (_id, type, n) => { if (type === "dossier_pr" && n === 1) c.engine.get("b1")!.stages.growth.generation = 99; } });
  const x = await start(c);
  assert.equal(x.status, "completed");
  assert.equal(x.stages.pr.discards?.length, 1);
  assert.equal(x.revisionLog?.some((r) => r.stage === "pr" && /stale upstream/.test(r.reason)), true);
  assert.equal(c.calls.filter((t) => t === "dossier_pr").length, 2);
});

test("worker feedback is validated, judged by the planner with a recorded reason, and linked to a handoff", async () => {
  const c = setup({
    reason: async (prompt) => prompt.includes("WORKER FEEDBACK RULES")
      ? JSON.stringify({ decision: "continue", reason: "The feedback cites no evidence, so the plan stays as it is.", keep: [], revise: [], addTasks: [], verdicts: [{ id: "F1", verdict: "reject", reason: "No evidence is cited, so it cannot override the SWOT." }] })
      : JSON.stringify({ verdict: "complete", note: "Every section ran on current output and the one challenge was rejected with a reason.", openQuestions: [] }),
    script: (type) => JSON.stringify(type === "dossier_swot" ? { ...(GOOD.dossier_swot as object), workerFeedback: [CHALLENGE, { type: "finding", title: "x" }] } : GOOD[type]),
  });
  const x = await start(c);
  const f = x.feedback?.[0];
  assert.equal(x.feedback?.length, 1);
  assert.equal(f?.status, "rejected");
  assert.equal(f?.basis, "hypothesis");
  assert.ok(f?.handoffId);
  const h = x.handoffs?.find((o) => o.id === f!.handoffId);
  assert.equal(h?.status, "considered");
  assert.equal(h?.planChangeId, f?.planChangeIds?.[0]);
  assert.equal(x.planLog?.[0].trigger.kind, "worker_feedback");
  assert.ok(["complete", "complete_with_limitations"].includes(x.completion?.state ?? ""));
  assert.equal(x.status, "completed");
});

test("an observed claim without a verifiable quote is downgraded, and unresolved references are dropped", () => {
  const res = parseWorkerFeedback([{ ...CHALLENGE, basis: "observed", quote: "not in any source", evidenceRefs: ["S9"] }], { stageId: "swot", workerId: "w", refs: new Set(["S1"]), text: new Map([["S1", "page"]]), now: "t", generation: 1, existing: [], limits: DEFAULT_FEEDBACK_LIMITS, known: new Set() });
  assert.equal(res.accepted[0].basis, "hypothesis");
  assert.deepEqual(res.accepted[0].evidenceRefs, []);
});

test("a deferred high-impact challenge keeps the dossier from being called complete", () => {
  const c = setup({});
  const d = JSON.parse(JSON.stringify(c.engine.ensure({ id: "b1" } as never)));
  for (const s of STAGES) d.stages[s.id].status = "completed";
  d.feedback = [{ id: "F1", type: "challenge", confidence: "high", status: "deferred", title: "t", resolution: "needs the operator" } as WorkerFeedback];
  assert.equal(assessCompletion(d, STAGES, "t").state, "awaiting_decision");
});

test("feedback in an ordinary mission's prose output is extracted and validated against the mission's own dossier", () => {
  const raw = extractProseFeedback(`Work product text.\n${FEEDBACK_MARKER} ${JSON.stringify([{ type: "needs_evidence", title: "Pricing claim unsupported", observation: "The growth plan assumes a price point that no approved source states.", reasoning: "Pricing drives the offer.", businessImpact: "The offer could be mispriced.", researchQuestions: ["What does the business publicly charge for its main service?"], evidenceRefs: ["S77"], affectedStages: ["growth"] }])}`);
  assert.equal(raw?.length, 1);
  const res = parseWorkerFeedback(raw, { deriveStage: true, source: { taskId: "T1", missionType: "custom" }, stageId: "plan", workerId: "scout", refs: new Set(["S1"]), text: new Map(), now: "t", generation: 1, existing: [], limits: DEFAULT_FEEDBACK_LIMITS, known: new Set() });
  assert.equal(res.accepted[0].stageId, "growth");
  assert.deepEqual(res.accepted[0].evidenceRefs, []);
  assert.equal(res.accepted[0].sourceTaskId, "T1");
});

test("an operator re-evaluation after the pipeline finished runs a real planner pass", async () => {
  let planner = 0;
  const c = setup({
    reason: async (prompt) => {
      if (!prompt.includes("WORKER FEEDBACK RULES")) return JSON.stringify({ verdict: "complete", note: "Everything ran on current output.", openQuestions: [] });
      planner++;
      return JSON.stringify({ decision: "continue", reason: "The feedback is not supported by evidence, so the plan stays.", keep: [], revise: [], addTasks: [], verdicts: [{ id: "F1", verdict: planner === 1 ? "defer" : "reject", reason: planner === 1 ? "Needs the operator to look at it." : "Still unsupported after a second look." }] });
    },
    script: (type) => JSON.stringify(type === "dossier_swot" ? { ...(GOOD.dossier_swot as object), workerFeedback: [CHALLENGE] } : GOOD[type]),
  });
  const x = await start(c);
  assert.equal(x.feedback?.[0].status, "deferred");
  const r = await c.engine.resolveFeedback("b1", "F1", "reevaluate", "please look again");
  assert.equal(r.evaluated, true);
  assert.equal(c.engine.get("b1")!.feedback?.[0].status, "rejected");
  assert.equal(planner, 2);
  assert.equal((c.engine.get("b1")!.feedback?.[0].planChangeIds ?? []).length, 2);
});
