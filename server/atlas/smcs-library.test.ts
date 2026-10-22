import test from "node:test";
import assert from "node:assert/strict";
import { handleSmcsRequest, assessDuplicates, type CampaignReference } from "./smcs-library";
import type { AtlasPersistence, Collection } from "../../src/services/persistence/atlas-persistence";

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
  } as unknown as AtlasPersistence;
  return { p, docs };
}

const call = (p: AtlasPersistence | null, method: string, path: string, body?: unknown, secret = true, query = "") =>
  handleSmcsRequest(method, path, new URLSearchParams(query), async () => body, { persistence: p, secretConfigured: secret });

const record = (extra: Record<string, unknown> = {}) => ({ title: "Mesa launch film", brand: "Mesa UGBS", industry: "education", platform: "instagram", sourceUrl: "https://example.com/mesa", ...extra });

test("no PostgreSQL or no shared secret: library stays closed", async () => {
  assert.equal((await call(null, "GET", "/api/smcs/references")).status, 503);
  assert.equal(((await call(null, "GET", "/api/smcs/status")).body as { durable: boolean }).durable, false);
  const { p } = fakePersistence();
  assert.equal((await call(p, "POST", "/api/smcs/references", { record: record() }, false)).status, 503);
});

test("create validates required metadata, refuses performance figures, and defaults license to unknown", async () => {
  const { p, docs } = fakePersistence();
  const missing = await call(p, "POST", "/api/smcs/references", { record: { brand: "Mesa" } });
  assert.equal(missing.status, 400);
  assert.equal((missing.body as { error: { fields: Array<{ field: string }> } }).error.fields[0].field, "title");
  const figures = await call(p, "POST", "/api/smcs/references", { record: record({ roi: "10x" }) });
  assert.equal(figures.status, 400);
  assert.match((figures.body as { error: { fields: Array<{ message: string }> } }).error.fields[0].message, /Performance figures/);
  const created = await call(p, "POST", "/api/smcs/references", { record: record({ licenseStatus: "licensed", hook: "Students, this is yours" }) });
  assert.equal(created.status, 201);
  const item = (created.body as { item: CampaignReference }).item;
  assert.equal(item.reviewStatus, "candidate");
  assert.equal(item.licenseStatus, "licensed");
  assert.equal(item.version, 1);
  assert.equal(item.hook, "Students, this is yours");
  assert.equal(docs.size, 1);
  assert.equal((await call(p, "POST", "/api/smcs/references", { record: record({ reviewStatus: "approved" }) })).status, 400);
});

test("likely duplicates are blocked until acknowledged; possible matches are reported", async () => {
  const { p } = fakePersistence();
  const first = (await call(p, "POST", "/api/smcs/references", { record: record() })).body as { item: CampaignReference };
  const blocked = await call(p, "POST", "/api/smcs/references", { record: record({ title: "Mesa launch film" }) });
  assert.equal(blocked.status, 409);
  assert.equal((blocked.body as { error: { code: string } }).error.code, "likely_duplicate");
  const kept = await call(p, "POST", "/api/smcs/references", { record: { ...record(), title: "A different mesa story", sourceUrl: "https://other.example/a" }, acknowledgeDuplicate: false });
  assert.equal(kept.status, 201);
  const dup = await call(p, "POST", "/api/smcs/references/duplicates", { record: { title: "Mesa launch film", brand: "Mesa UGBS" } });
  const matches = (dup.body as { duplicates: Array<{ id: string; level: string }> }).duplicates;
  assert.equal(matches[0].id, first.item.id);
  assert.equal(matches[0].level, "likely");
});

test("list filters, searches, sorts and paginates; retrieval returns approved only", async () => {
  const { p } = fakePersistence();
  const a = (await call(p, "POST", "/api/smcs/references", { record: record({ title: "Alpha film", brand: "Alpha", industry: "food" }) })).body as { item: CampaignReference };
  const b = (await call(p, "POST", "/api/smcs/references", { record: { title: "Beta radio", brand: "Beta", industry: "education", tags: ["radio"] } })).body as { item: CampaignReference };
  await call(p, "POST", "/api/smcs/references/review", { id: a.item.id, decision: "approved", reviewedBy: "Kofi" });
  const eligible = await call(p, "GET", "/api/smcs/references", undefined, true, "eligible=1");
  const eligibleItems = (eligible.body as { items: CampaignReference[]; eligibleOnly: boolean }).items;
  assert.equal(eligibleItems.length, 1);
  assert.equal(eligibleItems[0].reviewStatus, "approved");
  assert.equal((eligible.body as { eligibleOnly: boolean }).eligibleOnly, true);
  const filtered = await call(p, "GET", "/api/smcs/references", undefined, true, "industry=education&q=radio&tag=radio&sort=title&order=asc");
  assert.deepEqual((filtered.body as { items: CampaignReference[] }).items.map((i) => i.id), [b.item.id]);
  const page = await call(p, "GET", "/api/smcs/references", undefined, true, "pageSize=1&page=2&sort=title&order=asc");
  const body = page.body as { items: CampaignReference[]; total: number; page: number };
  assert.equal(body.total, 2);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].title, "Beta radio");
  const one = await call(p, "GET", `/api/smcs/references/${a.item.id}`);
  assert.equal((one.body as { item: CampaignReference }).item.reviewedBy, "Kofi");
});

test("update bumps version, rejects a stale version, and delete removes the row", async () => {
  const { p, docs } = fakePersistence();
  const created = (await call(p, "POST", "/api/smcs/references", { record: record() })).body as { item: CampaignReference };
  const stale = await call(p, "POST", "/api/smcs/references/update", { id: created.item.id, record: { hook: "New hook" }, expectedVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { error: { code: string } }).error.code, "stale_version");
  const updated = await call(p, "POST", "/api/smcs/references/update", { id: created.item.id, record: { hook: "New hook", concept: null }, expectedVersion: 1 });
  const item = (updated.body as { item: CampaignReference }).item;
  assert.equal(updated.status, 200);
  assert.equal(item.version, 2);
  assert.equal(item.hook, "New hook");
  assert.equal(item.title, "Mesa launch film");
  assert.equal(item.createdAt, created.item.createdAt);
  const rejected = await call(p, "POST", "/api/smcs/references/review", { id: item.id, decision: "rejected", note: "Not a reference we can learn from" });
  assert.equal((rejected.body as { item: CampaignReference }).item.reviewStatus, "rejected");
  const retrieval = await call(p, "GET", "/api/smcs/references", undefined, true, "eligible=1");
  assert.equal((retrieval.body as { items: unknown[] }).items.length, 0);
  assert.equal((await call(p, "POST", "/api/smcs/references/delete", { id: item.id })).status, 200);
  assert.equal(docs.size, 0);
  assert.equal((await call(p, "GET", `/api/smcs/references/${item.id}`)).status, 404);
});

test("import keeps valid rows and reports invalid ones; a failed write is not success", async () => {
  const { p } = fakePersistence();
  const imported = await call(p, "POST", "/api/smcs/references/import", { records: [record({ title: "One" }), { brand: "no title" }, record({ title: "One" })] });
  assert.equal(imported.status, 207);
  const body = imported.body as { created: CampaignReference[]; errors: Array<{ index: number }> };
  assert.equal(body.created.length, 1);
  assert.deepEqual(body.errors.map((e) => e.index), [1, 2]);
  const broken = fakePersistence({ failWrites: true });
  const failed = await call(broken.p, "POST", "/api/smcs/references", { record: record() });
  assert.equal(failed.status, 502);
  assert.equal((failed.body as { error: { code: string } }).error.code, "postgres_write_failed");
});

test("duplicate helper distinguishes a shared source URL from an unrelated title", () => {
  const existing = [{ id: "cr_a", title: "Mesa launch film", brand: "Mesa", sourceUrl: "https://www.example.com/mesa", reviewStatus: "approved", tags: [], duplicateIndicators: [], version: 1, licenseStatus: "unknown", createdAt: "", updatedAt: "" }] as CampaignReference[];
  assert.equal(assessDuplicates({ title: "Other", sourceUrl: "http://example.com/mesa" }, existing)[0].level, "likely");
  assert.equal(assessDuplicates({ title: "Completely unrelated" }, existing).length, 0);
});
