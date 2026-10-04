import { createHash } from "node:crypto";
import type { MissionQueueRepository, Task } from "../mission-queue";
import { LifecycleError, disabledOutreachSender, type OutreachSender, type ProspectRecord, type ProspectService } from "./prospects";
import type { Artifact, DeliveryService, Engagement } from "./delivery";
import { invoiceVersion, type Invoice, type RevenueService } from "./revenue";
import type { LifecycleStore } from "./lifecycle-store";

/**
 * Typed human-approval operations (Objective 8). Every operation:
 *  - names the human actor (human:<id>) and is refused for any other actor;
 *  - references the exact object VERSION being approved, and is refused with `stale_version` if the object changed;
 *  - is idempotent (the same operation on the same version by the same actor replays the recorded result, with no repeated effect);
 *  - can only call the existing lifecycle service for that one boundary, so it cannot override a hard rule
 *    (illegal transitions, missing contact, AI-invented scope, currency mismatch... still fail).
 * There is deliberately no generic "approve anything" operation; unknown operation names are rejected.
 */
const sha = (...p: unknown[]) => createHash("sha256").update(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).digest("hex");
const isHuman = (a: unknown): a is string => typeof a === "string" && /^human:.+/.test(a);

export const missionVersion = (t: Task) => sha(t.taskId, t.title, t.description, t.missionType ?? null, t.approvalRequired);
export const proposalVersion = (p: ProspectRecord) => sha(p.proposal?.proposalId, p.proposal?.scope, p.proposal?.summary, p.proposal?.priceUsd, p.proposal?.scopeSource);
export const artifactVersion = (a: Artifact) => sha(a.artifactId, a.title, a.contentRef, a.state);
export const scopeVersion = (e: Engagement) => sha(e.scope);
export const outreachVersion = (p: ProspectRecord) => p.outreach?.draft.draftHash ?? null;

export interface ApprovalRecord {
  approvalId: string; operation: string; objectType: string; objectId: string; objectVersion: string; actor: string;
  outcome: "APPROVED" | "REJECTED"; at: string; result: unknown;
}
export interface MissionRunResultLike { executed: boolean; outcome: string; reason?: string; costUsd?: number; completedEventDispatched?: boolean }
export interface ApprovalDeps {
  lifecycle: LifecycleStore; prospects: ProspectService; delivery: DeliveryService; revenue: RevenueService; missionQueue: MissionQueueRepository;
  missionOutputs: Map<string, { generatedBy: string; text: string; isEvidence: false }>;
  runMission?: (taskId: string, approval: { approvedByHuman: boolean }) => Promise<MissionRunResultLike>;
  sender?: OutreachSender; now?: () => string;
}

export const APPROVAL_OPERATIONS = ["mission", "outreach-draft", "outreach", "outreach-send", "proposal", "proposal-decision", "requirements", "artifact", "delivery", "customer-decision", "invoice-prepare", "invoice-sent", "payment", "payment-reconcile"] as const;
export type ApprovalOperation = (typeof APPROVAL_OPERATIONS)[number];

const text = (b: Record<string, unknown>, k: string): string => { const v = b[k]; if (typeof v !== "string" || !v.trim()) throw new LifecycleError("invalid_input", `${k} is required`); return v.trim(); };
const bool = (b: Record<string, unknown>, k: string): boolean => { if (typeof b[k] !== "boolean") throw new LifecycleError("invalid_input", `${k} must be true or false`); return b[k] as boolean; };
const checkVersion = (supplied: string, current: string | null, what: string) => { if (supplied !== current) throw new LifecycleError("stale_version", `${what} changed since it was reviewed; review the current version and approve again`); };

export class ApprovalService {
  private inFlight = new Map<string, Promise<unknown>>();
  constructor(private d: ApprovalDeps) {}
  private now() { return (this.d.now ?? (() => new Date().toISOString()))(); }
  private human(actor: unknown, what: string): string { if (!isHuman(actor)) throw new LifecycleError("human_required", `${what} requires a named human actor (human:<id>)`); return actor; }

  /** Runs `fn` once per (operation, object, version, actor, extra). Replays return the recorded result without re-running it. */
  private async once<T>(operation: string, objectType: string, objectId: string, version: string, actor: string, extra: unknown, fn: () => Promise<T> | T, outcome: "APPROVED" | "REJECTED" = "APPROVED"): Promise<{ idempotent: boolean; result: T }> {
    const approvalId = sha(operation, objectId, version, actor, extra);
    const recorded = this.d.lifecycle.approvals.get(approvalId);
    if (recorded) return { idempotent: true, result: recorded.result as T };
    const pending = this.inFlight.get(approvalId);
    if (pending) return { idempotent: true, result: (await pending) as T };
    const run = (async () => {
      const result = await fn();
      this.d.lifecycle.approvals.set(approvalId, { approvalId, operation, objectType, objectId, objectVersion: version, actor, outcome, at: this.now(), result });
      return result;
    })();
    this.inFlight.set(approvalId, run);
    try { return { idempotent: false, result: (await run) as T }; } finally { this.inFlight.delete(approvalId); }
  }

  /** Dispatches ONE of the whitelisted typed operations. */
  async handle(operation: string, body: unknown): Promise<unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new LifecycleError("invalid_input", "a JSON object body is required");
    const b = body as Record<string, unknown>;
    switch (operation as ApprovalOperation) {
      case "mission": return this.approveMission(b);
      case "outreach-draft": return this.attachOutreachDraft(b);
      case "outreach": return this.approveOutreach(b);
      case "outreach-send": return this.sendOutreach(b);
      case "proposal": return this.approveProposal(b);
      case "proposal-decision": return this.recordProposalDecision(b);
      case "requirements": return this.recordRequirements(b);
      case "artifact": return this.decideArtifact(b);
      case "delivery": return this.recordDelivery(b);
      case "customer-decision": return this.recordCustomerDecision(b);
      case "invoice-prepare": return this.prepareInvoice(b);
      case "invoice-sent": return this.markInvoiceSent(b);
      case "payment": return this.recordPayment(b);
      case "payment-reconcile": return this.reconcilePayment(b);
      default: throw new LifecycleError("unknown_operation", `"${operation}" is not an approval operation`);
    }
  }

  async approveMission(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "approving a mission");
    const taskId = text(b, "taskId");
    const task = this.d.missionQueue.getSnapshot().find((t) => t.taskId === taskId);
    if (!task) throw new LifecycleError("not_found", `unknown mission ${taskId}`);
    if (task.status === "Completed") return { idempotent: true, result: { executed: false, outcome: "COMPLETED", reason: "already completed" } };
    checkVersion(text(b, "version"), missionVersion(task), "the mission");
    if (!this.d.runMission) throw new LifecycleError("execution_unavailable", "mission execution is not available in this runtime");
    const approvalId = sha("mission", taskId, missionVersion(task), actor);
    const result = await this.d.runMission(taskId, { approvedByHuman: true });
    if (result.executed && !this.d.lifecycle.approvals.has(approvalId)) {
      this.d.lifecycle.approvals.set(approvalId, { approvalId, operation: "mission", objectType: "mission", objectId: taskId, objectVersion: missionVersion(task), actor, outcome: "APPROVED", at: this.now(), result });
    }
    return { idempotent: false, result };
  }

  async attachOutreachDraft(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "attaching an outreach draft");
    const prospectId = text(b, "prospectId"), taskId = text(b, "taskId");
    const prospect = this.d.prospects.get(prospectId);
    const task = this.d.missionQueue.getSnapshot().find((t) => t.taskId === taskId);
    const output = this.d.missionOutputs.get(taskId);
    if (!task || task.status !== "Completed" || task.missionType !== "outreach_draft" || task.clientId !== prospect.businessId) throw new LifecycleError("invalid_mission", "the mission must be a completed outreach_draft mission for this prospect");
    if (!output) throw new LifecycleError("no_output", "the mission has no stored output");
    checkVersion(text(b, "version"), sha(missionVersion(task), output.text), "the mission output");
    const lines = output.text.split("\n");
    const parsed = /^subject:\s*(.+)$/i.exec(lines[0] ?? "");
    const subject = typeof b.subject === "string" && b.subject.trim() ? b.subject.trim() : parsed?.[1]?.trim();
    if (!subject) throw new LifecycleError("subject_required", "the draft has no 'Subject:' first line; supply a subject");
    const body = parsed && typeof b.subject !== "string" ? lines.slice(1).join("\n").trim() : output.text.trim();
    return this.once("outreach-draft", "prospect", prospectId, text(b, "version"), actor, subject, () => {
      const p = this.d.prospects.prepareOutreach(prospectId, { subject, body, generatedBy: `ai:${output.generatedBy}` }, actor);
      return { prospectId, state: p.state, draftHash: p.outreach?.draft.draftHash };
    });
  }

  async approveOutreach(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "approving outreach");
    const prospectId = text(b, "prospectId");
    const p = this.d.prospects.get(prospectId);
    checkVersion(text(b, "draftHash"), outreachVersion(p), "the outreach draft");
    const contact = b.contact && typeof b.contact === "object" ? (b.contact as { channel: "email" | "phone" | "website_form"; address: string }) : undefined;
    return this.once("outreach", "prospect", prospectId, text(b, "draftHash"), actor, contact ?? null, () => {
      const r = this.d.prospects.approveOutreach(prospectId, actor, contact);
      return { prospectId, state: r.state, approvedBy: r.outreach?.approval?.approvedBy, contactSource: r.outreach?.contact?.source };
    });
  }

  /** The external boundary. With no integration configured the attempt is recorded as NOT_CONFIGURED and nothing is sent. */
  async sendOutreach(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "sending outreach");
    const prospectId = text(b, "prospectId");
    const p = this.d.prospects.get(prospectId);
    checkVersion(text(b, "draftHash"), outreachVersion(p), "the outreach draft");
    const r = await this.d.prospects.sendApproved(prospectId, this.d.sender ?? disabledOutreachSender);
    return { idempotent: r.duplicate, result: { prospectId, state: r.prospect.state, attempt: r.attempt ? { status: r.attempt.status, at: r.attempt.at, detail: r.attempt.detail } : null } };
  }

  async approveProposal(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "approving a proposal");
    const prospectId = text(b, "prospectId");
    const p = this.d.prospects.get(prospectId);
    checkVersion(text(b, "version"), proposalVersion(p), "the proposal");
    return this.once("proposal", "prospect", prospectId, text(b, "version"), actor, null, () => ({ prospectId, state: this.d.prospects.submitProposalForApproval(prospectId, actor).state }));
  }

  async recordProposalDecision(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "recording the customer's proposal decision");
    const prospectId = text(b, "prospectId"), accepted = bool(b, "accepted"), reference = text(b, "reference");
    checkVersion(text(b, "version"), proposalVersion(this.d.prospects.get(prospectId)), "the proposal");
    return this.once("proposal-decision", "prospect", prospectId, text(b, "version"), actor, { accepted, reference }, () => ({ prospectId, state: this.d.prospects.recordProposalDecision(prospectId, actor, accepted, reference).state }), accepted ? "APPROVED" : "REJECTED");
  }

  async recordRequirements(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "recording customer requirements");
    const engagementId = text(b, "engagementId");
    const reqs = Array.isArray(b.requirements) ? b.requirements.filter((r): r is string => typeof r === "string") : [];
    checkVersion(text(b, "scopeVersion"), scopeVersion(this.d.delivery.get(engagementId)), "the engagement scope");
    return this.once("requirements", "engagement", engagementId, text(b, "scopeVersion"), actor, reqs, () => ({ engagementId, state: this.d.delivery.recordRequirements(engagementId, actor, reqs).state }));
  }

  async decideArtifact(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "reviewing an artifact");
    const engagementId = text(b, "engagementId"), artifactId = text(b, "artifactId"), decision = text(b, "decision");
    if (decision !== "approve" && decision !== "reject") throw new LifecycleError("invalid_input", "decision must be approve or reject");
    const artifact = this.d.delivery.get(engagementId).artifacts.find((a) => a.artifactId === artifactId);
    if (!artifact) throw new LifecycleError("not_found", `unknown artifact ${artifactId}`);
    checkVersion(text(b, "artifactVersion"), artifactVersion(artifact), "the artifact");
    const reason = decision === "reject" ? text(b, "reason") : "";
    return this.once("artifact", "artifact", artifactId, text(b, "artifactVersion"), actor, decision, () => {
      const e = decision === "approve" ? this.d.delivery.approveArtifactInternally(engagementId, artifactId, actor) : this.d.delivery.rejectArtifactInternally(engagementId, artifactId, actor, reason);
      return { engagementId, engagementState: e.state, artifactState: e.artifacts.find((a) => a.artifactId === artifactId)?.state };
    }, decision === "approve" ? "APPROVED" : "REJECTED");
  }

  async recordDelivery(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "recording a customer delivery");
    const engagementId = text(b, "engagementId"), artifactId = text(b, "artifactId"), note = text(b, "note");
    const artifact = this.d.delivery.get(engagementId).artifacts.find((a) => a.artifactId === artifactId);
    if (!artifact) throw new LifecycleError("not_found", `unknown artifact ${artifactId}`);
    checkVersion(text(b, "artifactVersion"), artifactVersion(artifact), "the artifact");
    return this.once("delivery", "artifact", artifactId, text(b, "artifactVersion"), actor, note, () => {
      const e = this.d.delivery.recordDelivery(engagementId, artifactId, actor, note);
      return { engagementId, engagementState: e.state, artifactState: e.artifacts.find((a) => a.artifactId === artifactId)?.state };
    });
  }

  async recordCustomerDecision(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "recording the customer's decision");
    const engagementId = text(b, "engagementId"), artifactId = text(b, "artifactId"), accepted = bool(b, "accepted"), reference = text(b, "reference");
    const artifact = this.d.delivery.get(engagementId).artifacts.find((a) => a.artifactId === artifactId);
    if (!artifact) throw new LifecycleError("not_found", `unknown artifact ${artifactId}`);
    checkVersion(text(b, "artifactVersion"), artifactVersion(artifact), "the artifact");
    return this.once("customer-decision", "artifact", artifactId, text(b, "artifactVersion"), actor, { accepted, reference }, () => {
      const e = this.d.delivery.recordCustomerDecision(engagementId, artifactId, actor, accepted, reference);
      return { engagementId, engagementState: e.state, artifactState: e.artifacts.find((a) => a.artifactId === artifactId)?.state };
    }, accepted ? "APPROVED" : "REJECTED");
  }

  private invoiceView(i: Invoice) { return { invoiceId: i.invoiceId, state: i.state, version: invoiceVersion(i), payments: i.payments.length }; }

  async prepareInvoice(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "preparing an invoice");
    const invoiceId = text(b, "invoiceId");
    checkVersion(text(b, "version"), invoiceVersion(this.d.revenue.get(invoiceId)), "the invoice");
    return this.once("invoice-prepare", "invoice", invoiceId, text(b, "version"), actor, null, () => this.invoiceView(this.d.revenue.prepare(invoiceId, actor)));
  }

  async markInvoiceSent(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "recording that an invoice was sent");
    const invoiceId = text(b, "invoiceId"), reference = text(b, "reference");
    checkVersion(text(b, "version"), invoiceVersion(this.d.revenue.get(invoiceId)), "the invoice");
    return this.once("invoice-sent", "invoice", invoiceId, text(b, "version"), actor, reference, () => this.invoiceView(this.d.revenue.markSent(invoiceId, actor, reference)));
  }

  async recordPayment(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "recording a payment");
    const invoiceId = text(b, "invoiceId");
    const amount = typeof b.amountMinorUnits === "string" || typeof b.amountMinorUnits === "number" ? String(b.amountMinorUnits) : "";
    if (!/^\d+$/.test(amount)) throw new LifecycleError("invalid_amount", "amountMinorUnits must be a positive integer (e.g. cents)");
    const input = { amountMinorUnits: amount, currency: text(b, "currency"), reference: text(b, "reference"), receivedAt: text(b, "receivedAt") };
    return this.once("payment", "invoice", invoiceId, "payment", actor, input, () => {
      const r = this.d.revenue.recordPayment(invoiceId, input, actor);
      return { ...this.invoiceView(r.invoice), paymentId: r.payment.paymentId, transactionId: r.payment.transactionId, duplicatePayment: r.duplicate };
    });
  }

  async reconcilePayment(b: Record<string, unknown>) {
    const actor = this.human(b.actor, "reconciling a payment");
    const invoiceId = text(b, "invoiceId"), paymentId = text(b, "paymentId");
    const amount = typeof b.externalAmountMinorUnits === "string" || typeof b.externalAmountMinorUnits === "number" ? String(b.externalAmountMinorUnits) : "";
    if (!/^\d+$/.test(amount)) throw new LifecycleError("invalid_amount", "externalAmountMinorUnits must be an integer");
    const input = { externalAmountMinorUnits: amount, externalReference: text(b, "externalReference") };
    return this.once("payment-reconcile", "invoice", invoiceId, paymentId, actor, input, () => {
      const i = this.d.revenue.reconcilePayment(invoiceId, paymentId, input, actor);
      return { ...this.invoiceView(i), reconciliation: i.payments.find((p) => p.paymentId === paymentId)?.reconciliation?.status ?? null };
    });
  }
}
