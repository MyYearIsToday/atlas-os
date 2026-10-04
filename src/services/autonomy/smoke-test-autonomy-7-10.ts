import { newDb } from "pg-mem";
import { PostgresAtlasPersistence, type SqlClient } from "../persistence/atlas-persistence";
import { DurableLedger } from "../../orchestrator/atlas-pipeline";
import { LifecycleStore } from "./lifecycle-store";
import { LifecycleError } from "./prospects";
import { assessInvoiceEligibility, INVOICE_TRANSITIONS } from "./revenue";
import { APPROVAL_OPERATIONS, artifactVersion, missionVersion, outreachVersion, proposalVersion, scopeVersion } from "./approvals";
import { evaluateAutonomy, type BusinessState } from "./controller";
import { defaultAutonomyPolicy } from "./policy";
import { applyMetricPriority, computeMetrics, type MetricInputs } from "./metrics";
import { paginate, readAutonomy, PAGE_MAX, type AutonomyRuntime } from "./observability";
import { AutonomyScheduler, type AutonomyCycle } from "./loop";
import { completeEngagement, draft, makeWorld, okSender, scope, T0, type World } from "./autonomy-test-helpers";
import { DeliveryService } from "./delivery";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}`); if (!cond) failures++; };
const code = async (fn: () => unknown, c: string) => { try { await fn(); return false; } catch (e) { return e instanceof LifecycleError && e.code === c; } };
const policy = defaultAutonomyPolicy;
const dec = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

// ======================= Objective 7: revenue =======================
{
  const w = await makeWorld();
  const noPrice = await completeEngagement(w, "b-noprice", null);
  const e0 = w.delivery.get(noPrice.eid);
  const a0 = assessInvoiceEligibility(e0, w.prospects.get(noPrice.pid));
  check("no accepted price: not eligible and no amount is invented", !a0.eligible && a0.code === "no_accepted_price" && await code(() => w.revenue.createEligible(e0, "system:atlas"), "no_accepted_price") && w.store.invoices.size === 0);
  check("a price with sub-cent precision is not accepted as an amount", !assessInvoiceEligibility(e0, { proposal: { proposalId: "p", priceUsd: 300.123, acceptedBy: "human:x" } }).eligible);
  const w2 = await makeWorld();
  const paid = await completeEngagement(w2, "b1", 300);
  const e = w2.delivery.get(paid.eid);
  check("an engagement that is not COMPLETE is not invoice-eligible", assessInvoiceEligibility({ ...e, state: "WORK_IN_PROGRESS" }, w2.prospects.get(paid.pid)).eligible === false);
  const inv = w2.revenue.createEligible(e, "system:atlas");
  check("eligible invoice takes its amount from the accepted proposal (300.00 USD) and starts at INVOICE_ELIGIBLE", inv.state === "INVOICE_ELIGIBLE" && inv.amount.minorUnits === 30000n && inv.amount.currency === "USD" && inv.proposalId === w2.prospects.get(paid.pid).proposal!.proposalId);
  check("creating the eligible invoice again is idempotent and posts nothing to the ledger", w2.revenue.createEligible(e, "system:atlas") === w2.store.invoices.get(inv.invoiceId) && w2.ledger.list().length === 0);
  check("the six operational states form a strict forward chain", Object.keys(INVOICE_TRANSITIONS).join() === "INVOICE_ELIGIBLE,PREPARED,SENT,PAYMENT_PENDING,PAYMENT_RECORDED,PAYMENT_RECONCILED" && Object.values(INVOICE_TRANSITIONS).every((n) => n.length <= 1));
  check("only a human can prepare, send, record a payment or reconcile", await code(() => w2.revenue.prepare(inv.invoiceId, "system:atlas"), "human_required") && await code(() => w2.revenue.markSent(inv.invoiceId, "ai:model", "x"), "human_required") && await code(() => w2.revenue.recordPayment(inv.invoiceId, { amountMinorUnits: "30000", currency: "USD", reference: "r", receivedAt: T0 }, "system:atlas"), "human_required") && await code(() => w2.revenue.reconcilePayment(inv.invoiceId, "x", { externalAmountMinorUnits: "1", externalReference: "r" }, "ai:model"), "human_required"));
  check("a payment cannot be recorded before the invoice has been sent", await code(() => w2.revenue.recordPayment(inv.invoiceId, { amountMinorUnits: "30000", currency: "USD", reference: "r1", receivedAt: T0 }, "human:ama"), "invalid_transition"));
  w2.revenue.prepare(inv.invoiceId, "human:ama");
  const sent = w2.revenue.markSent(inv.invoiceId, "human:ama", "emailed PDF");
  check("sending records SENT then PAYMENT_PENDING in history", sent.state === "PAYMENT_PENDING" && sent.history.map((h) => h.to).join() === "INVOICE_ELIGIBLE,PREPARED,SENT,PAYMENT_PENDING");
  let s = w2.revenue.summary();
  check("prepared / sent / pending invoices are NOT revenue: received revenue is empty and the ledger is untouched", Object.keys(s.receivedRevenue).length === 0 && s.paymentCount === 0 && w2.ledger.list().length === 0 && s.notRevenue.PAYMENT_PENDING.count === 1 && s.notRevenue.PAYMENT_PENDING.amount.USD === "300.00");
  const pay = (over: Record<string, unknown> = {}) => ({ amountMinorUnits: "30000", currency: "USD", reference: "bank-ref-1", receivedAt: "2026-10-09T10:00:00.000Z", ...over }) as any;
  check("invalid payments are refused: zero/negative/non-integer amount, wrong currency (no conversion), missing reference, future date", await code(() => w2.revenue.recordPayment(inv.invoiceId, pay({ amountMinorUnits: "0" }), "human:ama"), "invalid_amount") && await code(() => w2.revenue.recordPayment(inv.invoiceId, pay({ amountMinorUnits: "12.5" }), "human:ama"), "invalid_amount") && await code(() => w2.revenue.recordPayment(inv.invoiceId, pay({ currency: "EUR" }), "human:ama"), "currency_mismatch") && await code(() => w2.revenue.recordPayment(inv.invoiceId, pay({ reference: " " }), "human:ama"), "reference_required") && await code(() => w2.revenue.recordPayment(inv.invoiceId, pay({ receivedAt: "2099-01-01T00:00:00Z" }), "human:ama"), "invalid_received_at") && w2.ledger.list().length === 0);
  const r1 = w2.revenue.recordPayment(inv.invoiceId, pay(), "human:ama");
  const txn = w2.ledger.list()[0];
  check("a recorded payment posts exactly one REVENUE inflow to the existing ledger and moves the invoice to PAYMENT_RECORDED", !r1.duplicate && w2.ledger.list().length === 1 && txn.transactionType === "REVENUE" && txn.direction === "INFLOW" && txn.status === "POSTED" && txn.amount.minorUnits === 30000n && txn.transactionId === r1.payment.transactionId && r1.invoice.state === "PAYMENT_RECORDED");
  check("invoice lifecycle state is separate from the ledger transaction status", r1.invoice.state === "PAYMENT_RECORDED" && txn.status === "POSTED" && !("state" in txn));
  check("the payment carries amount, currency, reference, received time, human actor and client/engagement/invoice IDs", r1.payment.reference === "bank-ref-1" && r1.payment.receivedAt === "2026-10-09T10:00:00.000Z" && r1.payment.recordedBy === "human:ama" && r1.payment.invoiceId === inv.invoiceId && r1.payment.engagementId === paid.eid && r1.payment.businessId === "b1" && txn.clientId === "b1");
  const replay = w2.revenue.recordPayment(inv.invoiceId, pay(), "human:ama");
  check("recording the same payment again is idempotent: no second ledger entry", replay.duplicate && w2.ledger.list().length === 1 && w2.revenue.get(inv.invoiceId).payments.length === 1);
  s = w2.revenue.summary();
  check("revenue is the sum of recorded payments only", s.receivedRevenue.USD === "300.00" && s.paymentCount === 1);
  check("reconciliation requires an external reference and a ledger-backed payment", await code(() => w2.revenue.reconcilePayment(inv.invoiceId, r1.payment.paymentId, { externalAmountMinorUnits: "30000", externalReference: " " }, "human:ama"), "reference_required") && await code(() => w2.revenue.reconcilePayment(inv.invoiceId, "payment:nope", { externalAmountMinorUnits: "30000", externalReference: "stmt" }, "human:ama"), "not_found") && await code(() => new (w2.revenue.constructor as any)(w2.store, w2.prospects, new DurableLedger(), w2.clock.now).reconcilePayment(inv.invoiceId, r1.payment.paymentId, { externalAmountMinorUnits: "30000", externalReference: "stmt" }, "human:ama"), "unsupported_payment"));
  const wrong = w2.revenue.reconcilePayment(inv.invoiceId, r1.payment.paymentId, { externalAmountMinorUnits: "25000", externalReference: "stmt-1" }, "human:ama");
  check("an external amount that does not match is NOT reconciled (existing reconcile() says PARTIAL) and the invoice stays PAYMENT_RECORDED", wrong.payments[0].reconciliation?.status === "PARTIAL" && wrong.state === "PAYMENT_RECORDED");
  const w3 = await makeWorld();
  const c3 = await completeEngagement(w3, "b3", 300);
  const i3 = w3.revenue.createEligible(w3.delivery.get(c3.eid), "system:atlas");
  w3.revenue.prepare(i3.invoiceId, "human:ama"); w3.revenue.markSent(i3.invoiceId, "human:ama", "emailed");
  const partial = w3.revenue.recordPayment(i3.invoiceId, pay({ amountMinorUnits: "10000", reference: "p1" }), "human:ama");
  const matchedPartial = w3.revenue.reconcilePayment(i3.invoiceId, partial.payment.paymentId, { externalAmountMinorUnits: "10000", externalReference: "stmt-p1" }, "human:ama");
  check("a partial payment is recorded as the real amount received and does not reconcile the whole invoice", w3.revenue.summary().receivedRevenue.USD === "100.00" && matchedPartial.state === "PAYMENT_RECORDED" && matchedPartial.payments[0].reconciliation?.status === "MATCHED");
  const second = w3.revenue.recordPayment(i3.invoiceId, pay({ amountMinorUnits: "20000", reference: "p2" }), "human:ama");
  const done = w3.revenue.reconcilePayment(i3.invoiceId, second.payment.paymentId, { externalAmountMinorUnits: "20000", externalReference: "stmt-p2" }, "human:ama");
  check("matched payments covering the invoice move it to PAYMENT_RECONCILED; repeating is a no-op", done.state === "PAYMENT_RECONCILED" && w3.revenue.reconcilePayment(i3.invoiceId, second.payment.paymentId, { externalAmountMinorUnits: "20000", externalReference: "stmt-p2" }, "human:ama") === w3.store.invoices.get(i3.invoiceId) && w3.ledger.list().length === 2 && w3.revenue.summary().receivedRevenue.USD === "300.00");

  // controller: revenue decisions (only when revenue state is tracked)
  const bs = (inv: string | null, eligible: boolean, reason: string | null): BusinessState => ({ businessId: "b1", name: "B1", hasWebsite: true, pipelineStarted: true, observationCount: 1, newestObservationAt: T0, score: { scorable: true, overall: 50 }, auditId: "a", missions: [], prospect: null, engagement: { ...e, state: "COMPLETE" }, revenue: { invoiceState: inv as never, eligible, reason } });
  const pad = Array.from({ length: policy.minActivePipeline }, (_, i) => ({ ...bs(null, true, null), businessId: `pad${i}`, engagement: null, revenue: undefined, score: { scorable: false, overall: null } }));
  const decide = (b: BusinessState) => evaluateAutonomy({ now: T0, businesses: [b, ...pad], spentTodayUsd: 0 }, policy).find((d) => d.businessId === "b1")!;
  const d0 = decide(bs(null, true, null));
  check("COMPLETE engagement with an accepted price and no invoice -> REQUEST_PAYMENT (internal eligibility, no approval needed)", d0.type === "REQUEST_PAYMENT" && d0.approvalRequirement === "NONE");
  const dn = decide(bs(null, false, "the accepted proposal has no usable price; a human must settle pricing (Atlas will not invent an amount)"));
  check("COMPLETE without a usable price -> WAIT_FOR_HUMAN (pricing is never changed or invented)", dn.type === "WAIT_FOR_HUMAN" && /invent/.test(dn.reason));
  check("invoice states map to human/external waits; PAYMENT_RECORDED -> RECONCILE_REVENUE (human); RECONCILED -> NO_ACTION", decide(bs("INVOICE_ELIGIBLE", true, null)).type === "WAIT_FOR_HUMAN" && decide(bs("PREPARED", true, null)).type === "WAIT_FOR_HUMAN" && decide(bs("PAYMENT_PENDING", true, null)).type === "WAIT_FOR_EXTERNAL_EVENT" && decide(bs("PAYMENT_RECORDED", true, null)).type === "RECONCILE_REVENUE" && decide(bs("PAYMENT_RECORDED", true, null)).approvalRequirement === "HUMAN" && decide(bs("PAYMENT_RECONCILED", true, null)).type === "NO_ACTION");
  check("without revenue tracking the Objective 4 behavior is unchanged (COMPLETE -> NO_ACTION)", decide({ ...bs(null, true, null), revenue: undefined }).type === "NO_ACTION");
}

// ======================= Objective 8: typed approvals =======================
{
  const w = await makeWorld({ resolveContact: () => null });
  const pid = w.prospects.create("b1", "system:atlas", "q").prospectId;
  const task = await w.queue.create({ title: "Outreach — B1", description: "d", assignedAI: "builder", clientId: "b1", priority: "Medium", approvalRequired: "Approval Required", dueDate: "2026-12-01", estimatedCost: 0, estimatedTime: "x", missionType: "outreach_draft" });
  const v = missionVersion(task);
  check("approvals are an explicit whitelist; there is no generic approve-anything operation", !APPROVAL_OPERATIONS.includes("approve" as never) && await code(() => w.approvals.handle("approve-anything", {}), "unknown_operation") && await code(() => w.approvals.handle("mission", "x" as never), "invalid_input"));
  check("a named human is required; AI/system actors are refused", await code(() => w.approvals.handle("mission", { taskId: task.taskId, actor: "ai:model", version: v }), "human_required") && await code(() => w.approvals.handle("mission", { taskId: task.taskId, actor: "system:atlas", version: v }), "human_required") && w.runs.length === 0);
  check("a stale object version is refused (the approval references the exact version)", await code(() => w.approvals.handle("mission", { taskId: task.taskId, actor: "human:ama", version: "0".repeat(64) }), "stale_version") && w.runs.length === 0);
  const ok = await w.approvals.handle("mission", { taskId: task.taskId, actor: "human:ama", version: v }) as any;
  check("approving the exact mission version runs it once through the existing runner and records the approval", ok.result.executed && w.runs.length === 1 && [...w.store.approvals.values()].some((a) => a.operation === "mission" && a.actor === "human:ama" && a.objectVersion === v && a.outcome === "APPROVED"));
  const again = await w.approvals.handle("mission", { taskId: task.taskId, actor: "human:ama", version: v }) as any;
  check("approving again is idempotent: no second execution", again.idempotent === true && w.runs.length === 1);
  const blockedWorld = await makeWorld();
  const t2 = await blockedWorld.queue.create({ title: "x", description: "y", assignedAI: "builder", clientId: "b", priority: "Low", approvalRequired: "Approval Required", dueDate: "2026-12-01", estimatedCost: 0, estimatedTime: "x" });
  const blocked = new (blockedWorld.approvals.constructor as any)({ ...blockedWorld.approvalDeps, runMission: async () => ({ executed: false, outcome: "BLOCKED", reason: "hard safety rule" }) });
  const br = await blocked.handle("mission", { taskId: t2.taskId, actor: "human:ama", version: missionVersion(t2) });
  check("an approval cannot override a hard safety rule: a refused run is returned as such and no approval is recorded", br.result.executed === false && br.result.outcome === "BLOCKED" && blockedWorld.store.approvals.size === 0);

  // outreach attach-draft -> approve -> send (disabled)
  await w.queue.update(task.taskId, { status: "Completed" });
  const done = w.queue.getSnapshot().find((t) => t.taskId === task.taskId)!;
  w.missionOutputs.set(task.taskId, { generatedBy: "stub-model", text: "Subject: Your Google listing\nHello owner, we noticed your hours are missing.", isEvidence: false });
  const dv = (await import("node:crypto")).createHash("sha256").update(JSON.stringify([missionVersion(done), "Subject: Your Google listing\nHello owner, we noticed your hours are missing."])).digest("hex");
  check("attaching a mission output as the outreach draft needs the exact output version", await code(() => w.approvals.handle("outreach-draft", { prospectId: pid, taskId: task.taskId, actor: "human:ama", version: "bad" }), "stale_version"));
  await w.approvals.handle("outreach-draft", { prospectId: pid, taskId: task.taskId, actor: "human:ama", version: dv });
  const p = w.prospects.get(pid);
  check("the AI draft is attached (never evidence) and parked at APPROVAL_REQUIRED", p.state === "APPROVAL_REQUIRED" && p.outreach!.draft.subject === "Your Google listing" && p.outreach!.draft.isEvidence === false && p.outreach!.draft.generatedBy === "ai:stub-model");
  const dh = outreachVersion(p)!;
  check("outreach approval needs the current draft hash and a human; a missing contact channel is refused", await code(() => w.approvals.handle("outreach", { prospectId: pid, actor: "human:ama", draftHash: "stale" }), "stale_version") && await code(() => w.approvals.handle("outreach", { prospectId: pid, actor: "ai:x", draftHash: dh }), "human_required") && await code(() => w.approvals.handle("outreach", { prospectId: pid, actor: "human:ama", draftHash: dh }), "no_contact_channel"));
  await w.approvals.handle("outreach", { prospectId: pid, actor: "human:ama", draftHash: dh, contact: { channel: "email", address: "owner@example.com" } });
  const n = w.store.approvals.size;
  const rep = await w.approvals.handle("outreach", { prospectId: pid, actor: "human:ama", draftHash: dh, contact: { channel: "email", address: "owner@example.com" } }) as any;
  check("repeating the same outreach approval is idempotent (no new record)", rep.idempotent === true && w.store.approvals.size === n);
  const sendRes = await w.approvals.handle("outreach-send", { prospectId: pid, actor: "human:ama", draftHash: dh }) as any;
  check("with no outreach integration the send is recorded as NOT_CONFIGURED and nothing is sent", sendRes.result.attempt.status === "NOT_CONFIGURED" && w.prospects.get(pid).state === "APPROVAL_REQUIRED");

  // proposal: version covers scope/price; a change invalidates the earlier approval
  const w4 = await makeWorld();
  const p4 = w4.prospects.create("b4", "system:atlas", "q").prospectId;
  w4.prospects.prepareOutreach(p4, draft, "system:atlas"); w4.prospects.approveOutreach(p4, "human:ama", { channel: "email", address: "a@b.co" });
  await w4.prospects.sendApproved(p4, okSender()); w4.prospects.recordResponse(p4, "ENGAGED", "human:ama", "replied");
  w4.prospects.prepareProposal(p4, { scope, scopeSource: "customer_requirements", summary: "s", priceUsd: 300 }, "human:ama");
  const pv = proposalVersion(w4.prospects.get(p4));
  const rec4 = w4.store.prospects.get(p4)!;
  w4.store.prospects.set(p4, { ...rec4, proposal: { ...rec4.proposal!, priceUsd: 900 } }); // the underlying proposal changes after review
  check("changing the proposal after review invalidates the earlier approval", proposalVersion(w4.prospects.get(p4)) !== pv && await code(() => w4.approvals.handle("proposal", { prospectId: p4, actor: "human:ama", version: pv }), "stale_version"));
  w4.store.prospects.set(p4, rec4);
  await w4.approvals.handle("proposal", { prospectId: p4, actor: "human:ama", version: pv });
  const pd = await w4.approvals.handle("proposal-decision", { prospectId: p4, actor: "human:ama", version: pv, accepted: true, reference: "signed" }) as any;
  check("proposal decision: human + reference + current version -> WON", pd.result.state === "WON" && await code(() => w4.approvals.handle("proposal-decision", { prospectId: p4, actor: "human:ama", version: pv, accepted: "yes", reference: "x" }), "invalid_input"));

  // delivery gates through typed operations
  const eid = w4.delivery.startEngagement(p4, "system:atlas").engagementId;
  w4.delivery.beginOnboarding(eid, "system:atlas");
  check("requirements need the scope version and a human", await code(() => w4.approvals.handle("requirements", { engagementId: eid, actor: "human:ama", scopeVersion: "bad", requirements: ["x"] }), "stale_version") && await code(() => w4.approvals.handle("requirements", { engagementId: eid, actor: "ai:x", scopeVersion: scopeVersion(w4.delivery.get(eid)), requirements: ["x"] }), "human_required"));
  await w4.approvals.handle("requirements", { engagementId: eid, actor: "human:ama", scopeVersion: scopeVersion(w4.delivery.get(eid)), requirements: ["fix hours"] });
  await w4.delivery.createDeliveryMissions(eid);
  const ts = w4.queue.getSnapshot();
  await w4.queue.update(ts[0].taskId, { status: "In Progress" }); w4.delivery.markWorkStarted(eid, "human:ama");
  for (const t of ts) await w4.queue.update(t.taskId, { status: "Completed" });
  for (const s of scope) w4.delivery.addArtifact(eid, { scopeItemId: s.scopeItemId, title: `A-${s.scopeItemId}`, producedBy: "ai", contentRef: `doc:${s.scopeItemId}` }, "ai:m");
  w4.delivery.submitForInternalReview(eid, "human:ama");
  const [a1, a2] = w4.delivery.get(eid).artifacts;
  check("artifact review needs the artifact version; approve and reject are typed decisions", await code(() => w4.approvals.handle("artifact", { engagementId: eid, artifactId: a1.artifactId, actor: "human:ama", artifactVersion: "bad", decision: "approve" }), "stale_version") && await code(() => w4.approvals.handle("artifact", { engagementId: eid, artifactId: a1.artifactId, actor: "human:ama", artifactVersion: artifactVersion(a1), decision: "reject" }), "invalid_input"));
  const rej = await w4.approvals.handle("artifact", { engagementId: eid, artifactId: a2.artifactId, actor: "human:ama", artifactVersion: artifactVersion(a2), decision: "reject", reason: "too long" }) as any;
  check("rejecting an artifact is recorded as a REJECTED approval and returns the engagement to work", rej.result.engagementState === "WORK_IN_PROGRESS" && [...w4.store.approvals.values()].some((a) => a.outcome === "REJECTED" && a.objectId === a2.artifactId));

  // revenue operations through approvals
  const w5 = await makeWorld();
  const c5 = await completeEngagement(w5, "b5", 300);
  const i5 = w5.revenue.createEligible(w5.delivery.get(c5.eid), "system:atlas");
  const ver = (await import("./revenue")).invoiceVersion;
  await w5.approvals.handle("invoice-prepare", { invoiceId: i5.invoiceId, actor: "human:ama", version: ver(w5.revenue.get(i5.invoiceId)) });
  check("a stale invoice version is refused", await code(() => w5.approvals.handle("invoice-sent", { invoiceId: i5.invoiceId, actor: "human:ama", version: ver(i5), reference: "email" }), "stale_version"));
  await w5.approvals.handle("invoice-sent", { invoiceId: i5.invoiceId, actor: "human:ama", version: ver(w5.revenue.get(i5.invoiceId)), reference: "email" });
  const payBody = { invoiceId: i5.invoiceId, actor: "human:ama", amountMinorUnits: "30000", currency: "USD", reference: "bank-9", receivedAt: "2026-10-09T09:00:00.000Z" };
  const p1 = await w5.approvals.handle("payment", payBody) as any;
  const p2 = await w5.approvals.handle("payment", payBody) as any;
  check("a payment through the approval API posts once; the replay is idempotent", p1.result.paymentId === p2.result.paymentId && p2.idempotent === true && w5.ledger.list().length === 1 && w5.revenue.summary().receivedRevenue.USD === "300.00");
  check("payment inputs are validated (amount must be integer minor units)", await code(() => w5.approvals.handle("payment", { ...payBody, amountMinorUnits: "300.00" }), "invalid_amount"));
  const rc = await w5.approvals.handle("payment-reconcile", { invoiceId: i5.invoiceId, paymentId: p1.result.paymentId, actor: "human:ama", externalAmountMinorUnits: "30000", externalReference: "stmt-9" }) as any;
  check("reconciliation through the approval API ends at PAYMENT_RECONCILED", rc.result.state === "PAYMENT_RECONCILED" && rc.result.reconciliation === "MATCHED");
}

// ======================= Objective 9: metrics =======================
{
  const W = "2026-10-10T12:00:00.000Z";
  const hr = (h: number) => new Date(Date.parse(W) - h * 3_600_000).toISOString();
  const hist = (...pairs: Array<[string, string]>) => pairs.map(([to, at], i) => ({ from: null, to, at, actor: "x", reason: "", idempotencyKey: `${i}${to}` })) as any;
  const mkP = (id: string, state: string, history: any[], sends: any[] = []): any => ({ prospectId: `prospect:${id}`, businessId: id, state, history, followUps: 0, lastContactAt: null, createdAt: hr(100), updatedAt: hr(1), outreach: sends.length ? { draft: {}, sends } : undefined });
  const art = (state: string, deliveredHoursAgo?: number): any => ({ artifactId: `a${Math.random()}`, state, history: deliveredHoursAgo === undefined ? [] : [{ from: null, to: "customer_delivered", at: hr(deliveredHoursAgo) }] });
  const eng = (id: string, state: string, createdH: number, completedH: number | null, artifacts: any[] = []): any => ({ engagementId: `e${id}`, businessId: id, state, createdAt: hr(createdH), completedAt: completedH === null ? null : hr(completedH), history: [{ at: hr(createdH) }], artifacts });
  const run = (outcome: string, startedH: number): any => ({ outcome, startedAt: hr(startedH) });
  const usd = (n: bigint) => ({ minorUnits: n, currency: "USD", scale: 2 });
  const inputs: MetricInputs = {
    prospects: [
      mkP("p1", "WON", hist(["PROPOSAL_APPROVAL", hr(10)], ["ENGAGED", hr(20)]), [{ status: "SENT", at: hr(30) }]),
      mkP("p2", "LOST", hist(["PROPOSAL_APPROVAL", hr(5)]), [{ status: "SENT", at: hr(8) }]),
      mkP("p3", "RESPONSE_PENDING", hist([ "OUTREACH_SENT", hr(2)]), [{ status: "SENT", at: hr(2) }, { status: "FAILED", at: hr(1) }]),
      mkP("old", "WON", hist(["PROPOSAL_APPROVAL", hr(24 * 40)], ["ENGAGED", hr(24 * 41)]), [{ status: "SENT", at: hr(24 * 41) }]),
    ],
    engagements: [eng("p1", "COMPLETE", 9, 1, [art("accepted", 4), art("rejected", 3)]), eng("p2", "WORK_IN_PROGRESS", 4, null, [art("customer_delivered", 2)])],
    invoices: [
      { invoiceId: "i1", state: "PAYMENT_RECORDED", amount: usd(30000n), payments: [{ amount: usd(30000n), receivedAt: hr(3) }] },
      { invoiceId: "i2", state: "SENT", amount: usd(99900n), payments: [] },
      { invoiceId: "i3", state: "PAYMENT_RECONCILED", amount: usd(5000n), payments: [{ amount: usd(5000n), receivedAt: hr(24 * 10) }] },
    ] as any,
    tasks: [
      { taskId: "t1", status: "Completed", executionHistory: [run("SUCCEEDED", 2)] }, { taskId: "t2", status: "Failed", executionHistory: [run("FAILED", 3), run("FAILED", 2.5)] }, { taskId: "t3", status: "Pending", executionHistory: [] }, { taskId: "t4", status: "Completed", executionHistory: [run("BLOCKED", 1), run("SUCCEEDED", 1)] },
    ] as any,
    ledger: [{ category: "AI_COST", direction: "OUTFLOW", recordedAt: hr(1), amount: usd(250n) }, { category: "AI_COST", direction: "OUTFLOW", recordedAt: hr(24 * 8), amount: usd(750n) }, { category: "CLIENT_PAYMENT", direction: "INFLOW", recordedAt: hr(1), amount: usd(30000n) }] as any,
    approvals: [{ at: hr(1), outcome: "APPROVED" }, { at: hr(2), outcome: "APPROVED" }, { at: hr(3), outcome: "REJECTED" }, { at: hr(24 * 9), outcome: "APPROVED" }] as any,
    businesses: [{ id: "b1", website: "https://a.example", createdAt: hr(5) }, { id: "b2", website: "https://b.example", createdAt: hr(6) }, { id: "b3", createdAt: hr(7) }, { id: "b4", website: "https://d.example", createdAt: hr(24 * 40) }],
    observations: new Map([["b1", [{ field: "title" }]], ["b3", [{ field: "title" }]], ["b4", [{ field: "page_text" }]]]) as any,
    audits: [{ businessId: "b1", generatedAt: hr(5) }, { businessId: "b2", generatedAt: hr(6) }, { businessId: "b3", generatedAt: hr(7) }, { businessId: "b9", generatedAt: hr(24 * 20) }],
    scores: new Map([["b1", { overallScore: 40 }], ["b2", { overallScore: 90 }], ["b3", { overallScore: null }], ["b9", { overallScore: 10 }]]),
  };
  const m = computeMetrics(inputs, W, policy, hr(2.5));
  const g = (win: keyof typeof m, id: string) => m[win].find((x) => x.id === id)!;
  check("windows: current cycle, 24h, 7d, 30d and all-time are produced", Object.keys(m).join() === "current_cycle,last_24h,last_7d,last_30d,all_time");
  check("1 qualification rate = qualified (score <= 70) / audited with a numeric score; unscored audits are excluded", g("last_24h", "qualification_rate").numerator === 1 && g("last_24h", "qualification_rate").denominator === 2 && g("last_24h", "qualification_rate").value === 0.5 && g("all_time", "qualification_rate").denominator === 3);
  check("2 evidence completion = businesses with website evidence / businesses with a website (created in window)", g("last_24h", "evidence_completion").numerator === 1 && g("last_24h", "evidence_completion").denominator === 2 && g("all_time", "evidence_completion").denominator === 3 && g("all_time", "evidence_completion").numerator === 2);
  check("3 mission success = completed / missions whose latest attempt is in the window", g("last_24h", "mission_success_rate").numerator === 2 && g("last_24h", "mission_success_rate").denominator === 3);
  check("4 outreach response = delivered outreach that reached ENGAGED / prospects with a SENT attempt in the window (FAILED sends excluded)", g("last_24h", "outreach_response_rate").numerator === 0 && g("last_24h", "outreach_response_rate").denominator === 2 && g("all_time", "outreach_response_rate").numerator === 2 && g("all_time", "outreach_response_rate").denominator === 4 && g("all_time", "outreach_response_rate").value === 0.5);
  check("5 proposal conversion = WON / proposals approved for presentation in the window", g("last_24h", "proposal_conversion").denominator === 2 && g("last_24h", "proposal_conversion").numerator === 1 && g("all_time", "proposal_conversion").denominator === 3 && g("all_time", "proposal_conversion").numerator === 2);
  check("6 delivery completion = COMPLETE / engagements created in the window", g("last_24h", "delivery_completion").numerator === 1 && g("last_24h", "delivery_completion").denominator === 2);
  check("7 customer acceptance = accepted / artifacts delivered in the window", g("last_24h", "customer_acceptance_rate").denominator === 3 && g("last_24h", "customer_acceptance_rate").numerator === 1);
  check("8 revenue counts recorded payments only: the SENT invoice (999.00) is excluded", (g("last_24h", "revenue").value as Record<string, string>).USD === "300.00" && (g("last_7d", "revenue").value as Record<string, string>).USD === "300.00" && (g("all_time", "revenue").value as Record<string, string>).USD === "350.00");
  check("9 delivery time = mean(completedAt - customer-won time) over engagements completed in the window", g("last_24h", "delivery_time_ms").value === 8 * 3_600_000 && g("last_24h", "delivery_time_ms").denominator === 1);
  check("10 AI cost = recorded AI_COST outflows only (CLIENT_PAYMENT excluded)", (g("last_24h", "ai_cost").value as Record<string, string>).USD === "2.50" && (g("last_30d", "ai_cost").value as Record<string, string>).USD === "10.00");
  check("11 failure rate = FAILED / (SUCCEEDED + FAILED); BLOCKED is not an attempt", g("last_24h", "failure_rate").numerator === 2 && g("last_24h", "failure_rate").denominator === 4);
  check("12 human approval rate = APPROVED / resolved (APPROVED + REJECTED) in the window", g("last_24h", "human_approval_rate").numerator === 2 && g("last_24h", "human_approval_rate").denominator === 3 && g("all_time", "human_approval_rate").denominator === 4);
  const empty = computeMetrics({ ...inputs, prospects: [], engagements: [], invoices: [], tasks: [], ledger: [], approvals: [], businesses: [], audits: [], observations: new Map(), scores: new Map() }, W, policy);
  check("zero denominators give null (never 0 or NaN); empty money windows give {}", empty.all_time.filter((x) => x.denominator !== null).every((x) => x.value === null) && empty.all_time.find((x) => x.id === "revenue")!.value instanceof Object && Object.keys(empty.all_time.find((x) => x.id === "revenue")!.value as object).length === 0 && !JSON.stringify(empty).includes("NaN"));
  check("every metric defines its numerator, denominator, timestamp and zero-denominator rule", Object.values(m).flat().every((x) => x.definition.numerator && x.definition.denominator && x.definition.timestamp && x.definition.zeroDenominator));
  check("computing metrics does not mutate its inputs", (() => { const before = dec(inputs); computeMetrics(inputs, W, policy); return dec(inputs) === before; })());

  // ---- learning safety boundary ----
  check("the default policy is immutable at runtime (nothing, including metrics, can raise budgets or change gates)", (() => { try { (policy as any).dailyAutonomousSpendLimitUsd = 99; return false; } catch { } try { (policy.loop as any).maxSpendPerDayUsd = 99; return false; } catch { } try { (policy.loop.circuitBreaker as any).tripAfterConsecutiveFailures = 99; return false; } catch { } try { (policy.loop.externalDecisionTypes as any).pop(); return false; } catch { } return policy.dailyAutonomousSpendLimitUsd === 1 && policy.loop.maxSpendPerDayUsd === 1 && policy.loop.circuitBreaker.tripAfterConsecutiveFailures === 3 && policy.loop.externalDecisionTypes.length === 4; })());
  const d = (type: any, businessId: string): any => ({ decisionId: `${type}-${businessId}`, type, businessId, approvalRequirement: type === "CREATE_OUTREACH_MISSION" ? "HUMAN" : "NONE", budgetImpactUsd: 0.02, reason: "r", ruleId: "R", stateRefs: ["x"], proposedMission: null, clientId: null, createdAt: W, expiresAt: null });
  const list = [d("ANALYZE_OPPORTUNITY", "a"), d("COLLECT_EVIDENCE", "b"), d("CREATE_OUTREACH_MISSION", "c"), d("GENERATE_AUDIT", "d")];
  const metrics30 = (evidence: number, evDen: number, conv: number, convDen: number) => [{ id: "evidence_completion", value: evDen ? evidence : null, denominator: evDen }, { id: "proposal_conversion", value: convDen ? conv : null, denominator: convDen }] as any;
  const base = applyMetricPriority(list, metrics30(0.9, 10, 0, 10), policy).map((x) => x.decisionId);
  const low = applyMetricPriority(list, metrics30(0.2, 10, 0, 10), policy);
  check("low evidence completion moves COLLECT_EVIDENCE up by at most one tier (never past higher-priority work)", base.join() === "CREATE_OUTREACH_MISSION-c,GENERATE_AUDIT-d,ANALYZE_OPPORTUNITY-a,COLLECT_EVIDENCE-b" && low.map((x) => x.decisionId).join() === "CREATE_OUTREACH_MISSION-c,GENERATE_AUDIT-d,ANALYZE_OPPORTUNITY-a,COLLECT_EVIDENCE-b" && low.findIndex((x) => x.type === "COLLECT_EVIDENCE") >= base.indexOf("ANALYZE_OPPORTUNITY-a"));
  check("a metric rule is ignored below the minimum sample size", applyMetricPriority(list, metrics30(0.1, policy.metricPriority.minSample - 1, 0, 10), policy).map((x) => x.decisionId).join() === base.join());
  check("maxBoost=0 disables all metric influence", applyMetricPriority(list, metrics30(0.1, 10, 0.9, 10), { ...policy, metricPriority: { ...policy.metricPriority, maxBoost: 0 } }).map((x) => x.decisionId).join() === base.join());
  const boosted = applyMetricPriority(list, metrics30(0.1, 10, 0.9, 10), policy);
  check("metric ordering returns the same decisions untouched: IDs, approvals, budgets and reasons are identical", boosted.length === list.length && boosted.every((x) => { const o = list.find((y) => y.decisionId === x.decisionId)!; return dec(x) === dec(o); }) && boosted.find((x) => x.type === "CREATE_OUTREACH_MISSION")!.approvalRequirement === "HUMAN");
  check("metric ordering is pure: it works on deeply frozen inputs and never writes", (() => { const deep = (o: any): any => { Object.values(o).forEach((v) => v && typeof v === "object" && deep(v)); return Object.freeze(o); }; try { return applyMetricPriority(deep(JSON.parse(JSON.stringify(list))), deep(JSON.parse(JSON.stringify(metrics30(0.1, 10, 0.9, 10)))), policy).length === 4; } catch { return false; } })());
}

// ======================= Objective 10: observability (+ durability of 7-10) =======================
{
  const adapter = newDb().adapters.createPg();
  const connect = () => new PostgresAtlasPersistence(new adapter.Pool() as unknown as SqlClient);
  const p1 = connect(); await p1.migrate();
  const w = await makeWorld({ persistence: p1 });
  const c1 = await completeEngagement(w, "b1", 300);
  const inv = w.revenue.createEligible(w.delivery.get(c1.eid), "system:atlas");
  w.revenue.prepare(inv.invoiceId, "human:ama");
  const mkCycle = (i: number, status: AutonomyCycle["status"] = "COMPLETED"): AutonomyCycle => ({ cycleId: `cycle:2026-10-10T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, trigger: "scheduled", startedAt: `2026-10-10T${String(Math.floor(i / 3600)).padStart(2, "0")}:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, completedAt: null, status, stopReason: "NO_LEGITIMATE_ACTION", policyHash: "h", stateSnapshot: null, steps: [], missionsCreated: 0, spendUsd: 0, failure: null, nextEvaluation: null });
  for (let i = 0; i < 120; i++) w.store.cycles.set(mkCycle(i).cycleId, mkCycle(i));
  w.store.saveBreaker({ state: "OPEN", consecutiveFailures: 3, openedAt: T0, lastFailureAt: T0 });
  const businesses = new Map<string, any>([["b1", { id: "b1", canonicalName: "B1 Cafe", category: "cafe", address: "Accra", website: "https://b1.example", sourceReferences: ["manual"] }]]);
  const pipeline: any = { businesses, observations: new Map(), scores: new Map([["b1", { overallScore: 55, confidence: { overall: "MEDIUM" }, blockers: [] }]]), audits: new Map([["b1", { auditId: "audit-b1", generatedAt: T0, recommendations: [1, 2] }]]) };
  const rt: AutonomyRuntime = { policy, lifecycle: w.store, pipeline, missionQueue: w.queue, ledger: w.ledger, revenue: w.revenue, approvals: w.approvals, scheduler: new AutonomyScheduler(async () => mkCycle(0)), autonomyEnabled: false, executionEnabled: false, persistenceHealth: () => p1.health(), metricInputs: () => ({ prospects: [...w.store.prospects.values()], engagements: [...w.store.engagements.values()], invoices: [...w.store.invoices.values()], tasks: w.queue.getSnapshot(), ledger: w.ledger.list(), approvals: [...w.store.approvals.values()], businesses: [], observations: new Map(), audits: [], scores: new Map() }), now: () => "2026-10-10T20:00:00.000Z" };
  const get = (path: string, q = "") => readAutonomy("GET", path, new URLSearchParams(q), rt);
  const snapshot = () => dec([w.store.cycles.size, w.store.decisions.size, w.store.invoices.size, w.store.approvals.size, w.store.breaker, w.ledger.list().length, w.queue.getSnapshot().length, [...w.store.invoices.values()]]);
  const before = snapshot();

  check("endpoints are GET-only: POST/PUT/DELETE are refused with 405 and nothing changes", ["POST", "PUT", "PATCH", "DELETE"].every((m) => readAutonomy(m, "/api/atlas/autonomy/status", new URLSearchParams(), rt).status === 405) && snapshot() === before);
  check("unknown endpoints are 404; bad paging parameters are 400", get("/api/atlas/autonomy/nope").status === 404 && get("/api/atlas/autonomy/cycles", "limit=0").status === 400 && get("/api/atlas/autonomy/cycles", "limit=abc").status === 400 && get("/api/atlas/autonomy/cycles", "cursor=%%%").status === 400);
  const st = get("/api/atlas/autonomy/status").body as any;
  check("status reports autonomy, breaker, limits, spend, counts and persistence health", st.autonomy.enabled === false && st.autonomy.missionExecutionEnabled === false && st.circuitBreaker.state === "OPEN" && st.limits.maxMissionsPerCycle === 3 && st.counts.cycles === 120 && st.persistence.ok === true && typeof st.spentTodayUsd === "number");
  const everything = dec([st, get("/api/atlas/autonomy/finance").body, get("/api/atlas/autonomy/decisions").body, get("/api/atlas/autonomy/missions").body, get("/api/atlas/autonomy/business/b1").body, get("/api/atlas/autonomy/cycles").body]);
  check("responses expose no secrets: no keys, tokens, database URLs, env values, contact addresses or message bodies", !/apiKey|API_KEY|DATABASE_URL|postgres:\/\/|github_pat|owner@example\.com|Hello, we noticed/i.test(everything));
  check("reading never mutates anything (cycles, decisions, invoices, approvals, breaker, ledger, queue are identical)", snapshot() === before);

  // pagination: stable, capped, no skip/repeat even when new items arrive between pages
  const page1 = get("/api/atlas/autonomy/cycles", "limit=50").body as any;
  const capped = get("/api/atlas/autonomy/cycles", "limit=1000").body as any;
  check("page size is capped and newest items come first", page1.items.length === 50 && capped.items.length === PAGE_MAX && page1.items[0].startedAt > page1.items[49].startedAt && !!page1.nextCursor);
  w.store.cycles.set("cycle:newer", { ...mkCycle(0), cycleId: "cycle:newer", startedAt: "2026-10-11T00:00:00.000Z" });
  const page2 = get("/api/atlas/autonomy/cycles", `limit=50&cursor=${page1.nextCursor}`).body as any;
  const page3 = get("/api/atlas/autonomy/cycles", `limit=50&cursor=${page2.nextCursor}`).body as any;
  const ids = [...page1.items, ...page2.items, ...page3.items].map((c: any) => c.cycleId);
  check("keyset pagination: no item is repeated or skipped across pages even after a newer item arrives", new Set(ids).size === ids.length && ids.length === 120 && !ids.includes("cycle:newer") && page3.nextCursor === null);
  check("paginate() orders ties deterministically by id", paginate([{ k: "a|2" }, { k: "a|1" }, { k: "a|3" }], (x) => x.k, { limit: 10, cursor: null }).items.map((x) => x.k).join() === "a|3,a|2,a|1");
  check("a single cycle can be fetched by ID; unknown IDs are 404", (get("/api/atlas/autonomy/cycles", "cycleId=cycle:newer").body as any).cycle.cycleId === "cycle:newer" && get("/api/atlas/autonomy/cycles", "cycleId=zzz").status === 404);

  const fin = get("/api/atlas/autonomy/finance").body as any;
  check("finance: an eligible/prepared invoice appears under notRevenue and is not revenue", Object.keys(fin.receivedRevenue.totals).length === 0 && fin.notRevenue.PREPARED.count === 1 && fin.notRevenue.PREPARED.amount.USD === "300.00" && /Only recorded payments are revenue/.test(fin.note));
  w.revenue.markSent(inv.invoiceId, "human:ama", "email");
  w.revenue.recordPayment(inv.invoiceId, { amountMinorUnits: "30000", currency: "USD", reference: "bank-1", receivedAt: "2026-10-09T10:00:00.000Z" }, "human:ama");
  const fin2 = get("/api/atlas/autonomy/finance").body as any;
  check("finance: after a recorded payment, revenue shows the real amount and the invoice lists the payment", fin2.receivedRevenue.totals.USD === "300.00" && fin2.receivedRevenue.paymentCount === 1 && fin2.invoices.items[0].payments[0].amount.amount === "300.00");
  w.store.decisions.set("d1", { decisionId: "d1", type: "WAIT_FOR_HUMAN", businessId: "b1", clientId: null, reason: "needs human", ruleId: "R04", stateRefs: ["x"], proposedMission: null, approvalRequirement: "HUMAN", budgetImpactUsd: 0, createdAt: "2026-10-10T01:00:00.000Z", expiresAt: null });
  w.store.decisions.set("d2", { decisionId: "d2", type: "NO_ACTION", businessId: "b2", clientId: null, reason: "nothing", ruleId: "R07", stateRefs: ["y"], proposedMission: null, approvalRequirement: "NONE", budgetImpactUsd: 0, createdAt: "2026-10-10T02:00:00.000Z", expiresAt: null });
  const ds = get("/api/atlas/autonomy/decisions", "businessId=b1").body as any;
  check("decisions list filters by business and type, newest first", ds.items.length === 1 && ds.items[0].decisionId === "d1" && (get("/api/atlas/autonomy/decisions", "type=NO_ACTION").body as any).items[0].decisionId === "d2");
  const ms = get("/api/atlas/autonomy/missions", "businessId=b1").body as any;
  check("missions list is paginated, filterable and returns no outputs", ms.items.length === 2 && ms.items.every((m: any) => m.businessId === "b1" && m.missionType === "delivery_work") && !dec(ms).includes("text"));
  const tr = get("/api/atlas/autonomy/business/b1").body as any;
  const kinds = new Set(tr.timeline.map((e: any) => e.kind));
  check("business trace reconstructs score, audit, missions, prospect, engagement, invoice and payment on one ordered timeline", tr.business.name === "B1 Cafe" && tr.score.overall === 55 && tr.audit.auditId === "audit-b1" && tr.prospect.state === "WON" && tr.engagement.state === "COMPLETE" && tr.invoice.state === "PAYMENT_RECORDED" && ["decision", "mission", "prospect", "engagement", "invoice", "payment"].every((k) => kinds.has(k)) && tr.timeline.every((e: any, i: number, a: any[]) => i === 0 || a[i - 1].at <= e.at));
  check("business trace exposes the contact channel and source but never the address; unknown business is 404", tr.prospect.outreach.contactChannel.source === "human_provided" && !dec(tr).includes("owner@example.com") && get("/api/atlas/autonomy/business/zzz").status === 404);

  // ---- restart: everything for Objectives 7-10 is durable ----
  await p1.flush();
  const p2 = connect(); await p2.migrate();
  const s2 = new LifecycleStore(p2);
  const h = await s2.hydrate();
  const ledger2 = new DurableLedger(p2);
  const restoredLedger = await ledger2.hydrate();
  check("restart: invoices, approvals, cycles, decisions and the circuit breaker are restored", h.invoices === 1 && h.cycles === 121 && h.decisions === 2 && s2.breaker.state === "OPEN" && s2.breaker.consecutiveFailures === 3 && restoredLedger === 1);
  check("restart: the restored invoice, payment and ledger entry are identical (BigInt amounts preserved)", dec(s2.invoices.get(inv.invoiceId)) === dec(w.store.invoices.get(inv.invoiceId)) && ledger2.list()[0].amount.minorUnits === 30000n);
  check("persistence stayed healthy", p1.health().ok && p2.health().ok);
}

console.log(failures === 0 ? "\nALL AUTONOMY (OBJECTIVES 7-10 PART 1) TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
