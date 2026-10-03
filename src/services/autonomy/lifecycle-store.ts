import type { AtlasPersistence, Collection } from "../persistence/atlas-persistence";
import type { ProspectRecord } from "./prospects";
import type { Engagement } from "./delivery";
import type { Decision } from "./controller";

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

  constructor(private persistence?: AtlasPersistence) {
    const bind = <V,>(c: Collection) => new DurableMap<V>((id, v) => persistence?.put(c, id, v));
    this.prospects = bind("prospect");
    this.engagements = bind("engagement");
    this.decisions = bind("decision");
  }

  async hydrate(): Promise<{ prospects: number; engagements: number; decisions: number }> {
    const p = this.persistence;
    if (!p) return { prospects: 0, engagements: 0, decisions: 0 };
    const [pr, en, de] = await Promise.all([p.loadAll("prospect"), p.loadAll("engagement"), p.loadAll("decision")]);
    pr.forEach((r) => this.prospects.restore(r.id, r.doc));
    en.forEach((r) => this.engagements.restore(r.id, r.doc));
    de.forEach((r) => this.decisions.restore(r.id, r.doc));
    return { prospects: pr.length, engagements: en.length, decisions: de.length };
  }
}
