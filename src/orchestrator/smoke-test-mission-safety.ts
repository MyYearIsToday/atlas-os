import { buildAtlas, stubCollectors } from "./atlas-test-harness";
import { AUTONOMOUS_SAFE_MISSION_TYPES } from "./mission-runner";
import { createMissionFromAuditRecommendation } from "../services/mission-adapters";
import { createInMemoryMissionQueue } from "../services/mission-queue";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}`); if (!cond) failures++; };
const rec = (over: Record<string, unknown>) => ({ recommendationId: "r1", action: "Do thing", reason: "because", evidenceRefs: [], confidence: "HIGH", estimatedEffort: "low", approvalLevel: "INTERNAL_REVIEW", status: "OPEN", ...over }) as never;

// --- Adapter rules: approval metadata is never permission ---
{
  const q = createInMemoryMissionQueue();
  const missing = await createMissionFromAuditRecommendation("b1", rec({ approvalLevel: undefined }), q);
  const unknownLevel = await createMissionFromAuditRecommendation("b1", rec({ approvalLevel: "SOMETHING_ELSE" }), q);
  const collect = await createMissionFromAuditRecommendation("b1", rec({ approvalLevel: "AUTO", missionType: "collect_missing_evidence" }), q);
  const summary = await createMissionFromAuditRecommendation("b1", rec({ approvalLevel: "AUTO", missionType: "internal_audit_summary" }), q);
  check("missing or unrecognized approval metadata becomes Approval Required", missing.approvalRequired === "Approval Required" && unknownLevel.approvalRequired === "Approval Required");
  check("collect_missing_evidence can never be auto even if marked AUTO", collect.approvalRequired === "Approval Required" && collect.missionType === "collect_missing_evidence");
  check("internal_audit_summary is explicitly tagged and honors AUTO", summary.approvalRequired === "Auto" && summary.missionType === "internal_audit_summary");
  check("the autonomous allowlist contains exactly internal_audit_summary", AUTONOMOUS_SAFE_MISSION_TYPES.size === 1 && AUTONOMOUS_SAFE_MISSION_TYPES.has("internal_audit_summary"));
}

// --- Execution disabled (production default) ---
{
  const a = await buildAtlas({ executionEnabled: false, collectors: stubCollectors() });
  await a.submit("Safety Disabled Cafe");
  const tasks = a.deps.missionQueue.getSnapshot();
  const auto = tasks.find((t) => t.missionType === "internal_audit_summary");
  check("audit with real evidence yields an Auto internal_audit_summary plus approval-required follow-ups", !!auto && auto.approvalRequired === "Auto" && tasks.some((t) => t.approvalRequired === "Approval Required"));
  check("execution disabled: the eligible mission is NOT executed, no AI call, no ledger entry", auto!.status === "Pending" && a.ai.calls === 0 && a.ledger.list().length === 0 && a.deps.store.trace.some((t) => /mission execution is disabled/.test(t.state)));
  const forced = await a.runner.run(auto!.taskId, { approvedByHuman: true });
  check("even with human approval, a disabled system refuses to execute", forced.outcome === "DISABLED" && a.ai.calls === 0);
}

// --- Execution enabled: only the safe mission starts itself ---
{
  const a = await buildAtlas({ executionEnabled: true, collectors: stubCollectors() });
  const result = await a.submit("Safety Enabled Cafe");
  const businessId = result.ok ? result.outcome.businessId : "";
  const tasks = a.deps.missionQueue.getSnapshot();
  const auto = tasks.find((t) => t.missionType === "internal_audit_summary")!;
  const needsApproval = tasks.filter((t) => t.approvalRequired !== "Auto");
  const log = a.events();
  check("the internal_audit_summary mission auto-executed through the real workforce and completed", auto.status === "Completed" && a.ai.calls === 1 && log.includes("MissionExecutionSucceeded:SUCCESS"));
  check("approval-required missions were NOT auto-executed", needsApproval.length > 0 && needsApproval.every((t) => t.status === "Pending" && t.executionHistory.length === 0));
  check("MissionCompleted was dispatched once and its finance handler succeeded", log.filter((e) => e === "MissionCompleted:SUCCESS").length === 1);
  const ledger = a.ledger.list();
  check("the only ledger entry is the real AI-cost outflow for that actual call", ledger.length === 1 && ledger[0].category === "AI_COST" && ledger[0].direction === "OUTFLOW");
  check("no PaymentRecorded / ledger snapshot was fabricated", !log.some((e) => e.startsWith("PaymentRecorded")));
  const out = a.deps.store.missionOutputs.get(auto.taskId);
  check("AI output is a separate work product with isEvidence=false, and evidence is unchanged", out?.isEvidence === false && /Stub internal summary/.test(out.text) && !JSON.stringify([...(a.deps.store.observations.get(businessId) ?? []), ...(a.deps.store.evidence.get(businessId) ?? [])]).includes("Stub internal summary"));
  const again = await a.runner.run(auto.taskId, {});
  const autoAgain = await a.runner.autoExecute(auto);
  check("duplicate execution is idempotent: no second AI call, ledger entry, or MissionCompleted", !again.executed && again.reason === "already completed" && a.ai.calls === 1 && a.ledger.list().length === 1 && a.events().filter((e) => e === "MissionCompleted:SUCCESS").length === 1 && autoAgain === undefined);

  const pending = needsApproval[0];
  const blocked = await a.runner.run(pending.taskId, {});
  check("approval-required mission stays blocked without explicit approval (no AI call, nothing posted)", !blocked.executed && blocked.outcome === "BLOCKED" && a.ai.calls === 1 && a.ledger.list().length === 1);
  const approved = await a.runner.run(pending.taskId, { approvedByHuman: true });
  check("explicit human approval allows the approval-required mission to execute", approved.executed && a.deps.missionQueue.getSnapshot().find((t) => t.taskId === pending.taskId)?.status === "Completed" && a.ai.calls === 2 && a.ledger.list().length === 2);

  // Unknown / untyped Auto missions must never auto-execute
  for (const [label, missionType] of [["unknown mission type", "send_outreach_email"], ["no mission type", undefined]] as const) {
    const task = await a.deps.missionQueue.create({ title: `Rogue ${label}`, description: "do something external", assignedAI: "builder", clientId: businessId, priority: "Low", approvalRequired: "Auto", dueDate: "2026-12-01", estimatedCost: 0, estimatedTime: "5 min", ...(missionType ? { missionType } : {}) });
    const calls = a.ai.calls;
    await a.runner.autoExecute(task);
    const forced = await a.runner.run(task.taskId, {}, { autonomous: true });
    check(`${label} marked Auto is never auto-executed (allowlist, not denylist)`, a.ai.calls === calls && forced.outcome === "BLOCKED" && a.deps.missionQueue.getSnapshot().find((t) => t.taskId === task.taskId)?.status === "Pending");
  }
}

// --- Failures are visible; transient ones recover inside the existing retry budget; exhausted ones never spend again ---
{
  const ai = { fail: false, calls: 0, failFirst: 2 };
  const a = await buildAtlas({ executionEnabled: true, collectors: stubCollectors(), ai });
  await a.submit("Safety Transient Cafe");
  const task = a.deps.missionQueue.getSnapshot().find((t) => t.missionType === "internal_audit_summary")!;
  const log = a.events();
  check("a transient provider failure is recorded (MissionExecutionFailed) and the mission recovers within its retry budget", log.includes("MissionExecutionFailed:SUCCESS") && task.status === "Completed" && task.retryCount >= 1);
  check("recovery bills only the successful call and completes exactly once", a.ledger.list().length === 1 && log.filter((e) => e === "MissionCompleted:SUCCESS").length === 1);
}
{
  const ai = { fail: true, calls: 0 };
  const a = await buildAtlas({ executionEnabled: true, collectors: stubCollectors(), ai });
  await a.submit("Safety Exhausted Cafe");
  const task = a.deps.missionQueue.getSnapshot().find((t) => t.missionType === "internal_audit_summary")!;
  check("an exhausted failure is visible: Failed status, reason recorded, trace error, no MissionCompleted, nothing billed", task.status === "Failed" && !!task.lastFailureReason && a.deps.store.trace.some((t) => t.stage === "execution" && !!t.error || /errored|FAILED/.test(t.state)) && !a.events().includes("MissionCompleted:SUCCESS") && a.ledger.list().length === 0);
  const callsBefore = ai.calls;
  const again = await a.runner.run(task.taskId, {});
  check("a Failed mission is not silently re-run: the explicit retry path is required and no further AI call is made", !again.executed && again.outcome === "FAILED" && ai.calls === callsBefore);
}

console.log(failures === 0 ? "\nALL MISSION SAFETY TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
