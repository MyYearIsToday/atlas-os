import { newDb } from "pg-mem";
import { PostgresAtlasPersistence, connectPostgres, MIGRATIONS, type SqlClient } from "./atlas-persistence";
import { buildAtlas, stubCollectors } from "../../orchestrator/atlas-test-harness";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}`); if (!cond) failures++; };

const makeDb = () => {
  const adapter = newDb().adapters.createPg();
  return { adapter, connect: () => new PostgresAtlasPersistence(new adapter.Pool() as unknown as SqlClient) }; // a new instance == a new process
};
const { adapter, connect } = makeDb();

// --- Migrations are explicit, ordered and idempotent ---
{
  const p = connect();
  const first = await p.migrate();
  const second = await connect().migrate();
  const rows = (await new adapter.Pool().query("SELECT version, name FROM atlas_schema_migrations")).rows;
  check("first start applies migration 1; schema version is recorded", first.applied.join() === "1" && first.current === MIGRATIONS.length && rows.length === 1 && rows[0].name === MIGRATIONS[0].name);
  check("a second start applies nothing and destroys nothing", second.applied.length === 0);
}
{
  const p = connect();
  await p.migrate();
  p.put("business", "b1", { id: "b1", n: 1 });
  await p.flush();
  await connect().migrate(); // another process starting against existing data
  check("re-running migrations never deletes existing records", (await connect().loadAll("business")).length === 1);
}

// --- Primitive durability ---
{
  const p = connect();
  p.put("ledger", "t1", { amountMinor: 12345678901234567890n, nested: [{ v: 2n }] });
  p.put("business", "b1", { id: "b1", n: 2 }); // upsert replaces
  p.put("business", "b2", { id: "b2" });
  p.remove("business", "b2");
  p.markEvent("evt-1", 1000);
  p.markEvent("evt-1", 2000); // duplicate mark is harmless
  await p.flush();
  const fresh = connect();
  const ledger = await fresh.loadAll("ledger");
  const biz = await fresh.loadAll("business");
  check("BigInt values survive the round trip exactly", ledger[0].doc.amountMinor === 12345678901234567890n && ledger[0].doc.nested[0].v === 2n);
  check("upsert replaces, remove deletes", biz.length === 1 && biz[0].doc.n === 2);
  const events = await fresh.loadEvents();
  check("processed events are stored once", events.length === 1 && events[0].eventId === "evt-1" && events[0].processedAtMs === 1000);
}

// --- Failures are never silent ---
{
  const broken = new PostgresAtlasPersistence({ query: async (t: string) => { if (/INSERT INTO atlas_documents/.test(t)) throw new Error("db down"); return { rows: [] }; } });
  broken.put("business", "b1", {});
  await broken.flush();
  const h = broken.health();
  check("a failed write is counted and surfaced through health()", !h.ok && h.failedWrites === 1 && h.lastError === "db down" && h.pendingWrites === 0);
  const badMigration = new PostgresAtlasPersistence({ query: async () => { throw new Error("no permission"); } });
  check("a failing migration rejects instead of continuing", await badMigration.migrate().then(() => false, (e) => /no permission/.test(e.message)));
  check("production requires DATABASE_URL: there is no in-memory fallback", await connectPostgres(undefined).then(() => false, (e) => /DATABASE_URL is required/.test(e.message)));
}

// --- Full pipeline durability across a restart (its own database) ---
const { connect: connectPipelineDb } = makeDb();
const p1 = connectPipelineDb();
await p1.migrate();
const a1 = await buildAtlas({ executionEnabled: true, persistence: p1, collectors: stubCollectors() });
const result = await a1.submit("Durable Acceptance Cafe", { notes: "restart test" });
await p1.flush();
const businessId = result.ok ? result.outcome.businessId : "";
const before = {
  tasks: a1.deps.missionQueue.getSnapshot(), score: a1.deps.store.scores.get(businessId), audit: a1.deps.store.audits.get(businessId),
  observations: a1.deps.store.observations.get(businessId)!, ledger: a1.ledger.list(), outputs: [...a1.deps.store.missionOutputs.keys()], trace: a1.deps.store.trace.length,
};
check("pre-restart: business scored numerically from real evidence, audited, summary mission auto-executed, follow-ups pending approval", typeof before.score?.overallScore === "number" && !!before.audit && before.tasks.some((t) => t.missionType === "internal_audit_summary" && t.status === "Completed") && before.tasks.some((t) => t.approvalRequired === "Approval Required" && t.status === "Pending") && before.ledger.length === 1);

// ---- restart: nothing from a1 is reused; only the database survives ----
const p2 = connectPipelineDb();
await p2.migrate();
const a2 = await buildAtlas({ executionEnabled: true, persistence: p2, collectors: stubCollectors(), ai: { fail: false, calls: 0 } });
check("hydration restored every collection it should", a2.hydrated.businesses === 1 && a2.hydrated.observations === 1 && a2.hydrated.scores === 1 && a2.hydrated.audits === 1 && a2.hydrated.missions === before.tasks.length && a2.hydrated.ledger === 1 && a2.hydrated.started === 1 && (a2.hydrated.processedEvents ?? 0) > 0);
check("the Scout business and its external-key index survive (rediscovery updates, never duplicates)", a2.repository.list().length === 1 && !!a2.repository.findByExternalKey("manual", "durable acceptance cafe|accra, ghana"));
check("evidence with provenance survives intact", JSON.stringify(a2.deps.store.observations.get(businessId)) === JSON.stringify(before.observations) && a2.deps.store.observations.get(businessId)!.every((r) => !!r.sourceUrl && !!r.observedAt));
check("score and audit survive", JSON.stringify(a2.deps.store.scores.get(businessId)) === JSON.stringify(before.score) && a2.deps.store.audits.get(businessId)?.auditId === before.audit?.auditId);
check("missions survive with status, approval requirement, type and execution history", JSON.stringify(a2.deps.missionQueue.getSnapshot().map((t) => [t.taskId, t.status, t.approvalRequired, t.missionType, t.executionHistory.length]).sort()) === JSON.stringify(before.tasks.map((t) => [t.taskId, t.status, t.approvalRequired, t.missionType, t.executionHistory.length]).sort()));
check("AI-cost ledger entries survive with exact amounts", a2.ledger.list().length === 1 && JSON.stringify(a2.ledger.list(), (_k, v) => (typeof v === "bigint" ? v.toString() : v)) === JSON.stringify(before.ledger, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
check("AI work product survives and is still flagged isEvidence=false", a2.deps.store.missionOutputs.size === before.outputs.length && [...a2.deps.store.missionOutputs.values()].every((o) => o.isEvidence === false));
check("the trace is restored", a2.deps.store.trace.length >= before.trace);
const eventIds = (await p2.loadEvents()).map((e) => e.eventId);
check("processed event IDs are durable: the new process already treats them as processed", eventIds.length > 0 && eventIds.every((id) => a2.orchestrator.processedEvents.hasProcessed(id)));

// ---- duplicate replay after restart ----
const tasksBefore = a2.deps.missionQueue.getSnapshot().length;
const replay = await a2.submit("Durable Acceptance Cafe", { notes: "restart test" });
check("replaying the same business after restart updates it and creates no second business, audit, mission, AI call or ledger entry", replay.ok && replay.outcome.action === "UPDATED_EXISTING" && replay.outcome.businessId === businessId && a2.repository.list().length === 1 && a2.deps.store.audits.size === 1 && a2.deps.missionQueue.getSnapshot().length === tasksBefore && a2.ai.calls === 0 && a2.ledger.list().length === 1);

// ---- the human boundary survives the restart too ----
{
  const pending = a2.deps.missionQueue.getSnapshot().find((t) => t.approvalRequired === "Approval Required")!;
  const blocked = await a2.runner.run(pending.taskId, {});
  const approved = await a2.runner.run(pending.taskId, { approvedByHuman: true });
  await p2.flush();
  check("after restart an approval-required mission is still blocked until approved, then executes and bills once", !blocked.executed && approved.executed && a2.ai.calls === 1 && a2.ledger.list().length === 2);
  const a3 = await buildAtlas({ executionEnabled: true, persistence: connectPipelineDb(), collectors: stubCollectors() });
  check("a second restart sees the approved execution and the new cost entry", a3.deps.missionQueue.getSnapshot().find((t) => t.taskId === pending.taskId)?.status === "Completed" && a3.ledger.list().length === 2);
}
check("no write failed during the whole run", p1.health().ok && p2.health().ok);

console.log(failures === 0 ? "\nALL PERSISTENCE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
