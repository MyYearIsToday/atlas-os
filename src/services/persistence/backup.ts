import { createHash } from "node:crypto";
import type { SqlClient } from "./atlas-persistence";

/**
 * Full logical backup of the Atlas PostgreSQL data (atlas_documents + atlas_processed_events: every Atlas collection,
 * workspace records, missions, outputs, dossiers). Read-only export; restore only ever writes into an EMPTY target and
 * never touches the source database. The content hash lets a file be verified without any database.
 */
export interface BackupDocument { collection: string; id: string; doc: unknown; updatedAt: string }
export interface BackupFile {
  format: "atlas-backup/1";
  exportedAt: string;
  counts: { documents: number; processedEvents: number };
  byCollection: Record<string, number>;
  sha256: string;
  documents: BackupDocument[];
  processedEvents: Array<{ eventId: string; processedAtMs: number }>;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
const hashOf = (documents: BackupDocument[], processedEvents: BackupFile["processedEvents"]) => createHash("sha256").update(stable([documents, processedEvents])).digest("hex");

export async function exportBackup(db: SqlClient, now: () => string = () => new Date().toISOString()): Promise<BackupFile> {
  const docs = await db.query(`SELECT collection, id, doc, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at FROM atlas_documents ORDER BY collection, id`);
  const evs = await db.query(`SELECT event_id, processed_at_ms FROM atlas_processed_events ORDER BY event_id`);
  const documents = docs.rows.map((r) => ({ collection: String(r.collection), id: String(r.id), doc: typeof r.doc === "string" ? JSON.parse(r.doc) : r.doc, updatedAt: String(r.updated_at) }));
  const processedEvents = evs.rows.map((r) => ({ eventId: String(r.event_id), processedAtMs: Number(r.processed_at_ms) }));
  const byCollection: Record<string, number> = {};
  for (const d of documents) byCollection[d.collection] = (byCollection[d.collection] ?? 0) + 1;
  return { format: "atlas-backup/1", exportedAt: now(), counts: { documents: documents.length, processedEvents: processedEvents.length }, byCollection, sha256: hashOf(documents, processedEvents), documents, processedEvents };
}

export function verifyBackup(file: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []; const f = file as Partial<BackupFile> | null;
  if (!f || typeof f !== "object" || f.format !== "atlas-backup/1") return { ok: false, errors: ["not an atlas-backup/1 file"] };
  if (!Array.isArray(f.documents) || !Array.isArray(f.processedEvents)) return { ok: false, errors: ["documents/processedEvents missing"] };
  if (f.counts?.documents !== f.documents.length || f.counts?.processedEvents !== f.processedEvents.length) errors.push("recorded counts do not match the content");
  if (f.documents.some((d) => !d || typeof d.collection !== "string" || typeof d.id !== "string" || typeof d.updatedAt !== "string")) errors.push("a document row is malformed");
  if (!errors.length && hashOf(f.documents, f.processedEvents) !== f.sha256) errors.push("content hash mismatch: the file is corrupt or was edited");
  return { ok: errors.length === 0, errors };
}

const MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS atlas_documents (collection text, id text, doc jsonb, updated_at timestamptz DEFAULT now(), PRIMARY KEY (collection, id))`,
  `CREATE TABLE IF NOT EXISTS atlas_processed_events (event_id text, processed_at_ms bigint, PRIMARY KEY (event_id))`,
];

/** Restores into an empty database only. Refuses a target that already holds Atlas data; verifies the result against the file's hash. */
export async function restoreBackup(file: BackupFile, db: SqlClient): Promise<{ documents: number; processedEvents: number; verified: true }> {
  const v = verifyBackup(file);
  if (!v.ok) throw new Error(`backup file failed verification: ${v.errors.join("; ")}`);
  for (const s of MIGRATION_SQL) await db.query(s);
  const existing = Number((await db.query(`SELECT count(*) AS n FROM atlas_documents`)).rows[0]?.n ?? 0) + Number((await db.query(`SELECT count(*) AS n FROM atlas_processed_events`)).rows[0]?.n ?? 0);
  if (existing > 0) throw new Error("refusing to restore: the target database already contains Atlas data (restore only into an empty database)");
  await db.query("BEGIN");
  try {
    for (const d of file.documents) await db.query(`INSERT INTO atlas_documents (collection, id, doc, updated_at) VALUES ($1, $2, $3::jsonb, $4::timestamptz)`, [d.collection, d.id, JSON.stringify(d.doc), d.updatedAt]);
    for (const e of file.processedEvents) await db.query(`INSERT INTO atlas_processed_events (event_id, processed_at_ms) VALUES ($1, $2)`, [e.eventId, e.processedAtMs]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK").catch(() => undefined); throw e; }
  const again = await exportBackup(db);
  if (again.sha256 !== file.sha256) throw new Error("restore verification failed: restored data does not match the backup hash");
  return { documents: again.counts.documents, processedEvents: again.counts.processedEvents, verified: true };
}
