import { createHash } from "node:crypto";
import type { LifecycleStore } from "./lifecycle-store";

/**
 * Customer acquisition lifecycle (Objective 5).
 *
 *  PROSPECT -> OUTREACH_PREPARED -> APPROVAL_REQUIRED -> OUTREACH_SENT -> RESPONSE_PENDING -> ENGAGED
 *    -> PROPOSAL_PREPARED -> PROPOSAL_APPROVAL -> WON | LOST | DORMANT
 *
 * Guarantees: AI may draft outreach and proposals but drafts are never evidence; nothing is sent without a
 * human approval bound to the exact draft; contact details are never invented; the actual send goes through
 * an explicit integration boundary (OutreachSender) that is disabled by default; every send attempt is
 * idempotent and recorded; a proposal's scope comes from customer requirements or a human, never from AI;
 * WON can only be recorded by a human citing the customer's acceptance.
 */
export type ProspectState = "PROSPECT" | "OUTREACH_PREPARED" | "APPROVAL_REQUIRED" | "OUTREACH_SENT" | "RESPONSE_PENDING" | "ENGAGED" | "PROPOSAL_PREPARED" | "PROPOSAL_APPROVAL" | "WON" | "LOST" | "DORMANT";

export const PROSPECT_TRANSITIONS: Record<ProspectState, ProspectState[]> = {
  PROSPECT: ["OUTREACH_PREPARED", "LOST", "DORMANT"],
  OUTREACH_PREPARED: ["APPROVAL_REQUIRED", "LOST"],
  APPROVAL_REQUIRED: ["OUTREACH_SENT", "PROSPECT", "LOST", "DORMANT"],
  OUTREACH_SENT: ["RESPONSE_PENDING"],
  RESPONSE_PENDING: ["ENGAGED", "LOST", "DORMANT"],
  ENGAGED: ["PROPOSAL_PREPARED", "LOST", "DORMANT"],
  PROPOSAL_PREPARED: ["PROPOSAL_APPROVAL", "ENGAGED", "LOST"],
  PROPOSAL_APPROVAL: ["WON", "LOST", "ENGAGED"],
  WON: [], LOST: [], DORMANT: ["PROSPECT"],
};

export interface ScopeItem { scopeItemId: string; title: string; description: string }
export interface ContactChannel { channel: "email" | "phone" | "website_form"; address: string; source: "business_record" | "human_provided" }
export interface OutreachDraft { subject: string; body: string; generatedBy: string; isEvidence: false; draftHash: string; preparedAt: string }
export interface SendAttempt { sendId: string; idempotencyKey: string; at: string; channel: string; to: string; status: "SENT" | "NOT_CONFIGURED" | "FAILED"; providerMessageId?: string; detail?: string }
export interface Proposal {
  proposalId: string; scope: ScopeItem[]; scopeSource: "customer_requirements" | "human_authored"; summary: string; priceUsd: number | null;
  preparedBy: string; isEvidence: false; preparedAt: string; approvedBy?: string; acceptedBy?: string; acceptedAt?: string; acceptanceReference?: string;
}
export interface ProspectHistoryEntry { from: ProspectState | null; to: ProspectState; at: string; actor: string; reason: string; idempotencyKey: string }
export interface ProspectRecord {
  prospectId: string; businessId: string; state: ProspectState; history: ProspectHistoryEntry[];
  outreach?: { draft: OutreachDraft; approval?: { approvedBy: string; approvedAt: string; draftHash: string }; contact?: ContactChannel; sends: SendAttempt[] };
  followUps: number; lastContactAt: string | null; proposal?: Proposal; createdAt: string; updatedAt: string;
}

/** The only door to the outside world for outreach. No real integration exists yet, so the default refuses. */
export interface OutreachSender {
  send(message: { to: string; channel: ContactChannel["channel"]; subject: string; body: string; idempotencyKey: string }): Promise<{ status: "SENT" | "NOT_CONFIGURED" | "FAILED"; providerMessageId?: string; detail?: string }>;
}
export const disabledOutreachSender: OutreachSender = { send: async () => ({ status: "NOT_CONFIGURED", detail: "no outreach integration is configured" }) };

const sha = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const isHuman = (actor: string) => /^human:.+/.test(actor);
const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

export class LifecycleError extends Error { constructor(public code: string, message: string) { super(message); } }

export class ProspectService {
  private inFlight = new Set<string>();
  constructor(private store: LifecycleStore, private now: () => string = () => new Date().toISOString(), private resolveContact: (businessId: string) => ContactChannel | null = () => null) {}

  get(prospectId: string) {
    const r = this.store.prospects.get(prospectId);
    if (!r) throw new LifecycleError("not_found", `unknown prospect ${prospectId}`);
    return r;
  }

  /** Creates (or returns) the prospect for a business. One prospect per business. */
  create(businessId: string, actor: string, reason: string): ProspectRecord {
    const prospectId = `prospect:${businessId}`;
    const existing = this.store.prospects.get(prospectId);
    if (existing) return existing;
    const at = this.now();
    const rec: ProspectRecord = { prospectId, businessId, state: "PROSPECT", history: [{ from: null, to: "PROSPECT", at, actor, reason, idempotencyKey: `create:${prospectId}` }], followUps: 0, lastContactAt: null, createdAt: at, updatedAt: at };
    this.store.prospects.set(prospectId, rec);
    return rec;
  }

  private move(rec: ProspectRecord, to: ProspectState, actor: string, reason: string, key: string): ProspectRecord {
    if (rec.history.some((h) => h.idempotencyKey === key)) return rec; // replay of the same action is a no-op
    if (!PROSPECT_TRANSITIONS[rec.state].includes(to)) throw new LifecycleError("invalid_transition", `${rec.state} -> ${to} is not allowed`);
    const at = this.now();
    const next: ProspectRecord = { ...rec, state: to, updatedAt: at, history: [...rec.history, { from: rec.state, to, at, actor, reason, idempotencyKey: key }] };
    this.store.prospects.set(rec.prospectId, next);
    return next;
  }

  /** Stores an AI- or human-written draft (never evidence) and parks it behind human approval. */
  prepareOutreach(prospectId: string, draft: { subject: string; body: string; generatedBy: string }, actor: string): ProspectRecord {
    let rec = this.get(prospectId);
    if (!nonEmpty(draft.subject) || !nonEmpty(draft.body)) throw new LifecycleError("invalid_draft", "subject and body are required");
    const draftHash = sha(draft.subject, draft.body);
    if (rec.outreach?.draft.draftHash === draftHash) return rec; // same draft already prepared
    if (rec.state !== "PROSPECT") throw new LifecycleError("invalid_transition", `outreach can only be prepared from PROSPECT (state is ${rec.state})`);
    rec = this.move(rec, "OUTREACH_PREPARED", actor, "outreach draft prepared", `prepare:${draftHash}`);
    rec = { ...rec, outreach: { draft: { ...draft, isEvidence: false, draftHash, preparedAt: this.now() }, sends: [] } };
    this.store.prospects.set(prospectId, rec);
    return this.move(rec, "APPROVAL_REQUIRED", "system:atlas", "outbound messages require human approval", `await-approval:${draftHash}`);
  }

  /** A human approves exactly this draft and a real contact channel. Contact details are never invented. */
  approveOutreach(prospectId: string, approver: string, humanContact?: { channel: ContactChannel["channel"]; address: string }): ProspectRecord {
    const rec = this.get(prospectId);
    if (!isHuman(approver)) throw new LifecycleError("human_required", "outreach must be approved by a human actor (human:<id>)");
    if (rec.state !== "APPROVAL_REQUIRED" || !rec.outreach) throw new LifecycleError("invalid_transition", `nothing to approve in state ${rec.state}`);
    const contact: ContactChannel | null = humanContact && nonEmpty(humanContact.address) ? { ...humanContact, source: "human_provided" } : this.resolveContact(rec.businessId);
    if (!contact) throw new LifecycleError("no_contact_channel", "no contact channel on the business record and none provided by the approver; Atlas will not guess one");
    const next = { ...rec, updatedAt: this.now(), outreach: { ...rec.outreach, contact, approval: { approvedBy: approver, approvedAt: this.now(), draftHash: rec.outreach.draft.draftHash } } };
    this.store.prospects.set(prospectId, next);
    return next;
  }

  /** The audited, idempotent external-send boundary. Never throws for a refused or failed send; it records it. */
  async sendApproved(prospectId: string, sender: OutreachSender = disabledOutreachSender): Promise<{ duplicate: boolean; attempt?: SendAttempt; prospect: ProspectRecord }> {
    let rec = this.get(prospectId);
    const o = rec.outreach;
    if (rec.state !== "APPROVAL_REQUIRED" && !(o?.sends.some((s) => s.status === "SENT"))) throw new LifecycleError("invalid_transition", `cannot send from state ${rec.state}`);
    if (!o?.approval || !o.contact) throw new LifecycleError("not_approved", "outreach has no human approval and contact channel");
    if (o.approval.draftHash !== o.draft.draftHash) throw new LifecycleError("approval_mismatch", "the approval does not cover the current draft");
    const key = sha(prospectId, o.draft.draftHash, o.contact.channel, o.contact.address);
    if (o.sends.some((s) => s.idempotencyKey === key && s.status === "SENT") || this.inFlight.has(key)) return { duplicate: true, attempt: o.sends.find((s) => s.idempotencyKey === key && s.status === "SENT"), prospect: rec };
    this.inFlight.add(key);
    try {
      let result: Awaited<ReturnType<OutreachSender["send"]>>;
      try { result = await sender.send({ to: o.contact.address, channel: o.contact.channel, subject: o.draft.subject, body: o.draft.body, idempotencyKey: key }); }
      catch (e) { result = { status: "FAILED", detail: e instanceof Error ? e.message : "send threw" }; }
      const attempt: SendAttempt = { sendId: sha(key, o.sends.length), idempotencyKey: key, at: this.now(), channel: o.contact.channel, to: o.contact.address, status: result.status, providerMessageId: result.providerMessageId, detail: result.detail };
      rec = { ...this.get(prospectId), outreach: { ...this.get(prospectId).outreach!, sends: [...this.get(prospectId).outreach!.sends, attempt] } };
      this.store.prospects.set(prospectId, rec);
      if (result.status === "SENT") {
        rec = { ...rec, lastContactAt: attempt.at };
        this.store.prospects.set(prospectId, rec);
        rec = this.move(rec, "OUTREACH_SENT", "system:atlas", "approved outreach sent", `sent:${key}`);
        rec = this.move(rec, "RESPONSE_PENDING", "system:atlas", "awaiting a reply", `await-response:${key}`);
      }
      return { duplicate: false, attempt, prospect: rec };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Human-reported follow-up (the send itself happened outside Atlas or through the approved boundary). */
  recordFollowUp(prospectId: string, actor: string, key: string): ProspectRecord {
    const rec = this.get(prospectId);
    if (rec.state !== "RESPONSE_PENDING") throw new LifecycleError("invalid_transition", "follow-ups apply while awaiting a response");
    if (rec.history.some((h) => h.idempotencyKey === key)) return rec;
    const at = this.now();
    const next = { ...rec, followUps: rec.followUps + 1, lastContactAt: at, updatedAt: at, history: [...rec.history, { from: rec.state, to: rec.state, at, actor, reason: "follow-up recorded", idempotencyKey: key }] };
    this.store.prospects.set(prospectId, next);
    return next;
  }

  /** A reply (or its absence) reported by a human or an external-event reference. */
  recordResponse(prospectId: string, outcome: "ENGAGED" | "LOST" | "DORMANT", actor: string, note: string): ProspectRecord {
    const rec = this.get(prospectId);
    if (!nonEmpty(actor) || !nonEmpty(note)) throw new LifecycleError("invalid_input", "actor and note are required");
    return this.move(rec, outcome, actor, note, `response:${outcome}:${sha(note)}`);
  }

  /** Scope must come from the customer's stated requirements or a human author; AI-invented scope is refused. */
  prepareProposal(prospectId: string, input: { scope: ScopeItem[]; scopeSource: string; summary: string; priceUsd?: number | null }, preparedBy: string): ProspectRecord {
    const rec = this.get(prospectId);
    if (input.scopeSource !== "customer_requirements" && input.scopeSource !== "human_authored") throw new LifecycleError("scope_source_rejected", "proposal scope must come from customer requirements or a human, not AI generation");
    if (!input.scope.length || input.scope.some((i) => !nonEmpty(i.scopeItemId) || !nonEmpty(i.title))) throw new LifecycleError("invalid_scope", "scope items need an id and a title");
    if (new Set(input.scope.map((i) => i.scopeItemId)).size !== input.scope.length) throw new LifecycleError("invalid_scope", "scope item ids must be unique");
    const proposal: Proposal = { proposalId: `proposal:${prospectId}`, scope: input.scope.map((i) => ({ ...i })), scopeSource: input.scopeSource, summary: input.summary, priceUsd: input.priceUsd ?? null, preparedBy, isEvidence: false, preparedAt: this.now() };
    const moved = this.move(rec, "PROPOSAL_PREPARED", preparedBy, "proposal prepared", `proposal:${sha(proposal.scope, proposal.summary, proposal.priceUsd)}`);
    if (moved === rec) return rec;
    const next = { ...moved, proposal };
    this.store.prospects.set(prospectId, next);
    return next;
  }

  submitProposalForApproval(prospectId: string, approver: string): ProspectRecord {
    if (!isHuman(approver)) throw new LifecycleError("human_required", "a human must approve a proposal before it goes to the customer");
    const rec = this.get(prospectId);
    const moved = this.move(rec, "PROPOSAL_APPROVAL", approver, "proposal approved for presentation to the customer", `proposal-approved:${rec.proposal?.proposalId}`);
    if (moved === rec) return rec;
    const next = { ...moved, proposal: { ...moved.proposal!, approvedBy: approver } };
    this.store.prospects.set(prospectId, next);
    return next;
  }

  /** Atlas never commits the business contractually: a human records the customer's decision with a reference. */
  recordProposalDecision(prospectId: string, actor: string, accepted: boolean, reference: string): ProspectRecord {
    if (!isHuman(actor)) throw new LifecycleError("human_required", "only a human can record a customer's proposal decision");
    if (!nonEmpty(reference)) throw new LifecycleError("reference_required", "cite the customer's acceptance or rejection (message, signed document, call note)");
    const rec = this.get(prospectId);
    const moved = this.move(rec, accepted ? "WON" : "LOST", actor, accepted ? "customer accepted the proposal" : "customer declined the proposal", `decision:${accepted}:${sha(reference)}`);
    if (moved === rec || !accepted) return moved;
    const next = { ...moved, proposal: { ...moved.proposal!, acceptedBy: actor, acceptedAt: this.now(), acceptanceReference: reference } };
    this.store.prospects.set(prospectId, next);
    return next;
  }

  markDormant(prospectId: string, actor: string, reason: string): ProspectRecord {
    return this.move(this.get(prospectId), "DORMANT", actor, reason, `dormant:${sha(reason)}`);
  }
}
