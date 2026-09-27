# Deployment — Atlas AI Proxy on Render

> **Status:** Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-22
> **Related Documents:** [../ATLAS.md](../ATLAS.md) · [../PROJECT_STATE.md](../PROJECT_STATE.md) · [../DECISION_LOG.md](../DECISION_LOG.md) · [../server/ai-proxy-server.ts](../server/ai-proxy-server.ts)

This deploys `server/ai-proxy-server.ts` — the trusted execution boundary from Sprint 5D — as a private Render Web Service. It never deploys the frontend's real API keys; those live only in Render's environment settings, configured by the CEO directly, never pasted into this repo or into Claude.

## 1. Render service type

**Web Service** (not Static Site, not Background Worker) — it needs to accept inbound HTTP requests. Runtime: **Node**.

## 2. Build command

```
npm install
```

No separate build step is required — the server runs via `tsx` (TypeScript executed directly), so there's no compiled output to produce.

## 3. Start command

```
npm run server:start
```

(Equivalent to `tsx server/ai-proxy-server.ts`.) The server reads Render's `PORT` automatically and binds to `0.0.0.0`, as Render requires.

## 4. Required environment variables

Set these in **Render → your service → Environment**, not in any file in this repo:

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | OpenRouter credential — read only by `server/ai-proxy-server.ts`, never by the browser bundle. |
| `NVIDIA_API_KEY` | Yes | NVIDIA credential — same as above. |
| `ATLAS_PROXY_SHARED_SECRET` | Strongly recommended | Simple shared-secret auth between the Atlas frontend and this proxy (see §8 below). Without it, the proxy accepts unauthenticated requests and logs a startup warning. |
| `ATLAS_ALLOWED_ORIGIN` | Recommended if the frontend is served from a different origin | Comma-separated list of origins allowed to call this proxy via CORS. Without it, no CORS headers are sent — cross-origin browser calls are blocked by default (deny-by-default). |
| `PORT` | Set automatically by Render | Do not set manually. |

`.env.example` in the repo root documents these variable names with no real values — copy it to `.env` for local development only; `.env` is git-ignored.

## 5. Health-check endpoint

`GET /api/ai/health` — returns `{ providers: [{ provider, healthy, reason?, checkedAt }] }` for each configured provider. Deliberately unauthenticated (Render's health checker doesn't send custom headers, and this endpoint reveals no secrets — only whether each provider's key is present). Configure this as Render's **Health Check Path**.

## 6. How the frontend connects to the deployed proxy

The frontend never talks to OpenRouter/NVIDIA directly. It uses `ProxiedAIProvider` (`src/workforce/proxied-provider.ts`), configured via `workforce-config.ts`'s `executionBoundary.proxyBaseUrl`, which reads the **non-secret** environment variable `VITE_ATLAS_PROXY_URL` at build time (a URL is safe to expose in the browser bundle — unlike the API keys, which are never read this way).

Set, in the frontend's own build environment (Render Static Site or wherever the Vite app is hosted):

```
VITE_ATLAS_PROXY_URL=https://your-proxy-service.onrender.com
```

If the frontend and proxy are on different origins, also set `ATLAS_ALLOWED_ORIGIN` on the proxy service to the frontend's exact origin.

## 7. How to configure the secrets in Render

1. Render Dashboard → your Web Service → **Environment** tab.
2. Click **Add Environment Variable**.
3. Add `OPENROUTER_API_KEY` and `NVIDIA_API_KEY` with your real values — this is the only place they should ever be entered.
4. Add `ATLAS_PROXY_SHARED_SECRET` — generate a long random string yourself (e.g. `openssl rand -hex 32`) and set it here.
5. Add `ATLAS_ALLOWED_ORIGIN` set to your frontend's exact origin (e.g. `https://atlas.yourdomain.com`), if applicable.
6. Save — Render redeploys automatically with the new environment.
7. On the frontend's own service, set `VITE_ATLAS_PROXY_URL` to this proxy's Render URL, and configure the frontend to send `x-atlas-proxy-secret: <the same shared secret>` on every request to the proxy (matching `ATLAS_PROXY_SHARED_SECRET`).

## 8. How to verify the deployment without exposing credentials

None of these steps require anyone to see or paste a real key:

1. **Health check:** `curl https://your-proxy-service.onrender.com/api/ai/health` — expect `200` with both providers listed. `healthy: true` confirms each key is present and read correctly, without revealing the key itself.
2. **Auth enforcement:** `curl -X POST https://your-proxy-service.onrender.com/api/ai/execute -d '{}'` with no `x-atlas-proxy-secret` header — expect `401` if `ATLAS_PROXY_SHARED_SECRET` is set.
3. **Render logs:** confirm the startup line shows the correct port and no `ATLAS_PROXY_SHARED_SECRET is not set` warning (if you configured one). Logs never contain header or body contents — see `logRequest()` in `ai-proxy-server.ts`, which only records method/path/status/duration.
4. **Malformed-request handling:** send a POST with an invalid JSON body — expect `400`/`500` with a structured `{ failed: true, code, reason }`, never a raw stack trace.

**This document does not claim the Render deployment has been verified end-to-end with real provider calls** — that requires the CEO to actually deploy with real keys and run the checks above. Sprint 5E's own validation (165 smoke-test checks) exercises this server's logic over real loopback HTTP with dependency-injected upstream calls, not real external OpenRouter/NVIDIA requests — see `src/workforce/smoke-test-5e.ts` and `smoke-test-5d.ts`.
