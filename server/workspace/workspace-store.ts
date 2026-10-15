/**
 * Atlas workspace records (leads, clients, content, finance lines, briefs, businesses, workspace missions) on PostgreSQL.
 *
 * This reuses the existing durable store (`AtlasPersistence` -> table `atlas_documents`, collections `workspace_*`). It adds
 * no migration, no second database and no new connection. It is therefore available exactly when the pipeline's PostgreSQL
 * persistence is (ATLAS_PIPELINE_ENABLED=true + DATABASE_URL).
 *
 * Fail-closed rules:
 *  - No PostgreSQL persistence  -> 503 `postgres_not_configured`; nothing is stored anywhere.
 *  - No ATLAS_PROXY_SHARED_SECRET -> 503 `secret_required`. Workspace data is private and CORS does not protect an open API.
 *  - A write is acknowledged only after the queued write has been flushed AND the persistence failure counter did not move.
 *
 * Only GET/POST are used, so the existing CORS allow-methods ("GET, POST, OPTIONS") is unchanged.
 */
import type { AtlasPersistence, Collection } from "../../src/services/persistence/atlas-persistence";

export const WORKSPACE_COLLECTIONS = ["leads", "missions", "content", "opportunities", "clients", "businesses", "expenses", "income"] as const;
export type WorkspaceCollection = (typeof WORKSPACE_COLLECTIONS)[number];

const MAX_RECORD_CHARS = 100_000;
const MAX_LIST_ROWS = 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class WorkspaceStorageError extends Error {}
export class WorkspaceInputError extends Error {}

export function isWorkspaceCollection(value: string): value is WorkspaceCollection {
  return (WORKSPACE_COLLECTIONS as readonly string[]).includes(value);
}
const key = (collection: WorkspaceCollection) => `workspace_${collection}` as Collection;

export class WorkspaceStore {
  constructor(private readonly persistence: AtlasPersistence, private readonly now: () => string = () => new Date().toISOString()) {}

  /** Runs a queued write and refuses to report success unless PostgreSQL accepted it. */
  private async durably(write: () => void): Promise<void> {
    const before = this.persistence.health().failedWrites;
    write();
    await this.persistence.flush();
    const after = this.persistence.health();
    if (after.failedWrites > before) throw new WorkspaceStorageError(`PostgreSQL write failed${after.lastError ? `: ${after.lastError}` : ""}`);
  }

  async list(collection: WorkspaceCollection): Promise<Array<Record<string, unknown>>> {
    const rows = await this.persistence.loadAll(key(collection));
    return rows
      .map((row) => row.doc)
      .filter((doc): doc is Record<string, unknown> => !!doc && typeof doc === "object" && !Array.isArray(doc))
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .slice(0, MAX_LIST_ROWS);
  }

  async save(collection: WorkspaceCollection, record: unknown): Promise<Record<string, unknown>> {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new WorkspaceInputError("record must be a JSON object");
    const input = record as Record<string, unknown>;
    if (typeof input.id !== "string" || !ID_PATTERN.test(input.id)) throw new WorkspaceInputError("record.id must be 1-64 characters of letters, digits, _ or -");
    const stamp = this.now();
    const saved = { ...input, id: input.id, createdAt: typeof input.createdAt === "string" && input.createdAt ? input.createdAt : stamp, updatedAt: stamp };
    if (JSON.stringify(saved).length > MAX_RECORD_CHARS) throw new WorkspaceInputError("record is too large");
    await this.durably(() => this.persistence.put(key(collection), saved.id, saved));
    return saved;
  }

  async remove(collection: WorkspaceCollection, id: unknown): Promise<void> {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new WorkspaceInputError("id must be 1-64 characters of letters, digits, _ or -");
    await this.durably(() => this.persistence.remove(key(collection), id));
  }
}

export interface WorkspaceContext {
  persistence: AtlasPersistence | null;
  secretConfigured: boolean;
}
export interface WorkspaceResult { status: number; body: unknown }

const err = (status: number, code: string, message: string): WorkspaceResult => ({ status, body: { error: { code, message } } });

/**
 * Routes (all under /api/workspace, behind the shared-secret check in the server):
 *   GET  /api/workspace/status                 -> { durable, store: "postgres", collections, persistence?, reason? }
 *   GET  /api/workspace/:collection            -> { items: [...] }
 *   POST /api/workspace/:collection/save       body { record: { id, ... } } -> { item }
 *   POST /api/workspace/:collection/delete     body { id }                  -> { deleted: true }
 */
export async function handleWorkspaceRequest(method: string, pathname: string, readBody: () => Promise<unknown>, ctx: WorkspaceContext): Promise<WorkspaceResult> {
  const rest = pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(2); // drop ["api","workspace"]

  const blocked = (): WorkspaceResult | null => {
    if (!ctx.persistence) return err(503, "postgres_not_configured", "PostgreSQL persistence is not active on the Atlas server (needs ATLAS_PIPELINE_ENABLED=true and DATABASE_URL)");
    if (!ctx.secretConfigured) return err(503, "secret_required", "Workspace storage is disabled until ATLAS_PROXY_SHARED_SECRET is set");
    return null;
  };

  if (rest.length === 1 && rest[0] === "status") {
    if (method !== "GET") return err(405, "method_not_allowed", "status is GET only");
    const why = blocked();
    return { status: 200, body: { durable: !why, store: "postgres", collections: WORKSPACE_COLLECTIONS, ...(ctx.persistence ? { persistence: ctx.persistence.health() } : {}), ...(why ? { reason: (why.body as { error: { message: string } }).error.message } : {}) } };
  }

  const collection = rest[0];
  if (!collection || !isWorkspaceCollection(collection)) return err(404, "not_found", "unknown workspace collection");
  const unavailable = blocked();
  if (unavailable) return unavailable;
  const store = new WorkspaceStore(ctx.persistence!);

  try {
    if (rest.length === 1) {
      if (method !== "GET") return err(405, "method_not_allowed", "use GET to list a collection");
      return { status: 200, body: { items: await store.list(collection) } };
    }
    if (rest.length === 2 && rest[1] === "save") {
      if (method !== "POST") return err(405, "method_not_allowed", "save is POST only");
      const item = await store.save(collection, ((await readBody()) as { record?: unknown } | null)?.record);
      return { status: 200, body: { item } };
    }
    if (rest.length === 2 && rest[1] === "delete") {
      if (method !== "POST") return err(405, "method_not_allowed", "delete is POST only");
      await store.remove(collection, ((await readBody()) as { id?: unknown } | null)?.id);
      return { status: 200, body: { deleted: true } };
    }
    return err(404, "not_found", "unknown workspace endpoint");
  } catch (error) {
    if (error instanceof WorkspaceInputError) return err(400, "invalid_input", error.message);
    if (error instanceof SyntaxError) return err(400, "invalid_input", "Malformed JSON request body");
    if (error instanceof WorkspaceStorageError) return err(502, "postgres_write_failed", error.message);
    throw error;
  }
}
