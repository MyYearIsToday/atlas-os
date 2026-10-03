import { newDb } from "pg-mem";
import { PostgresAtlasPersistence, type SqlClient } from "../persistence/atlas-persistence";
import { createInMemoryMissionQueue } from "../mission-queue";
import { AUTONOMOUS_SAFE_MISSION_TYPES } from "../../orchestrator/mission-runner";
import { buildAtlas, stubCollectors } from "../../orchestrator/atlas-test-harness";
import { LifecycleStore } from "./lifecycle-store";
import { ProspectService, LifecycleError, disabledOutreachSender, PROSPECT_TRANSITIONS, type OutreachSender, type ProspectRecord, type ScopeItem } from "./prospects";
import { ARTIFACT_TRANSITIONS, DeliveryService, ENGAGEMENT_TRANSITIONS, type Engagement } from "./delivery";
import { buildAutonomyState, evaluateAutonomy, recordDecisions, type BusinessState, type AutonomyState, type Decision } from "./controller";
import { defaultAutonomyPolicy } from "./policy";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}`); if (!cond) failures++; };
const throwsCode = async (fn: () => unknown, code: string) => { try { await fn(); return false; } catch (e) { return e instanceof LifecycleError && e.code === code; } };

const NOW = "2026-10-10T00:00:00.000Z";
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const H = 3_600_000, D = 24 * H;
const policy = defaultAutonomyPolicy;
const base = (over: Partial<BusinessState> = {}): BusinessState => ({ businessId: "b1", name: "B1", hasWebsite: true, pipelineStarted: true, observationCount: 3, newestObservationAt: ago(D), score: { scorable: true, overall: 55 }, auditId: "audit-1", missions: [], prospect: null, engagement: null, ...over });
const state = (businesses: BusinessState[], spent = 0): AutonomyState => ({ now: NOW, businesses, spentTodayUsd: spent });
const pad = (n: number): BusinessState[] => Array.from({ length: n }, (_, i) => base({ businessId: `pad-${i}`, score: { scorable: false, overall: null } }));
const decide = (b: BusinessState, p = policy) => evaluateAutonomy(state([b, ...pad(p.minActivePipeline)]), p).find((d) => d.businessId === b.businessId)!;
const prospect = (stateName: ProspectRecord["state"], over: Partial<ProspectRecord> = {}): ProspectRecord => ({ prospectId: "prospect:b1", businessId: "b1", state: stateName, history: [], followUps: 0, lastContactAt: null, createdAt: NOW, updatedAt: NOW, ...over });
const mission = (over: Record<string, unknown> = {}) => ({ taskId: "t1", missionType: "outreach_draft", status: "Pending" as const, approvalRequired: "Approval Required" as const, retryCount: 0, lastFailureAt: null, ...over });

// ================= Objective 4: controller =================
{
  check("no evidence yet for a business with a website -> COLLECT_EVIDENCE", decide(base({ observationCount: 0, newestObservationAt: null, score: null, auditId: null })).type === "COLLECT_EVIDENCE");
  check("evidence older than the freshness limit -> COLLECT_EVIDENCE", decide(base({ newestObservationAt: ago(31 * D) })).type === "COLLECT_EVIDENCE");
  check("no score -> ANALYZE_OPPORTUNITY", decide(base({ score: null, auditId: null })).type === "ANALYZE_OPPORTUNITY");
  check("score but no audit -> GENERATE_AUDIT", decide(base({ auditId: null })).type === "GENERATE_AUDIT");
  const withheld = decide(base({ score: { scorable: false, overall: null } }));
  check("withheld score with fresh evidence -> NO_ACTION (no endless re-collection)", withheld.type === "NO_ACTION" && /nothing further/.test(withheld.reason));
  const out = decide(base());
  check("qualified opportunity (score <= threshold) -> CREATE_OUTREACH_MISSION needing HUMAN approval", out.type === "CREATE_OUTREACH_MISSION" && out.approvalRequirement === "HUMAN" && out.proposedMission?.approvalRequired === "Approval Required");
  check("the proposed outreach mission type is NOT on the autonomous allowlist", !AUTONOMOUS_SAFE_MISSION_TYPES.has(out.proposedMission!.missionType));
  check("score above the threshold -> NO_ACTION", decide(base({ score: { scorable: true, overall: 90 } })).type === "NO_ACTION");
  check("an already-open outreach mission prevents duplicate work", decide(base({ missions: [mission()] })).type === "NO_ACTION" && /duplicate/.test(decide(base({ missions: [mission()] })).reason));
  check("the per-business mission cap is enforced", decide(base({ missions: Array.from({ length: policy.maxMissionsPerBusiness }, (_, i) => mission({ taskId: `m${i}`, missionType: "x", status: "Completed" })) })).type === "NO_ACTION");
  check("a mission that exhausted its retries -> WAIT_FOR_HUMAN", decide(base({ missions: [mission({ status: "Failed", retryCount: policy.maxRetries, lastFailureAt: ago(D) })] })).type === "WAIT_FOR_HUMAN");
  check("a recent failure cools down (NO_ACTION); an old one no longer blocks", decide(base({ missions: [mission({ status: "Failed", retryCount: 1, lastFailureAt: ago(H) })] })).type === "NO_ACTION" && decide(base({ missions: [mission({ status: "Failed", retryCount: 1, lastFailureAt: ago(D) })] })).type === "CREATE_OUTREACH_MISSION");

  const p = (s: ProspectRecord["state"], o: Partial<ProspectRecord> = {}) => decide(base({ prospect: prospect(s, o) }));
  check("prospect lifecycle -> decisions: PROSPECT creates outreach, approval states wait for a human", p("PROSPECT").type === "CREATE_OUTREACH_MISSION" && p("APPROVAL_REQUIRED").type === "WAIT_FOR_HUMAN" && p("OUTREACH_PREPARED").approvalRequirement === "HUMAN");
  check("awaiting a reply inside the window waits for the external event; after it, FOLLOW_UP (human-approved)", p("RESPONSE_PENDING", { lastContactAt: ago(H) }).type === "WAIT_FOR_EXTERNAL_EVENT" && p("RESPONSE_PENDING", { lastContactAt: ago(4 * D) }).type === "FOLLOW_UP" && p("RESPONSE_PENDING", { lastContactAt: ago(4 * D) }).approvalRequirement === "HUMAN");
  check("follow-up limit reached -> WAIT_FOR_HUMAN, never an unbounded chase", p("RESPONSE_PENDING", { lastContactAt: ago(9 * D), followUps: policy.maxFollowUps }).type === "WAIT_FOR_HUMAN");
  check("ENGAGED / proposal states wait for a human; WON without engagement -> PREPARE_DELIVERY; LOST/DORMANT -> NO_ACTION", p("ENGAGED").type === "WAIT_FOR_HUMAN" && p("PROPOSAL_APPROVAL").type === "WAIT_FOR_HUMAN" && p("WON").type === "PREPARE_DELIVERY" && p("LOST").type === "NO_ACTION" && p("DORMANT").type === "NO_ACTION");

  const eng = (s: Engagement["state"], o: Partial<Engagement> = {}) => decide(base({ prospect: prospect("WON"), engagement: { engagementId: "engagement:prospect:b1", prospectId: "prospect:b1", businessId: "b1", state: s, scope: [], scopeSource: "human_authored", proposalId: "x", requirements: [], plan: [], artifacts: [], history: [], createdAt: NOW, updatedAt: NOW, completedAt: null, ...o } }));
  const art = (st: string) => ({ artifactId: "a", scopeItemId: "s", title: "t", producedBy: "human" as const, contentRef: "r", isEvidence: false as const, state: st as never, history: [] });
  check("engagement lifecycle -> decisions: onboarding waits for requirements, plan prepares delivery, review waits for a human", eng("ONBOARDING").type === "WAIT_FOR_HUMAN" && eng("DELIVERY_PLAN").type === "PREPARE_DELIVERY" && eng("INTERNAL_REVIEW").type === "WAIT_FOR_HUMAN");
  check("CUSTOMER_DELIVERY -> DELIVER (human); verification waits for the customer, then VERIFY_RESULT once all accepted; COMPLETE -> NO_ACTION", eng("CUSTOMER_DELIVERY").type === "DELIVER" && eng("CUSTOMER_DELIVERY").approvalRequirement === "HUMAN" && eng("RESULT_VERIFICATION", { artifacts: [art("customer_delivered")] }).type === "WAIT_FOR_EXTERNAL_EVENT" && eng("RESULT_VERIFICATION", { artifacts: [art("accepted")] }).type === "VERIFY_RESULT" && eng("COMPLETE").type === "NO_ACTION");

  const small = evaluateAutonomy(state([base()]), policy);
  check("too few active businesses -> DISCOVER_MORE (portfolio-level, no business)", small.some((d) => d.type === "DISCOVER_MORE" && d.businessId === null));
  check("enough active businesses -> no DISCOVER_MORE", !evaluateAutonomy(state([base(), ...pad(policy.minActivePipeline)]), policy).some((d) => d.type === "DISCOVER_MORE"));

  const all = evaluateAutonomy(state([base(), base({ businessId: "b2", prospect: prospect("WON", { businessId: "b2", prospectId: "prospect:b2" }) }), ...pad(3)]), policy);
  const hex = /^[0-9a-f]{64}$/;
  check("every decision is traceable: id, business, reason, rule, state refs, proposed mission, approval, budget impact, timestamps", all.every((d) => hex.test(d.decisionId) && d.reason && d.ruleId && d.stateRefs.length > 0 && d.approvalRequirement && typeof d.budgetImpactUsd === "number" && d.createdAt === NOW && "proposedMission" in d && "expiresAt" in d));
  check("actionable decisions expire; waits and no-ops do not", all.filter((d) => ["CREATE_OUTREACH_MISSION", "PREPARE_DELIVERY"].includes(d.type)).every((d) => d.expiresAt === new Date(Date.parse(NOW) + policy.decisionTtlMs).toISOString()) && all.filter((d) => d.type === "NO_ACTION").every((d) => d.expiresAt === null));
  const before = JSON.stringify(state([base()]));
  const s1 = state([base()]); const run1 = JSON.stringify(evaluateAutonomy(s1, policy)); const run2 = JSON.stringify(evaluateAutonomy(s1, policy));
  check("deterministic: identical state yields identical decisions and IDs; the input is never mutated", run1 === run2 && JSON.stringify(s1) === before);
  const idOf = (b: BusinessState) => evaluateAutonomy(state([b]), policy).find((d) => d.businessId === "b1")!;
  const staleA = idOf(base({ newestObservationAt: ago(31 * D) })), staleA2 = idOf(base({ newestObservationAt: ago(31 * D) })), staleB = idOf(base({ newestObservationAt: ago(40 * D) }));
  check("decision IDs are stable for identical dependent state and change when the evidence they depend on changes", staleA.type === "COLLECT_EVIDENCE" && staleA.decisionId === staleA2.decisionId && staleA.decisionId !== staleB.decisionId);
  check("different lifecycle states of the same prospect yield different decision IDs", idOf(base({ prospect: prospect("APPROVAL_REQUIRED") })).decisionId !== idOf(base({ prospect: prospect("ENGAGED") })).decisionId);
  const tight = { ...policy, dailyAutonomousSpendLimitUsd: 0.04 };
  const gated = evaluateAutonomy(state([base({ prospect: prospect("WON") }), ...pad(tight.minActivePipeline)]), tight).find((d) => d.businessId === "b1")!;
  check("budget gate: autonomous work that would exceed the daily limit becomes an explicit NO_ACTION", gated.type === "NO_ACTION" && gated.ruleId === "R90_BUDGET" && /would be exceeded/.test(gated.reason));
  check("budget already spent counts against the limit", evaluateAutonomy(state([base({ prospect: prospect("WON") }), ...pad(policy.minActivePipeline)], 0.99), policy).find((d) => d.businessId === "b1")!.ruleId === "R90_BUDGET");
  const everything: Decision[] = [];
  for (const s of Object.keys(PROSPECT_TRANSITIONS) as ProspectRecord["state"][]) everything.push(decide(base({ prospect: prospect(s) })));
  check("REQUEST_PAYMENT and RECONCILE_REVENUE are never produced (revenue is a later objective)", !everything.concat(all).some((d) => d.type === "REQUEST_PAYMENT" || d.type === "RECONCILE_REVENUE"));
}

// ================= Objective 5: customer acquisition =================
const clock = () => { let n = 0; return () => new Date(Date.parse(NOW) + ++n * 1000).toISOString(); };
const scope: ScopeItem[] = [{ scopeItemId: "s1", title: "Google profile cleanup", description: "Fix listing details" }, { scopeItemId: "s2", title: "Website fixes", description: "Add meta tags" }];
const fakeSender = (status: "SENT" | "FAILED" = "SENT") => { const calls: string[] = []; const s: OutreachSender = { send: async (m) => { calls.push(m.idempotencyKey); await new Promise((r) => setTimeout(r, 5)); return status === "SENT" ? { status, providerMessageId: "msg-1" } : { status, detail: "smtp down" }; } }; return Object.assign(s, { calls }); };
const draft = { subject: "Improving your Google listing", body: "Hello, we noticed...", generatedBy: "ai:test-model" };
{
  const store = new LifecycleStore();
  const svc = new ProspectService(store, clock(), (id) => (id === "has-contact" ? { channel: "phone", address: "+233200000000", source: "business_record" } : null));
  const pid = svc.create("b1", "system:atlas", "qualified").prospectId;
  check("create is idempotent: one prospect per business", svc.create("b1", "system:atlas", "again") === store.prospects.get(pid) && store.prospects.size === 1);
  let r = svc.prepareOutreach(pid, draft, "system:atlas");
  check("prepared outreach is parked at APPROVAL_REQUIRED with a draft that is never evidence", r.state === "APPROVAL_REQUIRED" && r.outreach!.draft.isEvidence === false && r.outreach!.draft.generatedBy === "ai:test-model" && r.history.map((h) => h.to).join() === "PROSPECT,OUTREACH_PREPARED,APPROVAL_REQUIRED");
  check("re-preparing the same draft is a no-op", svc.prepareOutreach(pid, draft, "system:atlas") === r && r.history.length === 3);
  check("empty drafts are refused", await throwsCode(() => svc.prepareOutreach(svc.create("b9", "s", "r").prospectId, { ...draft, body: " " }, "system:atlas"), "invalid_draft"));
  check("sending before approval is refused", await throwsCode(() => svc.sendApproved(pid, fakeSender()), "not_approved"));
  check("an AI/system actor cannot approve outreach", await throwsCode(() => svc.approveOutreach(pid, "ai:model", { channel: "email", address: "a@b.co" }), "human_required") && await throwsCode(() => svc.approveOutreach(pid, "system:atlas"), "human_required"));
  check("contact details are never invented: no channel on record and none provided -> refused", await throwsCode(() => svc.approveOutreach(pid, "human:ama"), "no_contact_channel"));
  r = svc.approveOutreach(pid, "human:ama", { channel: "email", address: "owner@example.com" });
  check("a human approves the exact draft and supplies the channel (recorded as human_provided)", r.outreach!.approval!.approvedBy === "human:ama" && r.outreach!.approval!.draftHash === r.outreach!.draft.draftHash && r.outreach!.contact!.source === "human_provided");
  const refused = await svc.sendApproved(pid, disabledOutreachSender);
  check("with no integration configured the send is refused, audited, and changes nothing else", refused.attempt!.status === "NOT_CONFIGURED" && refused.prospect.state === "APPROVAL_REQUIRED" && refused.prospect.outreach!.sends.length === 1);
  const failing = fakeSender("FAILED");
  const failed = await svc.sendApproved(pid, failing);
  check("a failed send is recorded and leaves the prospect awaiting approval (retryable)", failed.attempt!.status === "FAILED" && failed.prospect.state === "APPROVAL_REQUIRED" && failed.prospect.outreach!.sends.length === 2);
  const sender = fakeSender();
  const [a, b] = await Promise.all([svc.sendApproved(pid, sender), svc.sendApproved(pid, sender)]);
  check("concurrent sends are idempotent: exactly one external call", sender.calls.length === 1 && [a, b].filter((x) => x.duplicate).length === 1);
  r = svc.get(pid);
  check("an approved, delivered outreach moves to RESPONSE_PENDING with the attempt on record", r.state === "RESPONSE_PENDING" && r.lastContactAt !== null && r.outreach!.sends.filter((s) => s.status === "SENT").length === 1);
  const again = await svc.sendApproved(pid, sender);
  check("replaying the send later is a recorded no-op (no second external message)", again.duplicate && sender.calls.length === 1 && svc.get(pid).outreach!.sends.length === 3);
  check("a changed draft invalidates the approval", await (async () => { const s2 = new LifecycleStore(); const v = new ProspectService(s2, clock()); const id = v.create("b2", "s", "r").prospectId; v.prepareOutreach(id, draft, "system:atlas"); v.approveOutreach(id, "human:ama", { channel: "email", address: "x@y.co" }); const rec = s2.prospects.get(id)!; s2.prospects.set(id, { ...rec, outreach: { ...rec.outreach!, draft: { ...rec.outreach!.draft, draftHash: "tampered" } } }); return throwsCode(() => v.sendApproved(id, fakeSender()), "approval_mismatch"); })());
  check("the business record can supply the contact channel when the approver supplies none", await (async () => { const v = new ProspectService(new LifecycleStore(), clock(), (id) => (id === "has-contact" ? { channel: "phone", address: "+233200000000", source: "business_record" } : null)); const id = v.create("has-contact", "s", "r").prospectId; v.prepareOutreach(id, draft, "system:atlas"); return v.approveOutreach(id, "human:ama").outreach!.contact!.source === "business_record"; })());
  check("invalid transitions are refused (RESPONSE_PENDING cannot jump to WON)", await throwsCode(() => svc.recordProposalDecision(pid, "human:ama", true, "x"), "invalid_transition"));
  const fu = svc.recordFollowUp(pid, "human:ama", "fu-1");
  check("a human-reported follow-up is counted once", svc.recordFollowUp(pid, "human:ama", "fu-1").followUps === 1 && fu.followUps === 1);
  svc.recordResponse(pid, "ENGAGED", "human:ama", "owner replied on WhatsApp");
  check("a reply moves the prospect to ENGAGED", svc.get(pid).state === "ENGAGED");
  const prop = { scope, scopeSource: "customer_requirements", summary: "Two fixes", priceUsd: 300 };
  check("AI-invented proposal scope is refused", await throwsCode(() => svc.prepareProposal(pid, { ...prop, scopeSource: "ai_generated" }, "system:atlas"), "scope_source_rejected"));
  check("empty or duplicate-id scope is refused", await throwsCode(() => svc.prepareProposal(pid, { ...prop, scope: [] }, "system:atlas"), "invalid_scope") && await throwsCode(() => svc.prepareProposal(pid, { ...prop, scope: [scope[0], scope[0]] }, "system:atlas"), "invalid_scope"));
  svc.prepareProposal(pid, prop, "human:ama");
  check("a proposal is prepared (never evidence) but needs human approval to be presented", svc.get(pid).state === "PROPOSAL_PREPARED" && svc.get(pid).proposal!.isEvidence === false && await throwsCode(() => svc.submitProposalForApproval(pid, "ai:model"), "human_required"));
  svc.submitProposalForApproval(pid, "human:ama");
  check("only a human citing the customer's acceptance can mark the prospect WON", await throwsCode(() => svc.recordProposalDecision(pid, "system:atlas", true, "x"), "human_required") && await throwsCode(() => svc.recordProposalDecision(pid, "human:ama", true, " "), "reference_required"));
  const won = svc.recordProposalDecision(pid, "human:ama", true, "signed proposal, email 2026-10-09");
  check("WON records who accepted and the reference; the state is terminal", won.state === "WON" && won.proposal!.acceptedBy === "human:ama" && won.proposal!.acceptanceReference!.includes("signed") && await throwsCode(() => svc.markDormant(pid, "human:ama", "x"), "invalid_transition"));
  const lost = new ProspectService(new LifecycleStore(), clock()); const lid = lost.create("b3", "s", "r").prospectId; lost.markDormant(lid, "human:ama", "no response");
  check("a dormant prospect can only be reopened to PROSPECT", lost.get(lid).state === "DORMANT" && PROSPECT_TRANSITIONS.DORMANT.join() === "PROSPECT");
}

// ================= Objective 6: delivery =================
const wonSetup = async () => {
  const store = new LifecycleStore();
  const queue = createInMemoryMissionQueue();
  const prospects = new ProspectService(store, clock(), () => null);
  const pid = prospects.create("b1", "system:atlas", "qualified").prospectId;
  prospects.prepareOutreach(pid, draft, "system:atlas");
  prospects.approveOutreach(pid, "human:ama", { channel: "email", address: "o@x.co" });
  await prospects.sendApproved(pid, fakeSender());
  prospects.recordResponse(pid, "ENGAGED", "human:ama", "replied");
  prospects.prepareProposal(pid, { scope, scopeSource: "customer_requirements", summary: "s", priceUsd: null }, "human:ama");
  prospects.submitProposalForApproval(pid, "human:ama");
  prospects.recordProposalDecision(pid, "human:ama", true, "signed");
  return { store, queue, prospects, delivery: new DeliveryService(store, prospects, queue, clock()), pid };
};
{
  const { store, queue, prospects, delivery, pid } = await wonSetup();
  const lostSvc = new ProspectService(new LifecycleStore(), clock()); const lid = lostSvc.create("bx", "s", "r").prospectId;
  check("an engagement requires a WON prospect with an accepted proposal", await throwsCode(() => new DeliveryService(new LifecycleStore(), lostSvc, queue).startEngagement(lid, "system:atlas"), "not_won"));
  let e = delivery.startEngagement(pid, "system:atlas");
  check("the engagement starts at CUSTOMER_WON with the accepted scope copied verbatim", e.state === "CUSTOMER_WON" && JSON.stringify(e.scope) === JSON.stringify(scope) && e.scopeSource === "customer_requirements");
  check("starting twice returns the same engagement", delivery.startEngagement(pid, "system:atlas") === store.engagements.get(e.engagementId));
  const eid = e.engagementId;
  delivery.beginOnboarding(eid, "system:atlas");
  check("requirements must come from a human and be non-empty", await throwsCode(() => delivery.recordRequirements(eid, "ai:model", ["x"]), "human_required") && await throwsCode(() => delivery.recordRequirements(eid, "human:ama", [" "]), "requirements_required"));
  e = delivery.recordRequirements(eid, "human:ama", ["Fix opening hours", "Add meta description"]);
  check("the plan is derived 1:1 from the accepted scope (no invented work)", e.state === "DELIVERY_PLAN" && e.plan.length === scope.length && e.plan.every((p, i) => p.scopeItemId === scope[i].scopeItemId && p.missionId === null));
  e = await delivery.createDeliveryMissions(eid);
  const tasks = queue.getSnapshot();
  check("one delivery_work mission per plan item, all requiring human approval and none auto-executable", e.state === "MISSIONS" && tasks.length === 2 && tasks.every((t) => t.missionType === "delivery_work" && t.approvalRequired === "Approval Required" && t.clientId === "b1") && !AUTONOMOUS_SAFE_MISSION_TYPES.has("delivery_work"));
  await delivery.createDeliveryMissions(eid);
  check("re-running mission creation never duplicates missions", queue.getSnapshot().length === 2);
  check("work cannot start while every mission is still Pending", await throwsCode(() => delivery.markWorkStarted(eid, "human:ama"), "work_not_started"));
  await queue.update(tasks[0].taskId, { status: "In Progress" });
  e = delivery.markWorkStarted(eid, "human:ama");
  check("work starts once a delivery mission is underway", e.state === "WORK_IN_PROGRESS");
  check("artifacts must belong to the accepted scope", await throwsCode(() => delivery.addArtifact(eid, { scopeItemId: "invented", title: "x", producedBy: "ai", contentRef: "doc:1" }, "ai:model"), "out_of_scope"));
  delivery.addArtifact(eid, { scopeItemId: "s1", title: "Profile fixes", producedBy: "ai", contentRef: "doc:1" }, "ai:model");
  e = delivery.addArtifact(eid, { scopeItemId: "s1", title: "Profile fixes", producedBy: "ai", contentRef: "doc:1" }, "ai:model");
  check("artifacts start as draft, are never evidence, and identical re-adds are ignored", e.artifacts.length === 1 && e.artifacts[0].state === "draft" && e.artifacts[0].isEvidence === false && e.artifacts[0].producedBy === "ai");
  check("internal review is refused while missions are incomplete", await throwsCode(() => delivery.submitForInternalReview(eid, "human:ama"), "missions_incomplete"));
  for (const t of tasks) await queue.update(t.taskId, { status: "Completed" });
  check("internal review is refused while a scope item has no artifact", await throwsCode(() => delivery.submitForInternalReview(eid, "human:ama"), "scope_uncovered"));
  e = delivery.addArtifact(eid, { scopeItemId: "s2", title: "Website meta tags", producedBy: "human", contentRef: "doc:2" }, "human:ama");
  e = delivery.submitForInternalReview(eid, "human:ama");
  const [a1, a2] = e.artifacts;
  check("INTERNAL_REVIEW reached; approvals are human-only", e.state === "INTERNAL_REVIEW" && await throwsCode(() => delivery.approveArtifactInternally(eid, a1.artifactId, "ai:model"), "human_required"));
  e = delivery.rejectArtifactInternally(eid, a2.artifactId, "human:ama", "meta tags too long");
  check("an internal rejection returns the engagement to WORK_IN_PROGRESS", e.state === "WORK_IN_PROGRESS" && e.artifacts[1].state === "rejected");
  check("review is blocked until rejected artifacts are reworked", await throwsCode(() => delivery.submitForInternalReview(eid, "human:ama"), "rejected_artifacts"));
  e = delivery.reworkArtifact(eid, a2.artifactId, "human:ama");
  e = delivery.submitForInternalReview(eid, "human:ama");
  delivery.approveArtifactInternally(eid, a1.artifactId, "human:ama");
  e = delivery.approveArtifactInternally(eid, a2.artifactId, "human:ama");
  check("when every artifact is internally approved the engagement moves to CUSTOMER_DELIVERY", e.state === "CUSTOMER_DELIVERY" && e.artifacts.every((a) => a.state === "internally_approved"));
  check("artifact and engagement state machines cannot skip steps; accepted/COMPLETE are terminal", !ARTIFACT_TRANSITIONS.draft.includes("customer_delivered" as never) && !ARTIFACT_TRANSITIONS.draft.includes("accepted" as never) && !ARTIFACT_TRANSITIONS.internally_approved.includes("accepted" as never) && ARTIFACT_TRANSITIONS.accepted.length === 0 && ENGAGEMENT_TRANSITIONS.COMPLETE.length === 0 && !ENGAGEMENT_TRANSITIONS.WORK_IN_PROGRESS.includes("CUSTOMER_DELIVERY" as never) && await throwsCode(() => delivery.recordCustomerDecision(eid, a1.artifactId, "human:ama", true, "x"), "invalid_state"));
  check("delivery is a recorded human action with a note", await throwsCode(() => delivery.recordDelivery(eid, a1.artifactId, "ai:model", "sent"), "human_required") && await throwsCode(() => delivery.recordDelivery(eid, a1.artifactId, "human:ama", " "), "note_required"));
  delivery.recordDelivery(eid, a1.artifactId, "human:ama", "emailed PDF");
  e = delivery.recordDelivery(eid, a2.artifactId, "human:ama", "emailed PDF");
  check("all artifacts delivered -> RESULT_VERIFICATION", e.state === "RESULT_VERIFICATION" && e.artifacts.every((a) => a.state === "customer_delivered"));
  e = delivery.recordCustomerDecision(eid, a2.artifactId, "human:ama", false, "customer asked for changes (email)");
  check("a customer rejection sends the engagement back to WORK_IN_PROGRESS", e.state === "WORK_IN_PROGRESS" && e.artifacts[1].state === "rejected");
  delivery.reworkArtifact(eid, a2.artifactId, "human:ama");
  delivery.submitForInternalReview(eid, "human:ama");
  delivery.approveArtifactInternally(eid, a2.artifactId, "human:ama");
  delivery.recordDelivery(eid, a2.artifactId, "human:ama", "emailed v2");
  check("customer acceptance needs a human and a reference", await throwsCode(() => delivery.recordCustomerDecision(eid, a2.artifactId, "human:ama", true, " "), "reference_required"));
  delivery.recordCustomerDecision(eid, a1.artifactId, "human:ama", true, "customer email: approved");
  e = delivery.recordCustomerDecision(eid, a2.artifactId, "human:ama", true, "customer email: approved v2");
  check("COMPLETE only after every artifact is accepted, with a completion time and full history", e.state === "COMPLETE" && e.completedAt !== null && e.artifacts.every((a) => a.state === "accepted") && e.history.map((h) => h.to).includes("RESULT_VERIFICATION"));
  check("the accepted scope never changed during delivery", JSON.stringify(e.scope) === JSON.stringify(scope) && JSON.stringify(prospects.get(pid).proposal!.scope) === JSON.stringify(scope));
  check("a completed engagement is terminal", await throwsCode(() => delivery.beginOnboarding(eid, "x"), "invalid_transition"));
}

// ================= Durability: restart through the real SQL path =================
{
  const adapter = newDb().adapters.createPg();
  const connect = () => new PostgresAtlasPersistence(new adapter.Pool() as unknown as SqlClient);
  const p1 = connect(); await p1.migrate();
  const store1 = new LifecycleStore(p1);
  const queue = createInMemoryMissionQueue();
  const prospects1 = new ProspectService(store1, clock(), () => null);
  const delivery1 = new DeliveryService(store1, prospects1, queue, clock());
  const pid = prospects1.create("b1", "system:atlas", "qualified").prospectId;
  prospects1.prepareOutreach(pid, draft, "system:atlas");
  prospects1.approveOutreach(pid, "human:ama", { channel: "email", address: "o@x.co" });
  const s1 = fakeSender();
  await prospects1.sendApproved(pid, s1);
  prospects1.recordResponse(pid, "ENGAGED", "human:ama", "replied");
  prospects1.prepareProposal(pid, { scope, scopeSource: "customer_requirements", summary: "s", priceUsd: null }, "human:ama");
  prospects1.submitProposalForApproval(pid, "human:ama");
  prospects1.recordProposalDecision(pid, "human:ama", true, "signed");
  const eid = delivery1.startEngagement(pid, "system:atlas").engagementId;
  delivery1.beginOnboarding(eid, "system:atlas");
  const decisions = evaluateAutonomy(state([base({ prospect: prospects1.get(pid), engagement: delivery1.get(eid) }), ...pad(10)]), policy);
  recordDecisions(store1, decisions);
  await p1.flush();

  const p2 = connect(); await p2.migrate();
  const store2 = new LifecycleStore(p2);
  const hydrated = await store2.hydrate();
  check("restart: prospects, engagements and decisions are all restored from PostgreSQL", hydrated.prospects === 1 && hydrated.engagements === 1 && hydrated.decisions === decisions.length);
  check("restart: restored records are identical to what was written", JSON.stringify(store2.prospects.get(pid)) === JSON.stringify(store1.prospects.get(pid)) && JSON.stringify(store2.engagements.get(eid)) === JSON.stringify(store1.engagements.get(eid)));
  const prospects2 = new ProspectService(store2, clock(), () => null);
  const delivery2 = new DeliveryService(store2, prospects2, queue, clock());
  const sender2 = fakeSender();
  const replay = await prospects2.sendApproved(pid, sender2).catch((e) => e);
  check("restart: a replayed approved send does not message the customer again", (replay as { duplicate?: boolean }).duplicate === true && sender2.calls.length === 0);
  check("restart: replaying prospect preparation and engagement start creates nothing new", prospects2.prepareOutreach(pid, draft, "system:atlas") === store2.prospects.get(pid) && delivery2.startEngagement(pid, "system:atlas") === store2.engagements.get(eid) && store2.engagements.size === 1);
  check("restart: the lifecycle continues exactly where it stopped", delivery2.recordRequirements(eid, "human:ama", ["Fix hours"]).state === "DELIVERY_PLAN");
  check("restart: recording the same decisions again adds none (idempotent IDs)", recordDecisions(store2, decisions) === 0);
  await p2.flush();
  check("no persistence write failed", p1.health().ok && p2.health().ok);
}

// ================= Controller on state produced by the REAL pipeline =================
{
  const a = await buildAtlas({ executionEnabled: false, collectors: stubCollectors() });
  const res = await a.submit("Real Pipeline Cafe");
  const businessId = res.ok ? res.outcome.businessId : "";
  const lifecycle = new LifecycleStore();
  const st = buildAutonomyState({ now: NOW, pipeline: a.deps.store, missions: a.deps.missionQueue.getSnapshot(), lifecycle, spentTodayUsd: 0 });
  const bs = st.businesses.find((b) => b.businessId === businessId)!;
  check("buildAutonomyState reads real pipeline state: evidence, numeric score, audit and missions", bs.observationCount > 0 && bs.score?.scorable === true && bs.auditId !== null && bs.missions.length >= 1 && bs.hasWebsite);
  const d = evaluateAutonomy(st, policy).find((x) => x.businessId === businessId)!;
  check("a healthy real business (score above the outreach threshold) -> NO_ACTION with state references", d.type === "NO_ACTION" && d.stateRefs.some((r) => r.startsWith("score:")));
  const eager = evaluateAutonomy(st, { ...policy, maxScoreForOutreach: 95 }).find((x) => x.businessId === businessId)!;
  check("with a higher threshold the same real state yields CREATE_OUTREACH_MISSION needing HUMAN approval", eager.type === "CREATE_OUTREACH_MISSION" && eager.approvalRequirement === "HUMAN");
}

console.log(failures === 0 ? "\nALL AUTONOMY (OBJECTIVES 4-6) TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
