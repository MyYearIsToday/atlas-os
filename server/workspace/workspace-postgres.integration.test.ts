/**
 * Real-PostgreSQL round trip for workspace persistence. Skipped unless ATLAS_TEST_DATABASE_URL is set.
 * Run against a THROWAWAY or dev database: it creates then deletes one record per run (and creates the Atlas tables if absent).
 *   ATLAS_TEST_DATABASE_URL=postgres://... npm run test:workspace:pg
 */
import test from "node:test";
import assert from "node:assert/strict";
import { connectPostgres, type PostgresAtlasPersistence } from "../../src/services/persistence/atlas-persistence";
import { handleWorkspaceRequest } from "./workspace-store";

const call = (p: PostgresAtlasPersistence, method: string, path: string, body?: unknown) =>
  handleWorkspaceRequest(method, path, async () => body, { persistence: p, secretConfigured: true });

/** Each `open()` is a fresh connection + persistence instance, i.e. what a backend restart does. */
export async function workspaceRoundTrip(open: () => Promise<PostgresAtlasPersistence>) {
  const id = `it-${Date.now().toString(36)}`;
  const p1 = await open();
  await p1.migrate();
  const again = await p1.migrate();
  assert.deepEqual(again.applied, [], "migrations must be idempotent");

  const created = await call(p1, "POST", "/api/workspace/leads/save", { record: { id, name: "Ama" } });
  assert.equal(created.status, 200);
  const createdAt = (created.body as any).item.createdAt;
  let list = (await call(p1, "GET", "/api/workspace/leads")).body as any;
  assert.equal(list.items.find((r: any) => r.id === id)?.name, "Ama");

  await call(p1, "POST", "/api/workspace/leads/save", { record: { id, name: "Ama K", createdAt } });
  list = (await call(p1, "GET", "/api/workspace/leads")).body as any;
  const rows = list.items.filter((r: any) => r.id === id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Ama K");
  assert.equal(rows[0].createdAt, createdAt);
  await p1.close();

  const p2 = await open(); // simulated restart
  assert.deepEqual((await p2.migrate()).applied, []);
  list = (await call(p2, "GET", "/api/workspace/leads")).body as any;
  assert.equal(list.items.find((r: any) => r.id === id)?.name, "Ama K", "record must survive a restart");
  assert.equal((await call(p2, "POST", "/api/workspace/leads/delete", { id })).status, 200);
  await p2.close();

  const p3 = await open();
  list = (await call(p3, "GET", "/api/workspace/leads")).body as any;
  assert.ok(!list.items.some((r: any) => r.id === id), "deleted record must stay deleted");
  await p3.close();
}

const url = process.env.ATLAS_TEST_DATABASE_URL;
test("workspace persistence round trip on real PostgreSQL", { skip: !url }, async () => {
  await workspaceRoundTrip(() => connectPostgres(url));
});
