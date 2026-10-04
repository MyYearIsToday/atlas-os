import { createHash } from "node:crypto";
import type { OperationalLedger } from "../finance/ledger";
import { money, toDecimal } from "../finance/money";
import { reconcile } from "../finance/reconciliation";
import type { FinancialTransaction, Money, ReconciliationRecord } from "../finance/finance-types";
import { LifecycleError, type ProspectService } from "./prospects";
import type { Engagement } from "./delivery";
import type { LifecycleStore } from "./lifecycle-store";

/**
 * Revenue lifecycle (Objective 7).
 *
 *  INVOICE_ELIGIBLE -> PREPARED -> SENT -> PAYMENT_PENDING -> PAYMENT_RECORDED -> PAYMENT_RECONCILED
 *
 * These are OPERATIONAL states, not accounting claims, and they are deliberately separate from
 * FinancialTransaction.status. Nothing before PAYMENT_RECORDED is revenue. Revenue exists only as a payment
 * a human recorded (amount, currency, external reference, received time, actor), posted to the EXISTING
 * OperationalLedger as a REVENUE inflow. Atlas never invents an amount (the accepted proposal's price is the
 * only source), never authorizes or moves money, never refunds, never changes pricing, and never reconciles
 * a payment that is not backed by a ledger entry and a human-supplied external amount and reference.
 * There is no payment-provider integration; invoices are internal records, not documents that Atlas sends.
 */
export type InvoiceState = "INVOICE_ELIGIBLE" | "PREPARED" | "SENT" | "PAYMENT_PENDING" | "PAYMENT_RECORDED" | "PAYMENT_RECONCILED";

export const INVOICE_TRANSITIONS: Record<InvoiceState, InvoiceState[]> = {
  INVOICE_ELIGIBLE: ["PREPARED"], PREPARED: ["SENT"], SENT: ["PAYMENT_PENDING"], PAYMENT_PENDING: ["PAYMENT_RECORDED"],
  PAYMENT_RECORDED: ["PAYMENT_RECONCILED"], PAYMENT_RECONCILED: [],
};
export const REVENUE_PRODUCT_ID = "MapSpark";
export const REVENUE_CATEGORY = "CLIENT_PAYMENT";

export interface PaymentRecord {
  paymentId: string; invoiceId: string; engagementId: string; businessId: string; amount: Money; reference: string; receivedAt: string;
  recordedAt: string; recordedBy: string; transactionId: string; reconciliation?: ReconciliationRecord; reconciledBy?: string;
}
export interface InvoiceEvent { from: InvoiceState | null; to: InvoiceState; at: string; actor: string; reason: string }
export interface Invoice {
  invoiceId: string; engagementId: string; prospectId: string; businessId: string; proposalId: string; state: InvoiceState; amount: Money;
  sentReference?: string; history: InvoiceEvent[]; payments: PaymentRecord[]; createdAt: string; updatedAt: string;
}

const sha = (...p: unknown[]) => createHash("sha256").update(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).digest("hex");
const isHuman = (a: string) => /^human:.+/.test(a);
const needHuman = (a: string, what: string) => { if (!isHuman(a)) throw new LifecycleError("human_required", `${what} must be recorded by a human actor (human:<id>)`); };

export type Eligibility = { eligible: true; amount: Money; proposalId: string } | { eligible: false; code: "not_complete" | "no_accepted_proposal" | "no_accepted_price"; reason: string };

/** Pure: may an invoice exist for this engagement? The amount is read from the ACCEPTED proposal, never computed or guessed. */
export function assessInvoiceEligibility(engagement: Engagement, prospect: { proposal?: { proposalId: string; priceUsd: number | null; acceptedBy?: string } } | null): Eligibility {
  if (engagement.state !== "COMPLETE") return { eligible: false, code: "not_complete", reason: `engagement is ${engagement.state}, not COMPLETE` };
  const p = prospect?.proposal;
  if (!p?.acceptedBy) return { eligible: false, code: "no_accepted_proposal", reason: "no accepted proposal on record" };
  const price = p.priceUsd;
  const minor = typeof price === "number" ? Math.round(price * 100) : NaN;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - minor) > 1e-6) {
    return { eligible: false, code: "no_accepted_price", reason: "the accepted proposal has no usable price; a human must settle pricing (Atlas will not invent an amount)" };
  }
  return { eligible: true, amount: money(BigInt(minor), "USD", 2), proposalId: p.proposalId };
}

export const invoiceVersion = (i: Invoice) => sha(i.invoiceId, i.amount, i.state);
export const sumMoney = (list: Money[]): Record<string, string> => {
  const totals = new Map<string, Money>();
  for (const m of list) { const cur = totals.get(m.currency); totals.set(m.currency, cur ? money(cur.minorUnits + m.minorUnits, m.currency, m.scale) : m); }
  return Object.fromEntries([...totals].map(([c, m]) => [c, toDecimal(m)]));
};

export class RevenueService {
  constructor(private store: LifecycleStore, private prospects: ProspectService, private ledger: OperationalLedger, private now: () => string = () => new Date().toISOString()) {}

  get(invoiceId: string) { const i = this.store.invoices.get(invoiceId); if (!i) throw new LifecycleError("not_found", `unknown invoice ${invoiceId}`); return i; }
  private save(i: Invoice, patch: Partial<Invoice> = {}) { const next = { ...i, ...patch, updatedAt: this.now() }; this.store.invoices.set(i.invoiceId, next); return next; }
  private move(i: Invoice, to: InvoiceState, actor: string, reason: string, patch: Partial<Invoice> = {}): Invoice {
    if (!INVOICE_TRANSITIONS[i.state].includes(to)) throw new LifecycleError("invalid_transition", `${i.state} -> ${to} is not allowed`);
    return this.save(i, { ...patch, state: to, history: [...i.history, { from: i.state, to, at: this.now(), actor, reason }] });
  }

  /** Atlas may determine eligibility on its own; this creates only the INVOICE_ELIGIBLE record. Idempotent. */
  createEligible(engagement: Engagement, actor: string): Invoice {
    const invoiceId = `invoice:${engagement.engagementId}`;
    const existing = this.store.invoices.get(invoiceId);
    if (existing) return existing;
    const e = assessInvoiceEligibility(engagement, this.prospects.get(engagement.prospectId));
    if (!e.eligible) throw new LifecycleError(e.code, e.reason);
    const at = this.now();
    const invoice: Invoice = { invoiceId, engagementId: engagement.engagementId, prospectId: engagement.prospectId, businessId: engagement.businessId, proposalId: e.proposalId, state: "INVOICE_ELIGIBLE", amount: e.amount, history: [{ from: null, to: "INVOICE_ELIGIBLE", at, actor, reason: "engagement complete with an accepted price" }], payments: [], createdAt: at, updatedAt: at };
    this.store.invoices.set(invoiceId, invoice);
    return invoice;
  }

  prepare(invoiceId: string, actor: string): Invoice {
    needHuman(actor, "invoice preparation");
    const i = this.get(invoiceId);
    return i.state === "PREPARED" ? i : this.move(i, "PREPARED", actor, "invoice prepared by a human");
  }

  /** A human records that the invoice was sent outside Atlas. Atlas sends nothing. SENT is recorded, then payment is awaited. */
  markSent(invoiceId: string, actor: string, reference: string): Invoice {
    needHuman(actor, "invoice sending");
    if (!reference.trim()) throw new LifecycleError("reference_required", "describe how the invoice was sent (email, hand delivery, portal)");
    const i = this.get(invoiceId);
    if (i.state === "SENT" || i.state === "PAYMENT_PENDING") return i;
    const sent = this.move(i, "SENT", actor, `invoice sent: ${reference}`, { sentReference: reference });
    return this.move(sent, "PAYMENT_PENDING", "system:atlas", "awaiting payment");
  }

  /** The only way revenue enters Atlas: a human-recorded, real payment. Idempotent on (invoice, external reference). */
  recordPayment(invoiceId: string, input: { amountMinorUnits: string | bigint; currency: string; reference: string; receivedAt: string }, actor: string): { payment: PaymentRecord; duplicate: boolean; invoice: Invoice } {
    needHuman(actor, "a payment");
    const i = this.get(invoiceId);
    const reference = input.reference?.trim();
    if (!reference) throw new LifecycleError("reference_required", "an external payment reference is required");
    const paymentId = `payment:${sha(invoiceId, reference).slice(0, 32)}`;
    const dup = i.payments.find((p) => p.paymentId === paymentId);
    if (dup) return { payment: dup, duplicate: true, invoice: i };
    if (i.state !== "PAYMENT_PENDING" && i.state !== "PAYMENT_RECORDED") throw new LifecycleError("invalid_transition", `payments are recorded against a sent invoice (state is ${i.state})`);
    let minor: bigint;
    try { minor = BigInt(input.amountMinorUnits); } catch { throw new LifecycleError("invalid_amount", "amountMinorUnits must be an integer"); }
    if (minor <= 0n) throw new LifecycleError("invalid_amount", "payment amount must be positive");
    const currency = String(input.currency ?? "").toUpperCase();
    if (currency !== i.amount.currency) throw new LifecycleError("currency_mismatch", `invoice is in ${i.amount.currency}; Atlas does not convert currencies`);
    const received = Date.parse(input.receivedAt);
    if (!Number.isFinite(received) || received > Date.parse(this.now()) + 24 * 3_600_000) throw new LifecycleError("invalid_received_at", "receivedAt must be a valid time that is not in the future");
    const amount = money(minor, currency, i.amount.scale);
    const transactionId = `txn:${paymentId}`;
    const at = this.now();
    if (!this.ledger.list().some((t) => t.transactionId === transactionId)) {
      const txn: FinancialTransaction = {
        transactionId, transactionType: "REVENUE", transactionDate: new Date(received).toISOString().slice(0, 10), recordedAt: at, amount, direction: "INFLOW", status: "POSTED",
        category: REVENUE_CATEGORY, productId: REVENUE_PRODUCT_ID, clientId: i.businessId, description: `Payment received for ${i.invoiceId} (ref ${reference})`,
        evidenceRefs: [`payment-ref:${reference}`, i.invoiceId], verificationStatus: "UNVERIFIED", approvalStatus: "NOT_REQUIRED", createdBy: actor, updatedAt: at,
      } as FinancialTransaction;
      this.ledger.post(txn, actor);
    }
    const payment: PaymentRecord = { paymentId, invoiceId, engagementId: i.engagementId, businessId: i.businessId, amount, reference, receivedAt: new Date(received).toISOString(), recordedAt: at, recordedBy: actor, transactionId };
    const withPayment = this.save(i, { payments: [...i.payments, payment] });
    const next = withPayment.state === "PAYMENT_PENDING" ? this.move(withPayment, "PAYMENT_RECORDED", actor, `payment recorded (ref ${reference})`) : withPayment;
    return { payment, duplicate: false, invoice: next };
  }

  /**
   * Reconciles ONE recorded payment against an external amount and reference supplied by a human, using the existing
   * reconcile(). A payment with no ledger entry, or without an external reference, cannot be reconciled. The invoice
   * becomes PAYMENT_RECONCILED only when matched payments cover the invoice amount.
   */
  reconcilePayment(invoiceId: string, paymentId: string, input: { externalAmountMinorUnits: string | bigint; externalReference: string }, actor: string): Invoice {
    needHuman(actor, "reconciliation");
    const i = this.get(invoiceId);
    const p = i.payments.find((x) => x.paymentId === paymentId);
    if (!p) throw new LifecycleError("not_found", `unknown payment ${paymentId}`);
    if (p.reconciliation) return i;
    if (!input.externalReference?.trim()) throw new LifecycleError("reference_required", "an external statement reference is required to reconcile");
    const txn = this.ledger.list().find((t) => t.transactionId === p.transactionId);
    if (!txn) throw new LifecycleError("unsupported_payment", "this payment has no ledger entry and cannot be reconciled");
    let external: bigint;
    try { external = BigInt(input.externalAmountMinorUnits); } catch { throw new LifecycleError("invalid_amount", "externalAmountMinorUnits must be an integer"); }
    const record = reconcile(txn, money(external, p.amount.currency, p.amount.scale), input.externalReference.trim(), [`payment-ref:${p.reference}`]);
    const payments = i.payments.map((x) => (x.paymentId === paymentId ? { ...x, reconciliation: record, reconciledBy: actor } : x));
    const matched = payments.filter((x) => x.reconciliation?.status === "MATCHED").reduce((n, x) => n + x.amount.minorUnits, 0n);
    const saved = this.save(i, { payments });
    return matched >= i.amount.minorUnits && saved.state === "PAYMENT_RECORDED" ? this.move(saved, "PAYMENT_RECONCILED", actor, "recorded payments match the external statement") : saved;
  }

  /** Revenue is the sum of recorded payments. Prepared / sent / pending invoices are reported separately and are never revenue. */
  summary(): { receivedRevenue: Record<string, string>; paymentCount: number; notRevenue: Record<InvoiceState, { count: number; amount: Record<string, string> }> } {
    const invoices = [...this.store.invoices.values()];
    const states = Object.keys(INVOICE_TRANSITIONS) as InvoiceState[];
    const notRevenue = Object.fromEntries(states.map((s) => [s, { count: invoices.filter((i) => i.state === s).length, amount: sumMoney(invoices.filter((i) => i.state === s && s !== "PAYMENT_RECONCILED").map((i) => i.amount)) }])) as Record<InvoiceState, { count: number; amount: Record<string, string> }>;
    const payments = invoices.flatMap((i) => i.payments);
    return { receivedRevenue: sumMoney(payments.map((p) => p.amount)), paymentCount: payments.length, notRevenue };
  }
}
