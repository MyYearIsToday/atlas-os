import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessView } from "./business-view";

test("joins one business to its score, lead, missions and approvals by stable ids", () => {
  const view = buildBusinessView({
    businesses: [{ id: "b1", canonicalName: "Test Cafe", category: "catering.cafe" }, { id: "b2", canonicalName: "Other" }],
    scores: new Map([["b1", { overallScore: 72 }], ["b2", { overallScore: null }]]),
    audits: new Map([["b1", { generatedAt: "2026-10-15T00:00:00Z" }]]),
    tasks: [{ taskId: "t1", title: "Research", clientId: "b1", status: "Pending", approvalRequired: "Human" }, { taskId: "t2", title: "Other", clientId: "b2", status: "Completed" }],
    prospects: [{ prospectId: "p1", businessId: "b1", state: "QUALIFIED" }],
    approvals: [{ approvalId: "a1", objectType: "mission", objectId: "t1", outcome: "APPROVED", actor: "human:me", at: "x" }, { approvalId: "a2", objectType: "mission", objectId: "zzz", outcome: "REJECTED", actor: "human:me", at: "x" }],
    outputs: new Map([["t2", {}]]),
  });
  const b1 = view[0]; const b2 = view[1];
  assert.equal(b1.opportunity.score, 72);
  assert.equal(b1.lead[0].prospectId, "p1");
  assert.deepEqual(b1.missions.map((m) => m.taskId), ["t1"]);
  assert.deepEqual(b1.approvals.map((a) => a.approvalId), ["a1"]);
  assert.equal(b2.opportunity.scoreWithheld, true);
  assert.equal(b2.missions[0].hasOutput, true);
  assert.equal(b2.lead.length, 0);
});
