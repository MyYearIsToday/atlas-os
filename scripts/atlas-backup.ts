/**
 * Atlas database backup / verify / restore. Never modifies the source database.
 *   DATABASE_URL=<source> tsx scripts/atlas-backup.ts export backup.json
 *   tsx scripts/atlas-backup.ts verify backup.json
 *   TARGET_DATABASE_URL=<EMPTY target> tsx scripts/atlas-backup.ts restore backup.json
 * Restore refuses any target that already contains Atlas data.
 */
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { exportBackup, restoreBackup, verifyBackup, type BackupFile } from "../src/services/persistence/backup";

const [mode, file] = process.argv.slice(2);
const pool = (url: string) => new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15000, ssl: /render\.com/.test(url) ? { rejectUnauthorized: false } : undefined });

async function main() {
  if (!file || !["export", "verify", "restore"].includes(mode ?? "")) throw new Error("usage: atlas-backup.ts <export|verify|restore> <file.json>");
  if (mode === "export") {
    const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_URL is required");
    const p = pool(url); try { const b = await exportBackup(p); writeFileSync(file, JSON.stringify(b)); console.log(`exported ${b.counts.documents} documents, ${b.counts.processedEvents} events; sha256 ${b.sha256}`); console.log(JSON.stringify(b.byCollection)); } finally { await p.end(); }
    return;
  }
  const b = JSON.parse(readFileSync(file, "utf8")) as BackupFile;
  const v = verifyBackup(b); if (!v.ok) throw new Error(`verification failed: ${v.errors.join("; ")}`);
  if (mode === "verify") { console.log(`OK: ${b.counts.documents} documents, ${b.counts.processedEvents} events, sha256 ${b.sha256}`); return; }
  const url = process.env.TARGET_DATABASE_URL; if (!url) throw new Error("TARGET_DATABASE_URL (an EMPTY database) is required");
  if (url === process.env.DATABASE_URL) throw new Error("refusing: the restore target must not be the live DATABASE_URL");
  const p = pool(url); try { console.log(JSON.stringify(await restoreBackup(b, p))); } finally { await p.end(); }
}
main().catch((e) => { console.error(`FAILED: ${e instanceof Error ? e.message : e}`); process.exit(1); });
