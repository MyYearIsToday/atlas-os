import test from "node:test";
import assert from "node:assert/strict";
import { createDurablePipelineDeps } from "../../src/orchestrator/atlas-pipeline";
import type { AtlasPersistence, Collection } from "../../src/services/persistence/atlas-persistence";
import { STAGES } from "./dossier";
import { setup, start } from "./dossier.test";
import { DEFAULT_FEEDBACK_LIMITS, FEEDBACK_MARKER, parseWorkerFeedback } from "./worker-feedback";

function memoryPersistence() {
  const rows = new Map<string, { collection: Collection; id: string; doc: unknown }>();
  const persistence = {
    put(collection: Collection, id: string, doc: unknown) { rows.set(collection + ":" + id, { collection, id, doc: JSON.parse(JSON.stringify(doc)) }); },
    remove(collection: Collection, id: string) { rows.delete(collection + ":" + id); },
    async loadAll(collection: Collection) { return [...rows.values()].filter((row) => row.collection === collection).map((row) => ({ id: row.id, doc: JSON.parse(JSON.stringify(row.doc)) })); },
    async loadEvents() { return []; },
    markEvent() {},
  } as unknown as AtlasPersistence;
  return { persistence, rows };
}

const feedback = (extra: Record<string, unknown> = {}) => ({
  type: "finding", title: "A section-specific concern", observation: "This finding is deliberately linked to one dossier section.",
  reasoning: "The section attribution should come from trusted mission metadata.", businessImpact: "This affects the business assessment.",
  affectedStages: [], evidenceRefs: [], basis: "hypothesis", confidence: "medium",
  proposedAction: { kind: "none", detail: "" }, researchQuestions: [], ...extra,
});

test("dossier-created missions carry their explicit target stage", async () => {
  const c = setup({});
  const dossier = await start(c);
  const tasks = c.deps.missionQueue.getSnapshot();
  for (const stage of STAGES) {
    const taskId = dossier.stages[stage.id].taskId;
    if (!taskId) continue;
    const task = tasks.find((candidate) => candidate.taskId === taskId);
    assert.ok(task, "missing mission for " + stage.id);
    assert.equal(task?.targetStage, stage.id);
  }
});

test("mission targetStage survives durable task persistence and hydration", async () => {
  const { persistence, rows } = memoryPersistence();
  const first = await createDurablePipelineDeps(persistence);
  const task = await first.deps.missionQueue.create({
    title: "Research one dossier section", description: "Internal analysis only.", assignedAI: "scout", clientId: "business-1",
    priority: "Medium", approvalRequired: "Auto", dueDate: "2026-10-23", estimatedCost: 0, estimatedTime: "unspecified",
    missionType: "dossier_replan_task", targetStage: "growth",
  });
  assert.equal((rows.get("mission:" + task.taskId)?.doc as { targetStage?: string })?.targetStage, "growth");
  const restored = await createDurablePipelineDeps(persistence);
  assert.equal(restored.deps.missionQueue.getSnapshot().find((candidate) => candidate.taskId === task.taskId)?.targetStage, "growth");
});

test("ordinary mission feedback receives Task.targetStage and preserves attribution precedence", async () => {
  const c = setup({});
  await start(c);
  const result = await c.engine.ingestMissionFeedback({ taskId: "ordinary-target-stage", clientId: "b1", missionType: "custom_task", assignedAI: "scout", targetStage: "growth" },
    "Work product.\n" + FEEDBACK_MARKER + " " + JSON.stringify([feedback()]));
  assert.equal(result.recorded, 1);
  const ingested = c.engine.get("b1")?.feedback?.find((entry) => entry.sourceTaskId === "ordinary-target-stage");
  assert.equal(ingested?.stageId, "growth");
  const ctx = { deriveStage: true, targetStage: "growth", source: { taskId: "task-2", missionType: "market_analysis" }, stageId: "plan" as const, workerId: "scout", refs: new Set<string>(), text: new Map<string, string>(), now: "2026-10-23T00:00:00Z", generation: 0, existing: [], limits: DEFAULT_FEEDBACK_LIMITS, known: new Set(STAGES.map((stage) => stage.id)) };
  const explicit = parseWorkerFeedback([feedback({ affectedStages: ["swot"], targetStage: "campaign" })], ctx);
  assert.equal(explicit.accepted[0].stageId, "swot");
  const fallback = parseWorkerFeedback([feedback({ affectedStages: [], targetStage: "campaign" })], { ...ctx, targetStage: "not-a-stage" });
  assert.equal(fallback.accepted[0].stageId, "campaign");
  const purpose = parseWorkerFeedback([feedback({ affectedStages: [] })], { ...ctx, targetStage: "not-a-stage" });
  assert.equal(purpose.accepted[0].stageId, "market");
});
