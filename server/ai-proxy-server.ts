import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OpenRouterProvider } from "../src/workforce/openrouter-provider";
import { NvidiaProvider } from "../src/workforce/nvidia-provider";
import type { AIProvider } from "../src/workforce/provider-interface";
import type { AIJobRequest, ProviderId } from "../src/workforce/provider-types";
import { defaultWorkforceConfig } from "../src/workforce/workforce-config";
import { WorkforceProvider } from "./workforce/workforce-provider";
import { AtlasOrchestrator } from "../src/orchestrator/orchestrator";
import { InMemoryBusinessRepository } from "../src/services/scout/business-repository";
import { createScoutDiscoveryProvider } from "../src/services/scout/discovery-provider-factory";
import { ScoutScheduler } from "../src/services/scout/scheduler";

let scoutDiscoveryEnabled = false;

/**
 * Sprint 5D/5E — trusted server/edge execution boundary.
 *
 * This is the only place `OPENROUTER_API_KEY`/`NVIDIA_API_KEY` are meant to
 * resolve to a real value — it runs as a Node process, never shipped to a
 * browser. It reuses `OpenRouterProvider`/`NvidiaProvider` unchanged. The
 * browser never sees a key; it only talks to these HTTP endpoints — see
 * `src/workforce/proxied-provider.ts` for the client side. See
 * DECISION_LOG.md, 2026-09-21 and 2026-09-22.
 *
 * Sprint 5E production-safety additions, all documented inline at the
 * point they apply: explicit 0.0.0.0 binding and Render's PORT env var,
 * an optional shared-secret header check, an optional CORS allowlist
 * (deny-by-default), a request body size cap, a clamped max timeout, and
 * a guarantee that no request body, header, or provider key is ever
 * logged — only structural facts (method, path, status, duration).
 */

const MAX_BODY_BYTES = 256 * 1024; // 256KB — a prompt this size is already unusual; caps abuse via giant payloads
const MAX_TIMEOUT_MS = 120_000; // server-side ceiling regardless of what a client requests

function buildProviders(): Record<ProviderId, AIProvider> {
  const providers: Record<ProviderId, AIProvider> = {
    openrouter: new OpenRouterProvider({ defaultModel: defaultWorkforceConfig.modelDefaults.openrouter }),
    nvidia: new NvidiaProvider({ defaultModel: defaultWorkforceConfig.modelDefaults.nvidia }),
  };
  // Sprint 5F: AI Workforce as a third provider ("workforce"), layered on the two above without
  // changing them. Rollback lever: ATLAS_WORKFORCE_ENABLED=false removes it. The free-model catalog
  // loads in the background so the port opens immediately; until it lands the static registry
  // (fixed NVIDIA workers + openrouter/free) is used. Refreshes every 6 hours.
  if (process.env.ATLAS_WORKFORCE_ENABLED !== "false") {
    const workforce = WorkforceProvider.create(providers);
    void workforce.registry.refresh().then(() => {
      console.log(`[atlas-workforce] catalog=${workforce.registry.catalogStatus} freeModels=${workforce.registry.catalogSize}`);
    });
    workforce.registry.startAutoRefresh();
    providers.workforce = workforce;
  }
  return providers;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), { code: "BODY_TOO_LARGE" });
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function isValidProviderId(id: unknown, providers: Record<ProviderId, AIProvider>): id is ProviderId {
  return typeof id === "string" && id in providers;
}

function clampTimeout(request: AIJobRequest): AIJobRequest {
  if (!request.timeoutMs || request.timeoutMs > MAX_TIMEOUT_MS) {
    return { ...request, timeoutMs: MAX_TIMEOUT_MS };
  }
  return request;
}

/**
 * Never logs request bodies, headers, or provider results — only
 * structural facts. This function is the single place request lifecycle
 * logging happens, specifically so no future edit can accidentally add a
 * body/header dump somewhere else in the handler.
 */
function logRequest(method: string, url: string, status: number, durationMs: number): void {
  console.log(`${method} ${url} -> ${status} (${durationMs}ms)`);
}

/**
 * CORS is deny-by-default: with no `ATLAS_ALLOWED_ORIGIN` set, no CORS
 * headers are emitted at all, so browsers block cross-origin access
 * automatically. Setting `ATLAS_ALLOWED_ORIGIN` (comma-separated for
 * multiple) allowlists exactly those origins — the request's Origin is
 * only ever echoed back if it's on that list, never reflected blindly.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const allowlist = (process.env.ATLAS_ALLOWED_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowlist.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-atlas-proxy-secret");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

/**
 * Simplest secure mechanism appropriate for an internal, private-frontend
 * proxy: a shared secret header, not a full auth system. If
 * `ATLAS_PROXY_SHARED_SECRET` is unset, auth is disabled (a warning is
 * logged once at startup, not per request) — acceptable for local dev,
 * strongly not recommended for a real Render deployment. See
 * DEPLOYMENT.md.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.ATLAS_PROXY_SHARED_SECRET;
  if (!expected) return true; // disabled; see startup warning
  return req.headers["x-atlas-proxy-secret"] === expected;
}

export function createAiProxyServer(providers: Record<ProviderId, AIProvider> = buildProviders()) {
  if (!process.env.ATLAS_PROXY_SHARED_SECRET) {
    console.warn("[atlas-proxy] ATLAS_PROXY_SHARED_SECRET is not set — this endpoint accepts unauthenticated requests. Set it before deploying to Render.");
  }

  return createServer(async (req, res) => {
    const started = Date.now();
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    applyCors(req, res);
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (method === "GET" && url === "/api/ai/health") {
        // Health check is intentionally unauthenticated — Render's health
        // checker doesn't send custom headers, and this endpoint reveals
        // no secrets, only per-provider healthy/unhealthy + reason.
        const summary = await Promise.all(Object.values(providers).map((p) => p.healthCheck()));
        sendJson(res, 200, { providers: summary, scoutDiscovery: { enabled: scoutDiscoveryEnabled } });
        logRequest(method, url, 200, Date.now() - started);
        return;
      }

      if (!isAuthorized(req)) {
        sendJson(res, 401, { failed: true, code: "PROVIDER_UNAVAILABLE", reason: "Unauthorized" });
        logRequest(method, url, 401, Date.now() - started);
        return;
      }

      if (method === "GET" && url === "/api/ai/workforce") {
        // Authenticated, read-only registry view (models/chains only; no keys, no prompts).
        const wf = providers.workforce;
        if (!wf || !(wf instanceof WorkforceProvider)) {
          sendJson(res, 404, { failed: true, code: "INVALID_RESPONSE", reason: "Workforce is not enabled" });
          logRequest(method, url, 404, Date.now() - started);
          return;
        }
        sendJson(res, 200, wf.describe());
        logRequest(method, url, 200, Date.now() - started);
        return;
      }

      if (method === "POST" && url === "/api/ai/execute") {
        const body = (await readJsonBody(req)) as { providerId?: unknown; request?: AIJobRequest };
        if (!isValidProviderId(body.providerId, providers)) {
          sendJson(res, 400, { failed: true, code: "INVALID_RESPONSE", reason: `Unknown or missing providerId. Available: ${Object.keys(providers).join(", ")}` });
          logRequest(method, url, 400, Date.now() - started);
          return;
        }
        if (!body.request || typeof body.request.task !== "string") {
          sendJson(res, 400, { failed: true, code: "INVALID_RESPONSE", reason: "Missing or malformed request body" });
          logRequest(method, url, 400, Date.now() - started);
          return;
        }
        const provider = providers[body.providerId];
        const result = await provider.execute(clampTimeout(body.request));
        sendJson(res, 200, result);
        logRequest(method, url, 200, Date.now() - started);
        return;
      }

      sendJson(res, 404, { failed: true, code: "INVALID_RESPONSE", reason: "Not found" });
      logRequest(method, url, 404, Date.now() - started);
    } catch (error) {
      const isBodyTooLarge = error instanceof Error && (error as any).code === "BODY_TOO_LARGE";
      sendJson(res, isBodyTooLarge ? 413 : 500, { failed: true, code: isBodyTooLarge ? "INVALID_RESPONSE" : "PROVIDER_UNAVAILABLE", reason: isBodyTooLarge ? "Request body too large" : "Internal error" });
      logRequest(method, url, isBodyTooLarge ? 413 : 500, Date.now() - started);
    }
  });
}

function requiredScoutNumber(key: string, min: number, max: number, integer = false): number {
  const raw = process.env[key]?.trim();
  if (!raw) throw new Error(`${key} is required`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${key} is outside its allowed range`);
  }
  return value;
}

/**
 * Production discovery is opt-in. Missing or invalid settings leave the API
 * available and discovery stopped; the deterministic test provider remains
 * available to isolated tests.
 */
function startScoutScheduler(): ScoutScheduler | null {
  if (process.env.SCOUT_DISCOVERY_ENABLED !== "true") {
    console.log("[atlas-scout] discovery disabled (SCOUT_DISCOVERY_ENABLED is not true)");
    return null;
  }

  let scheduler: ScoutScheduler | null = null;
  try {
    const discoverySource = process.env.SCOUT_DISCOVERY_SOURCE;
    if (discoverySource !== "overpass" && discoverySource !== "geoapify") {
      throw new Error("SCOUT_DISCOVERY_SOURCE must explicitly be overpass or geoapify");
    }

    const latitude = requiredScoutNumber("SCOUT_DISCOVERY_LATITUDE", -90, 90);
    const longitude = requiredScoutNumber("SCOUT_DISCOVERY_LONGITUDE", -180, 180);
    const radiusMeters = requiredScoutNumber("SCOUT_DISCOVERY_RADIUS_METERS", 1, 50000, true);
    const intervalMs = requiredScoutNumber("SCOUT_DISCOVERY_INTERVAL_MS", 60000, 2592000000, true);
    const rawCategories = process.env.SCOUT_DISCOVERY_CATEGORIES?.trim();
    if (!rawCategories) throw new Error("SCOUT_DISCOVERY_CATEGORIES is required");
    const categories = rawCategories.split(",").map((category) => category.trim());
    // Geoapify category identifiers are dotted (e.g. catering.restaurant); other sources keep the original rule.
    const categoryPattern = discoverySource === "geoapify" ? /^[a-z0-9:_.-]+$/i : /^[a-z0-9:_-]+$/i;
    if (categories.some((category) => !categoryPattern.test(category))) {
      throw new Error("SCOUT_DISCOVERY_CATEGORIES contains an invalid value");
    }

    const orchestrator = new AtlasOrchestrator();
    const repository = new InMemoryBusinessRepository();
    scheduler = new ScoutScheduler({
      provider: createScoutDiscoveryProvider(),
      repository,
      query: { latitude, longitude, radiusMeters, categories },
      dispatch: (type, payload) => orchestrator.dispatch(type, payload),
    });
    scheduler.onRun((result) => {
      console.log(`[atlas-scout] run ${result.ok ? "succeeded" : "failed"} candidates=${result.candidatesFound}${result.error ? ` error=${JSON.stringify(result.error)}` : ""}`);
      // TEMPORARY observability (counts only, no business data): proves normalize -> dedupe -> persist -> dispatch.
      try {
        const created = result.outcomes.filter((o) => o.action === "CREATED");
        const flaggedDuplicates = created.filter((o) => o.duplicateStatus !== "NONE").length;
        const updated = result.outcomes.filter((o) => o.action === "UPDATED_EXISTING");
        const mergedByDedupe = updated.filter((o) => o.duplicateStatus !== "NONE").length;
        const mergedByKey = updated.length - mergedByDedupe;
        const dispatchOutcomes: Record<string, number> = {};
        for (const entry of orchestrator.log.all()) {
          if (entry.event === "BusinessDiscovered") dispatchOutcomes[entry.outcome] = (dispatchOutcomes[entry.outcome] ?? 0) + 1;
        }
        console.log(
          `[atlas-scout][obs] received=${result.candidatesFound} normalized=${created.length + mergedByDedupe} created=${created.length} flaggedPossibleDuplicate=${flaggedDuplicates} mergedByDedupe=${mergedByDedupe} mergedByExternalKey=${mergedByKey} persisted=${repository.list().length} dispatchCalls=${result.outcomes.length} businessDiscoveredLog=${JSON.stringify(dispatchOutcomes)}`,
        );
      } catch (obsError) {
        console.warn(`[atlas-scout][obs] summary failed: ${obsError instanceof Error ? obsError.message : "unknown"}`);
      }
    });
    scheduler.start(intervalMs);
    scoutDiscoveryEnabled = true;
    console.log(`[atlas-scout] discovery enabled source=${discoverySource} intervalMs=${intervalMs}`);
    return scheduler;
  } catch (error) {
    scheduler?.stop();
    const reason = error instanceof Error ? error.message : "invalid startup configuration";
    console.warn(`[atlas-scout] discovery not started: ${reason}`);
    return null;
  }
}

// Standalone entrypoint — not executed when imported for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Render sets PORT; AI_PROXY_PORT is a local-dev fallback name.
  const port = Number(process.env.PORT ?? process.env.AI_PROXY_PORT ?? 8787);
  const host = "0.0.0.0"; // required by Render — binding to localhost only would make the service unreachable
  const scoutScheduler = startScoutScheduler();
  const server = createAiProxyServer();
  server.on("close", () => scoutScheduler?.stop());
  const shutdown = () => {
    scoutScheduler?.stop();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.listen(port, host, () => {
    console.log(`Atlas AI proxy listening on ${host}:${port}`);
  });
}
