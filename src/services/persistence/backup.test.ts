import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { exportBackup, restoreBackup, verifyBackup, type BackupFile } from "./backup";
import type { SqlClient } from "./atlas-persistence";

/**
 * Real PostgreSQL test: set ATLAS_TEST_PG="host=/tmp port=54329 user=pgtest" and have databases `src` and `dst` (empty).
 * Skipped otherwise. A tiny psql-backed SqlClient stands in for `pg` (not needed to test the backup logic itself).
 */
const conn = process.env.ATLAS_TEST_PG;
const lit = (v: unknown) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
function client(db: string): SqlClient {
  let buffer: string[] | null = null;
  const psql = (sql: string, tuples = false) => { const r = spawnSync("psql", ["-X", "-q", ...(tuples ? ["-At"] : []), "-v", "ON_ERROR_STOP=1", `${conn} dbname=${db}`], { input: sql, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr.trim()); return r.stdout; };
  return { async query(text, params = []) {
    const sql = text.replace(/\$(\d+)/g, (_m, n) => lit(params[Number(n) - 1]));
    if (/^BEGIN$/i.test(sql)) { buffer = []; return { rows: [] }; }
    if (/^COMMIT$/i.test(sql)) { const b = buffer!; buffer = null; psql(`BEGIN;\n${b.join(";\n")};\nCOMMIT;`); return { rows: [] }; }
    if (/^ROLLBACK$/i.test(sql)) { buffer = null; return { rows: [] }; }
    if (buffer) { buffer.push(sql); return { rows: [] }; }
    if (/^\s*select/i.test(sql)) return { rows: JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`, true).trim() || "[]") };
    psql(sql); return { rows: [] };
  } };
}

test("backup -> verify -> restore into an empty database reproduces every row; non-empty targets are refused", { skip: !conn }, async () => {
  const src = client("src"), dst = client("dst");
  await restoreBackup(await emptyBackup(), src).catch(() => undefined); // creates the tables in src
  await src.query(`INSERT INTO atlas_documents (collection, id, doc) VALUES ('business', 'b1', '{"name":"O''Brien & Sons","n":[1,2,{"z":null}],"u":"é✓"}'::jsonb), ('dossier', 'b1', '{"status":"completed"}'::jsonb), ('workspace_leads', 'l1', '{"a":1}'::jsonb) ON CONFLICT DO NOTHING`);
  await src.query(`INSERT INTO atlas_processed_events (event_id, processed_at_ms) VALUES ('e1', 1760000000000), ('e2', 1760000000001) ON CONFLICT DO NOTHING`);
  const file = await exportBackup(src);
  assert.equal(file.counts.documents, 3); assert.equal(file.counts.processedEvents, 2);
  assert.deepEqual(file.byCollection, { business: 1, dossier: 1, workspace_leads: 1 });
  assert.equal(verifyBackup(file).ok, true);
  assert.equal(verifyBackup({ ...file, documents: [...file.documents.slice(1)] }).ok, false, "tampered/truncated files fail");
  const restored = await restoreBackup(JSON.parse(JSON.stringify(file)) as BackupFile, dst);
  assert.deepEqual(restored, { documents: 3, processedEvents: 2, verified: true });
  assert.equal((await exportBackup(dst)).sha256, file.sha256, "restored data is byte-for-byte equivalent");
  await assert.rejects(restoreBackup(file, dst), /already contains Atlas data/);
  assert.equal((await exportBackup(src)).sha256, file.sha256, "the source database was not modified");
});

async function emptyBackup(): Promise<BackupFile> { return { format: "atlas-backup/1", exportedAt: "x", counts: { documents: 0, processedEvents: 0 }, byCollection: {}, sha256: (await import("node:crypto")).createHash("sha256").update("[[],[]]").digest("hex"), documents: [], processedEvents: [] }; }
