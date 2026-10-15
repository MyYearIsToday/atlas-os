import test from "node:test";
import assert from "node:assert/strict";
import { handleWorkspaceRequest } from "./workspace-store";
import type { AtlasPersistence, Collection } from "../../src/services/persistence/atlas-persistence";

/** Minimal in-memory AtlasPersistence with failure injection (mirrors put/remove/flush/health semantics). */
function fakePersistence(opts: { failWrites?: boolean } = {}) {
  const docs = new Map<string, unknown>();
  let failed = 0;
  let lastError: string | null = null;
  const p = {
    put(c: Collection, id: string, doc: unknown) { if (opts.failWrites) { failed++; lastError = "connection refused"; return; } docs.set(`${c}/${id}`, JSON.parse(JSON.stringify(doc))); },
    remove(c: Collection, id: string) { if (opts.failWrites) { failed++; lastError = "connection refused"; return; } docs.delete(`${c}/${id}`); },
    async loadAll(c: Collection) { return [...docs.entries()].filter(([k]) => k.startsWith(`${c}/`)).map(([k, doc]) => ({ id: k.split("/")[1], doc })); },
    async flush() {},
    health() { return { ok: failed === 0, failedWrites: failed, lastError, pendingWrites: 0 }; },
    async migrate() { return { applied: [], current: 1 }; }, markEvent() {}, async loadEvents() { return []; }, async close() {},
  } as unknown as AtlasPersistence;
  return { p, docs };
}
const call = (p: AtlasPersistence | null, method: string, path: string, body?: unknown, secret = true) =>
  handleWorkspaceRequest(method, path, async () => body, { persistence: p, secretConfigured: secret });

test("no PostgreSQL persistence: status says durable=false, collection routes answer 503, nothing stored", async () => {
  const status = await call(null, "GET", "/api/workspace/status");
  assert.equal((status.body as any).durable, false);
  const list = await call(null, "GET", "/api/workspace/leads");
  assert.equal(list.status, 503);
  assert.equal((list.body as any).error.code, "postgres_not_configured");
});

test("persistence present but no shared secret: fail closed", async () => {
  const { p } = fakePersistence();
  assert.equal((await call(p, "GET", "/api/workspace/leads", undefined, false)).status, 503);
  assert.equal(((await call(p, "GET", "/api/workspace/status", undefined, false)).body as any).durable, false);
});

test("save, list and delete round-trip into workspace_* collections; createdAt preserved", async () => {
  const { p, docs } = fakePersistence();
  assert.equal(((await call(p, "GET", "/api/workspace/status")).body as any).durable, true);
  const saved = await call(p, "POST", "/api/workspace/leads/save", { record: { id: "lead-1", name: "Ama" } });
  assert.equal(saved.status, 200);
  assert.ok(docs.has("workspace_leads/lead-1"));
  const created = (saved.body as any).item.createdAt;
  await call(p, "POST", "/api/workspace/leads/save", { record: { id: "lead-1", name: "Ama K", createdAt: created } });
  const list = (await call(p, "GET", "/api/workspace/leads")).body as any;
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].name, "Ama K");
  assert.equal(list.items[0].createdAt, created);
  assert.equal((await call(p, "POST", "/api/workspace/leads/delete", { id: "lead-1" })).status, 200);
  assert.deepEqual((await call(p, "GET", "/api/workspace/leads")).body, { items: [] });
});

test("a failed PostgreSQL write is reported as 502, never as saved", async () => {
  const { p } = fakePersistence({ failWrites: true });
  const res = await call(p, "POST", "/api/workspace/clients/save", { record: { id: "c1", name: "X" } });
  assert.equal(res.status, 502);
  assert.equal((res.body as any).error.code, "postgres_write_failed");
  assert.equal((await call(p, "POST", "/api/workspace/clients/delete", { id: "c1" })).status, 502);
});

test("validation: unknown collection, bad id, non-object record, wrong method, bad JSON", async () => {
  const { p } = fakePersistence();
  assert.equal((await call(p, "GET", "/api/workspace/secrets")).status, 404);
  assert.equal((await call(p, "POST", "/api/workspace/leads/save", { record: { id: "../x" } })).status, 400);
  assert.equal((await call(p, "POST", "/api/workspace/leads/save", { record: "nope" })).status, 400);
  assert.equal((await call(p, "POST", "/api/workspace/leads/delete", { id: 5 })).status, 400);
  assert.equal((await call(p, "GET", "/api/workspace/leads/save")).status, 405);
  const bad = await handleWorkspaceRequest("POST", "/api/workspace/leads/save", async () => { throw new SyntaxError("x"); }, { persistence: p, secretConfigured: true });
  assert.equal(bad.status, 400);
});
