import type { AtlasPersistence, Collection } from "../persistence/atlas-persistence";
import type { ProspectRecord } from "./prospects";
import type { Engagement } from "./delivery";
import type { Decision } from "./controller";
import type { Invoice } from "./revenue";
import type { ApprovalRecord } from "./approvals";
import type { AutonomyCycle, DecisionExecution, BreakerState } from "./loop";

/** A Map that mirrors every write to durable storage. Hydration fills it without writing back. */
class DurableMap<V> extends Map<string, V> {
  constructor(private persist: (id: string, value: V) => void) { super(); }
  set(key: string, value: V) { super.set(key, value); this.persist(key, value); return this; }
  restore(key: string, value: V) { super.set(key, value); }
}

/** Durable state for the autonomy lifecycles: prospects (Obj 5), engagements (Obj 6), controller decisions (Obj 4). */
export class LifecycleStore {
  readonly prospects: DurableMap<ProspectRecord>;
  readonly engagements: DurableMap<Engagement>;
  readonly decisions: DurableMap<Decision>;
  readonly invoices: DurableMap<Invoice>;
  readonly approvals: DurableMap<ApprovalRecord>;
  readonly cycles: DurableMap<AutonomyCycle>;
  readonly executions: DurableMap<DecisionExecution>;
  /** Single-row circuit-breaker state (durable so a restart cannot silently close an open breaker). */
  breaker: BreakerState = { state: "CLOSED", consecutiveFailures: 0, openedAt: null, lastFailureAt: null };

  constructor(private persistence?: AtlasPersistence) {
    const bind = <V,>(c: Collection) => new DurableMap<V>((id, v) => persistence?.put(c, id, v));
    this.prospects = bind("prospect");
    this.engagements = bind("engagement");
    this.decisions = bind("decision");
    this.invoices = bind("invoice");
    this.approvals = bind("approval");
    this.cycles = bind("cycle");
    this.executions = bind("decision_exec");
  }

  saveBreaker(next: BreakerState): void { this.breaker = next; this.persistence?.put("autonomy_state", "breaker", next); }

  async hydrate(): Promise<{ prospects: number; engagements: number; decisions: number; invoices: number; approvals: number; cycles: number; executions: number }> {
    const p = this.persistence;
    if (!p) return { prospects: 0, engagements: 0, decisions: 0, invoices: 0, approvals: 0, cycles: 0, executions: 0 };
    const [pr, en, de, inv, ap, cy, ex, br] = await Promise.all([p.loadAll("prospect"), p.loadAll("engagement"), p.loadAll("decision"), p.loadAll("invoice"), p.loadAll("approval"), p.loadAll("cycle"), p.loadAll("decision_exec"), p.loadAll("autonomy_state")]);
    inv.forEach((r) => this.invoices.restore(r.id, r.doc));
    ap.forEach((r) => this.approvals.restore(r.id, r.doc));
    cy.forEach((r) => this.cycles.restore(r.id, r.doc));
    ex.forEach((r) => this.executions.restore(r.id, r.doc));
    const savedBreaker = br.find((r) => r.id === "breaker");
    if (savedBreaker) this.breaker = savedBreaker.doc;
    pr.forEach((r) => this.prospects.restore(r.id, r.doc));
    en.forEach((r) => this.engagements.restore(r.id, r.doc));
    de.forEach((r) => this.decisions.restore(r.id, r.doc));
    return { prospects: pr.length, engagements: en.length, decisions: de.length, invoices: inv.length, approvals: ap.length, cycles: cy.length, executions: ex.length };
  }
}
