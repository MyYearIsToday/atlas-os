import test from "node:test";
import assert from "node:assert/strict";
import { MissionRunner } from "../../src/orchestrator/mission-runner";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

async function setup(text: string, delayMs = 0, blocked: string | null = null) {
  const deps = createPipelineDeps({});
  const task = await deps.missionQueue.create({ title: "Competitor scan", description: "d", assignedAI: "scout", clientId: "b1", priority: "Medium", approvalRequired: "Approval Required", missionType: "dossier_followup", dueDate: "2026-10-18", estimatedCost: 0, estimatedTime: "u" });
  let calls = 0; let settled = 0;
  const workforce = { async executeMission(taskId: string) {
    calls++;
    await new Promise((r) => setTimeout(r, delayMs));
    const t = await deps.missionQueue.update(taskId, { status: "Completed", completedAt: new Date().toISOString() });
    return { outcome: "COMPLETED" as const, task: t, attempts: 1, lineageId: "l1", result: { failed: false, provider: "nvidia", model: "m", text, usage: { promptTokens: 1, completionTokens: 1 }, estimatedCostUsd: 0 } as never };
  } };
  const runner = new MissionRunner({ workforce: workforce as never, missionQueue: deps.missionQueue, ledger: { list: () => [] } as never, dispatcher: { dispatch: async () => undefined } as never, store: deps.store, executionEnabled: true, blockedBy: () => blocked, afterRun: async () => { settled++; } });
  return { deps, task, runner, calls: () => calls, settled: () => settled };
}
const status = (c: Awaited<ReturnType<typeof setup>>) => c.deps.missionQueue.getSnapshot().find((t) => t.taskId === c.task.taskId)!.status;

test("repeated approvals never start a second execution", async () => {
  const c = await setup("A substantive research output for the operator.", 40);
  const [a, b, d] = await Promise.all([c.runner.run(c.task.taskId, { approvedByHuman: true }), c.runner.run(c.task.taskId, { approvedByHuman: true }), c.runner.run(c.task.taskId, { approvedByHuman: true })]);
  assert.equal(c.calls(), 1);
  assert.deepEqual([a.outcome, b.outcome, d.outcome].sort(), ["COMPLETED", "RUNNING", "RUNNING"]);
});

test("a slow run answers RUNNING promptly, finishes in the background, persists output and flushes", async () => {
  const c = await setup("Detailed competitor comparison with sources.", 60);
  const r = await c.runner.runBounded(c.task.taskId, { approvedByHuman: true }, 10);
  assert.equal(r.outcome, "RUNNING"); assert.equal(r.executed, false);
  assert.equal(c.deps.store.missionOutputs.has(c.task.taskId), false);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(status(c), "Completed");
  assert.match(c.deps.store.missionOutputs.get(c.task.taskId)!.text, /competitor comparison/);
  assert.equal(c.settled(), 1);
  assert.equal(c.calls(), 1);
});

test("an empty provider answer is a failure, never a Completed mission", async () => {
  const c = await setup("   ");
  const r = await c.runner.run(c.task.taskId, { approvedByHuman: true });
  assert.equal(r.outcome, "FAILED"); assert.equal(status(c), "Failed");
  assert.equal(c.deps.store.missionOutputs.has(c.task.taskId), false);
});

test("a mission with an incomplete prerequisite does not execute", async () => {
  const c = await setup("x".repeat(50), 0, "Blocked: approve this business's research sources first");
  const r = await c.runner.run(c.task.taskId, { approvedByHuman: true });
  assert.equal(r.outcome, "BLOCKED"); assert.equal(c.calls(), 0); assert.notEqual(status(c), "Completed");
});
