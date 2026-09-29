import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OpenRouterProvider } from "../src/workforce/openrouter-provider";
import { NvidiaProvider } from "../src/workforce/nvidia-provider";
import type { AIProvider } from "../src/workforce/provider-interface";
import type { AIJobRequest, ProviderId } from "../src/workforce/provider-types";
import { defaultWorkforceConfig } from "../src/workforce/workforce-config";
import { WorkforceProvider } from "./workforce/workforce-provider";

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
        sendJson(res, 200, { providers: summary });
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

// Standalone entrypoint — not executed when imported for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Render sets PORT; AI_PROXY_PORT is a local-dev fallback name.
  const port = Number(process.env.PORT ?? process.env.AI_PROXY_PORT ?? 8787);
  const host = "0.0.0.0"; // required by Render — binding to localhost only would make the service unreachable
  createAiProxyServer().listen(port, host, () => {
    console.log(`Atlas AI proxy listening on ${host}:${port}`);
  });
}
