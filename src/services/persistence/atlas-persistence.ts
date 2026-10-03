/**
 * Durable storage for Atlas operating state (PostgreSQL).
 *
 * Atlas's services keep synchronous in-memory repositories as their working set; every mutation is
 * mirrored here through put/remove/markEvent, and the working set is rebuilt from here at startup
 * (hydration). Writes are queued in order; a failed write is never silent: it is counted and surfaced
 * through health(), and flush() lets callers wait for durability before acknowledging.
 */

export type Collection =
  | "business" | "external_key" | "evidence" | "observations" | "score" | "audit"
  | "mission" | "mission_output" | "ledger" | "trace" | "started";

export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
  end?(): Promise<void>;
}

export interface PersistenceHealth { ok: boolean; failedWrites: number; lastError: string | null; pendingWrites: number }

export interface AtlasPersistence {
  migrate(): Promise<{ applied: number[]; current: number }>;
  put(collection: Collection, id: string, doc: unknown): void;
  remove(collection: Collection, id: string): void;
  markEvent(eventId: string, processedAtMs: number): void;
  loadAll(collection: Collection): Promise<Array<{ id: string; doc: any }>>;
  loadEvents(): Promise<Array<{ eventId: string; processedAtMs: number }>>;
  flush(): Promise<void>;
  health(): PersistenceHealth;
  close(): Promise<void>;
}

/** JSON with BigInt support (ledger amounts are bigint minor units). */
export const encode = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { __bigint: v.toString() } : v));
export const decode = <T = any>(text: string | object): T =>
  (typeof text === "string" ? JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof v.__bigint === "string" ? BigInt(v.__bigint) : v)) : reviveBigInt(text)) as T;
function reviveBigInt(node: any): any {
  if (Array.isArray(node)) return node.map(reviveBigInt);
  if (node && typeof node === "object") {
    if (typeof node.__bigint === "string" && Object.keys(node).length === 1) return BigInt(node.__bigint);
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, reviveBigInt(v)]));
  }
  return node;
}

/** Ordered, idempotent migrations. Never edit a shipped migration; append a new one. */
export const MIGRATIONS: Array<{ version: number; name: string; statements: string[] }> = [
  {
    version: 1,
    name: "atlas_core_documents_and_events",
    statements: [
      // Table-level primary keys (implicitly NOT NULL) keep the DDL portable to the test SQL engine.
      `CREATE TABLE IF NOT EXISTS atlas_documents (
         collection text,
         id text,
         doc jsonb,
         updated_at timestamptz DEFAULT now(),
         PRIMARY KEY (collection, id)
       )`,
      `CREATE TABLE IF NOT EXISTS atlas_processed_events (
         event_id text,
         processed_at_ms bigint,
         PRIMARY KEY (event_id)
       )`,
    ],
  },
];

export class PostgresAtlasPersistence implements AtlasPersistence {
  private tail: Promise<void> = Promise.resolve();
  private failedWrites = 0;
  private lastError: string | null = null;
  private pending = 0;

  constructor(private db: SqlClient) {}

  async migrate() {
    let done: Set<number>;
    try {
      done = new Set((await this.db.query(`SELECT version FROM atlas_schema_migrations`)).rows.map((r) => Number(r.version)));
    } catch {
      // First start against an empty database: create the bookkeeping table (IF NOT EXISTS tolerates a concurrent starter).
      await this.db.query(`CREATE TABLE IF NOT EXISTS atlas_schema_migrations (version integer, name text, applied_at timestamptz DEFAULT now(), PRIMARY KEY (version))`);
      done = new Set((await this.db.query(`SELECT version FROM atlas_schema_migrations`)).rows.map((r) => Number(r.version)));
    }
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      for (const statement of m.statements) await this.db.query(statement);
      await this.db.query(`INSERT INTO atlas_schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`, [m.version, m.name]);
      applied.push(m.version);
    }
    return { applied, current: MIGRATIONS[MIGRATIONS.length - 1].version };
  }

  private enqueue(run: () => Promise<unknown>) {
    this.pending++;
    this.tail = this.tail.then(async () => {
      try {
        await run();
      } catch (first) {
        try { await run(); } // one retry for transient connection errors
        catch (error) {
          this.failedWrites++;
          this.lastError = error instanceof Error ? error.message : String(error ?? first);
          console.error(`[atlas-persistence] write failed: ${this.lastError}`);
        }
      } finally {
        this.pending--;
      }
    });
  }

  put(collection: Collection, id: string, doc: unknown) {
    const payload = encode(doc);
    this.enqueue(() => this.db.query(
      `INSERT INTO atlas_documents (collection, id, doc) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (collection, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`, [collection, id, payload]));
  }

  remove(collection: Collection, id: string) {
    this.enqueue(() => this.db.query(`DELETE FROM atlas_documents WHERE collection = $1 AND id = $2`, [collection, id]));
  }

  markEvent(eventId: string, processedAtMs: number) {
    this.enqueue(() => this.db.query(
      `INSERT INTO atlas_processed_events (event_id, processed_at_ms) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`, [eventId, processedAtMs]));
  }

  async loadAll(collection: Collection) {
    await this.flush();
    const { rows } = await this.db.query(`SELECT id, doc FROM atlas_documents WHERE collection = $1 ORDER BY updated_at, id`, [collection]);
    return rows.map((r) => ({ id: String(r.id), doc: decode(r.doc) }));
  }

  async loadEvents() {
    await this.flush();
    const { rows } = await this.db.query(`SELECT event_id, processed_at_ms FROM atlas_processed_events`);
    return rows.map((r) => ({ eventId: String(r.event_id), processedAtMs: Number(r.processed_at_ms) }));
  }

  async flush() { await this.tail; }

  health(): PersistenceHealth {
    return { ok: this.failedWrites === 0, failedWrites: this.failedWrites, lastError: this.lastError, pendingWrites: this.pending };
  }

  async close() { await this.flush(); await this.db.end?.(); }
}

/** Production connection. Throws when DATABASE_URL is missing: there is deliberately no silent in-memory fallback. */
export async function connectPostgres(databaseUrl: string | undefined): Promise<PostgresAtlasPersistence> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for durable Atlas persistence");
  const { default: pg } = await import("pg");
  const external = /\.render\.com(:|\/|$)/.test(new URL(databaseUrl).hostname + "/");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000, ssl: external ? { rejectUnauthorized: false } : undefined });
  await pool.query("SELECT 1");
  return new PostgresAtlasPersistence(pool);
}
