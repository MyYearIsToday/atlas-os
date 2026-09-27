# Atlas OS Project State

> **Status:** Active — Sprints 4A–4F, Finance Ledger, 5A–5E (Orchestrator through Production Deployment Prep) complete
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-22
> **Related Documents:** [ATLAS_INDEX.md](./ATLAS_INDEX.md) (start here) · [ATLAS.md](./ATLAS.md) · [ATLAS_PRINCIPLES.md](./ATLAS_PRINCIPLES.md) · [docs/company/OPERATING_SPEC.md](./docs/company/OPERATING_SPEC.md) · [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) · [README.md](./README.md) · [DECISION_LOG.md](./DECISION_LOG.md)

**`ATLAS_INDEX.md` is the mandatory onboarding document for every AI engineer working on Atlas** — see [ATLAS.md § Mandatory AI Entry Protocol](./ATLAS.md#mandatory-ai-entry-protocol).

## Current version

**Atlas OS 1.8.0 — Sprint 5E Production Deployment Preparation**

`server/ai-proxy-server.ts` is now Render-ready: binds `0.0.0.0`, reads `PORT`, has a production start command, shared-secret auth, deny-by-default CORS, body-size and timeout caps, and never logs secrets. Daily AI cost limit (`dailyCostLimitUsd`) is now enforced against the real Finance Ledger. **Not yet deployed** — no real keys exist in any environment this work was done in; deployment itself is the CEO's manual step (see `docs/DEPLOYMENT.md`). 165 smoke-test checks pass across seven scripts (16+31+23+29+34+11+21); `tsc`, app build, and server build all clean.

### Sprint 5E — Production Deployment Preparation (2026-09-22)

- **Render compatibility:** explicit `0.0.0.0` bind, `process.env.PORT` (Render) with `AI_PROXY_PORT` as a local-dev fallback, `npm run server:start` production command, `tsx` moved from implicit `npx`-resolved tool to a declared runtime `dependency` (it wasn't in `package.json` at all before this sprint — a real gap for a production start command).
- **Auth:** shared-secret header (`ATLAS_PROXY_SHARED_SECRET` / `x-atlas-proxy-secret`) — the simplest mechanism appropriate for a private, single-frontend internal proxy, not a full auth system. Disabled (with a startup warning) if unset. The health endpoint stays unauthenticated deliberately (Render's checker sends no custom headers, and it reveals no secrets). Unauthenticated requests to *any other unknown route* return 401, not 404 — deliberate, so an unauthenticated caller can't map valid routes via a 404-vs-401 oracle.
- **CORS:** deny-by-default (no headers emitted unless `ATLAS_ALLOWED_ORIGIN` is set), and even then only echoes an origin that's on the allowlist — never reflects an arbitrary `Origin` header back.
- **Abuse resistance:** request bodies capped at 256KB (413 if exceeded), and any client-requested `timeoutMs` is clamped to a 120s server-side ceiling regardless of what's asked for.
- **No secret logging:** the server's only logging function (`logRequest`) records method/path/status/duration — never headers or body. Verified by a smoke test that statically greps the server source for accidental `console.log(...req.headers...)`/`...body...` patterns, not just manual review.
- **Daily cost limit enforcement** (`src/workforce/cost-guard.ts`, new): reads today's already-posted `AI_COST` transactions from the *real* Finance Ledger as the source of truth — no separate spend counter that could drift. Wired into `runAiJob()` via an optional `ledger` parameter (backward compatible — every Sprint 5C/5D caller that doesn't pass one is unaffected); when the limit is hit, the job fails closed with `BUDGET_EXCEEDED` before any provider is even called, so no cost is incurred for a blocked attempt.
- **Frontend proxy URL** now reads `VITE_ATLAS_PROXY_URL` (safe — a URL, not a secret) instead of a hardcoded `localhost:8787`, guarded so it doesn't throw when `workforce-config.ts` is imported by the server itself under plain Node (`import.meta.env` is undefined there).
- **Production safety verified, not assumed:** no `VITE_*` provider secrets anywhere (grepped), no hardcoded credentials (grepped), `.env`/`.env.*` already git-ignored with `.env.example` correctly allowlisted (pre-existing, confirmed not newly broken), malformed/oversized/unauthenticated/unknown-route requests all return structured errors (tested), missing-key and timeout paths fail safely (tested, inherited from Sprint 5D).
- **A real config bug found while writing the server-side tsconfig:** `include`/`baseUrl`/`paths` in a tsconfig are resolved relative to *that tsconfig's own directory*, not the repo root — the first draft of `server/tsconfig.server.json` silently matched zero files because of this. Caught by actually running the typecheck rather than assuming a plausible-looking config was correct.
- **New file:** `docs/DEPLOYMENT.md` — Render service type, build/start commands, required env vars, health-check path, how the frontend connects (`VITE_ATLAS_PROXY_URL`), how to configure secrets in Render, and how to verify the deployment without exposing credentials.
- **Explicitly not claimed:** this sprint does not claim the Render deployment has been tested — no deployment happened, since it requires the CEO's real credentials and Render account. `docs/DEPLOYMENT.md` says so directly rather than implying otherwise.

**No Dashboard, CRM, Mission Queue, Evidence, Scoring, Audit, Scout, or Finance Ledger transaction-recording logic was modified.** Full reasoning: [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-22.

### Sprint 5D — Trusted Execution Boundary (2026-09-21)

Addresses all 8 prerequisites recorded in the Sprint 5C CEO Ratification.

- **Server boundary** (`server/ai-proxy-server.ts`, new, outside `src/` so Vite never bundles it): a plain Node `http` server, zero new dependencies. Exposes `POST /api/ai/execute` and `GET /api/ai/health`. Reuses `OpenRouterProvider`/`NvidiaProvider` from Sprint 5C completely unmodified — they already read `process.env`; the only thing that changed is that this now runs in a real Node process where that's meaningful.
- **Client-side boundary** (`src/workforce/proxied-provider.ts`, new): `ProxiedAIProvider` implements `AIProvider` identically — `model-router.ts`, `ai-job.ts`, and the Orchestrator need zero changes to use it in place of a direct provider. It never reads, stores, or forwards an API key.
- **Config** (`workforce-config.ts`): `executionBoundary.mode` (`"direct" | "proxied"`), defaulting to `"proxied"` so the insecure path is never the default.
- **Confidence/acceptance fix (prerequisite #5) — done at *both* layers that had it, not just one.** The Sprint 5C ratification flagged this at `WorkforceManager`'s outer gate; while fixing it, the identical problem was found in `ai-job.ts`'s own separate inner escalation loop (`escalation-policy.ts`) — building the Sprint 5D smoke test surfaced it directly (a test failed for a reason distinct from what was being tested, traced to the second occurrence). Both are now fixed the same principled way: a structurally successful execution with unknown confidence is accepted via an explicit, opt-in, distinctly-logged path (`acceptedOnUnknownConfidence: true` outer / `acceptUnknownConfidenceOnSuccess` config inner) — never by fabricating a confidence number, and never for a genuine failure (guarded explicitly on `!result.failed`, not inferred from confidence alone — an earlier draft of this fix conflated the two and was caught and corrected before shipping).
- **Finance stays strict, deliberately.** The `finance` worker role's provider tier did **not** get `acceptUnknownConfidenceOnSuccess: true` — per the Constitution's Financial Principles ("Finance AI relies on deterministic calculations"), a finance-flavored AI call with no measurable confidence fails closed rather than being waved through. Verified by a dedicated smoke test case.
- **End-to-end tests over real loopback HTTP (prerequisite #7):** `smoke-test-5d.ts` starts the actual server on an OS-assigned port and calls it via real `fetch()` — a genuine client→server round trip, not a mock. The upstream OpenRouter/NVIDIA calls *inside* the server use dependency-injected fetch (no real external network access, consistent with every prior sprint's testing approach and this sandbox's network restrictions), but the trust boundary itself — the part this sprint actually adds — is exercised for real.
- **Finance Ledger integrity preserved (prerequisite #6):** no changes to `cost-tracker.ts`, `ledger.ts`, or `finance-types.ts` — a proxied execution returns the identical `AIProviderResult` shape, so cost recording works unchanged.
- **Full regression suite re-run (prerequisite #8):** all five prior smoke scripts re-verified with zero regressions before this sprint was considered done, not after.

**No Dashboard, CRM, Mission Queue, Evidence, Scoring, Audit, Scout, or Finance Ledger file was modified.** Full reasoning: [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-21.

### Sprint 5C — AI Workforce Integration (2026-09-20)

New folder `src/workforce/` (12 files). Extends Sprint 5A's `WorkerRole` union with `writer` (required updating `workforce-manager.ts`'s role→agent map and `orchestration-config.ts`'s provider list to stay exhaustive — the only Sprint 5A files touched, both additive).

- **Provider abstraction** (`provider-interface.ts`, `provider-types.ts`): `execute()`, `validate()`, `estimateCost()`, `estimateTokens()`, `healthCheck()` — identical contract for every provider. Nothing outside `src/workforce/` branches on which concrete provider is in use.
- **OpenRouter / NVIDIA providers**: real `fetch`-based implementations, Bearer auth, configurable model (never hardcoded — read from `workforce-config.ts` or the request), `AbortController`-based timeout, structured failures (`MISSING_API_KEY`, `TIMEOUT`, `NETWORK_ERROR`, `INVALID_RESPONSE`, `PROVIDER_UNAVAILABLE`, `BUDGET_EXCEEDED`). Request construction (`buildOpenRouterRequest`/`buildNvidiaRequest`) is a pure, separately-testable function so header/body correctness can be verified without a network call.
- **Security finding, handled correctly rather than shipped as a defect:** this repository is a client-only Vite SPA (confirmed — no backend, no server env access at runtime). `import.meta.env.VITE_*` variables are inlined into the shipped browser bundle by Vite; putting `OPENROUTER_API_KEY`/`NVIDIA_API_KEY` there would leak them to anyone opening devtools. Both providers instead read `process.env.<KEY>`, which is `undefined` in a browser at runtime — meaning today, every real execution attempt correctly and safely returns `MISSING_API_KEY` rather than silently working with an exposed secret. Wiring real keys in requires a server/edge proxy that doesn't exist yet; that is explicitly out of this sprint's scope and flagged as a prerequisite for live use.
- **Model Router** (`model-router.ts`): deterministic worker→provider selection (`Worker → Model Router → Provider → Model`), respecting configured order, enabled/disabled feature flags, and registry contents — no randomness anywhere.
- **Escalation Policy** (`escalation-policy.ts`): cheap tier first, retry once, escalate only below the confidence target, bounded by `maxEscalationDepth` — pure decision function, no I/O.
- **Confidence Policy** (`confidence-policy.ts`): confidence comes from the provider or is `UNKNOWN` — reuses the canonical `ConfidenceLevel`/`ObservabilityState` from Sprint 4A's evidence model rather than inventing a parallel vocabulary. Both providers honestly report `UNKNOWN` today, since chat-completion APIs don't return a confidence score.
- **Cost Tracker** (`cost-tracker.ts`): every non-zero-cost execution becomes a real transaction in the *existing* `OperationalLedger` (category `AI_COST`), using `money()`'s bigint minor units — no float cost field anywhere, no parallel cost ledger. TradeSpark attribution requires an explicit `attributeAiCostsToTradeSpark` opt-in, defaulting `false`; a failed execution posts no transaction (no fee for no result).
- **Provider Registry** (`provider-registry.ts`): same "never silently overwrite" discipline as Sprint 5B's Handler Registry — `registerProvider()` throws `DuplicateProviderError` on a second registration; replacement requires an explicit `removeProvider()` first.
- **`ai-job.ts`**: the concrete runner (router + escalation + provider call + cost record). `asWorkforceManagerRun()` adapts it to Sprint 5A's `WorkforceManager.executeWithEscalation()` signature — extending that module via dependency injection, exactly as instructed, rather than replacing it.
- **Documented cross-sprint interaction, not silently patched:** Sprint 5A's `WorkforceManager` gates acceptance on `confidence >= provider.confidenceThreshold`. Since real providers honestly report `UNKNOWN` (rank 0), that outer gate can never accept a real AI call today for any provider with a positive threshold — the call still succeeds at the provider level and posts its cost, but the outer orchestrator log may read `FAILURE`. This is flagged as a real design tension for a future sprint to resolve (e.g. a confidence-optional acceptance mode for providers that don't score themselves), not hidden by the tests.
- **Smoke test** (`smoke-test-5c.ts`, 34 checks): provider registration/duplicate rejection, missing-key handling, health checks, pure request construction for both providers (including model override), timeout handling (via a signal-respecting fetch mock — no real network dependency), a full successful call via injected fetch, deterministic routing (including disabled-provider skipping), all four escalation-policy branches, a full `ai-job` run, cost-record building and real Finance Ledger posting (including the TradeSpark-isolation-by-default check and the bigint-precision check), and Execution Log integration through the orchestrator's real per-route worker escalation.

**No Dashboard, CRM, Mission Queue, Evidence, Scoring, Audit, Scout, or Finance Ledger file was modified** — confirmed by diff. Full reasoning: [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-20.

### Sprint 5B — Live Handler Integration (2026-09-19)

Extends `src/orchestrator/` (Sprint 5A) with real service wiring, without modifying any Sprint 3–5A file's public behavior beyond the additions described below.

- **Handler Registry** (`handler-registry.ts`, new): centralizes what was a bare `Map` inside `orchestrator.ts`. Throws `DuplicateHandlerError` on a second registration unless `{ replace: true }` is passed explicitly — a handler is never silently overwritten. Throws `MissingHandlerError` from `get()`; `tryGet()` is the non-throwing variant for callers that want to branch on "no handler" as data.
- **Real handlers** (`real-handlers.ts`, new): wires all 6 required mappings to actual services — `intakeRequiresReview` (Scout Intake), `calculateOpportunityScore`, `generateAudit`, `createMissionFromAuditRecommendation` (Mission Queue, via Sprint 4's `mission-adapters.ts`), `profitLoss` (Finance Metrics), `createSnapshot` (Ledger Snapshot). None of these functions were modified or duplicated — this file only calls them.
- **Idempotency** (`idempotency.ts`, new): `computeEventId()` is a deterministic FNV-1a hash of event type + payload (no randomness); a caller-supplied `eventId` always takes priority. `ProcessedEventCache` tracks processed events with a TTL (24h default); a duplicate dispatch is logged as `DUPLICATE` and the handler never runs again.
- **Payload validation** (`payload-validation.ts`, new): structural checks per event type, run before any handler executes. Rejects, never patches — e.g. an `EvidenceUpdated` event with zero Opportunity Score components is rejected rather than scored against an empty set.
- **Auto-chaining**: `orchestrator.dispatch()` now re-dispatches a handler's `nextEvent` automatically, but only where a handler can honestly construct the next payload from its own real output. Concretely: `ScoreCalculated` → `AuditGenerated` → `MissionCreated` chain automatically once a business's audit input and score are supplied. `BusinessDiscovered` and `EvidenceUpdated` **deliberately do not auto-chain** — their outputs cannot honestly supply the next event's required fields (a Visibility Score, competitor data, or real evidence collection) without fabricating them.
- **Observability**: `ExecutionLogEntry` gained `eventId` and `durationMs` (measured with `performance.now()`, never estimated) and a wider `outcome` union (`DUPLICATE`, `INVALID_PAYLOAD`, `DISABLED` added to Sprint 5A's set).
- **Config**: `orchestration-config.ts` extended with `idempotencyPolicy.ttlMs` and `handlerEnabled` (per-event-type kill switch, disabled handlers log `DISABLED` rather than silently no-op-ing).
- **TradeSpark isolation preserved**: the `MissionCompleted` → Finance Metrics handler calls `profitLoss(..., { includeTradeSpark: config.featureFlags.includeTradeSparkInAutoChain })`, defaulting `false` — same default-excluded behavior established in the Finance Ledger sprint, now reachable through the orchestrator too.
- **Sprint 5A's public API changed** (`registerHandler()` → `registry.register()`, `dispatch()`'s third argument is now an options object) to accommodate the Handler Registry. `smoke-test-orchestrator.ts` was updated to the new calls — every original assertion is preserved, none removed or weakened; all 22 still pass.
- **Smoke test** (`smoke-test-5b.ts`, new, required): 29 checks — Handler Registry duplicate/missing behavior, idempotency determinism, payload validation, a genuine end-to-end pipeline (real Scout Intake → real Opportunity Score → real Audit Generator → real Mission Queue task creation, auto-chained), duplicate-event suppression, invalid-payload rejection, missing-handler honesty, approval blocking with real handlers registered, retry recovery, dead-letter routing, and deterministic event-bus ordering.

**No pre-existing file's logic was changed** — `services/{crm,mission-queue,evidence,scoring,audit,scout,finance}` and all UI files are untouched, confirmed by build/test re-verification. Full reasoning: [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-19.

### Sprint 5A — Atlas Orchestrator (2026-09-18)

New folder `src/orchestrator/`, all 12 required files, composed rather than duplicating existing logic:

- **Event Bus** (`event-bus.ts`): deterministic — subscribers run in subscription order, `emit()` awaits them sequentially (not `Promise.all`), so behavior never depends on timing.
- **Router** (`router.ts`): a pure, deterministic table mapping each of the 8 required events to the existing service that should handle it (by name, for logging/lineage) — it never calls a service directly and never bypasses one.
- **Workflow Engine** (`workflow-engine.ts`): **reuses `services/scout/workflow.ts`'s `allowedTransitions`/`canTransition` directly** — the state machine is not redefined. An invalid transition emits a `WorkflowBlocked` event rather than failing silently.
- **Workforce Manager** (`workforce-manager.ts`): provider-agnostic (`openrouter`, `nvidia`, or any future string id — nothing hardcoded to OpenAI or any single vendor). Escalation policy (cheap tier first, retry once per tier, escalate only below the tier's confidence threshold) is implemented as pure decision logic; **the actual execution function is supplied by the caller**, so this module makes no real AI call and cannot fabricate a result — consistent with Sprint 4A's "never fake AI execution" rule.
- **Approval Gateway** (`approval-gateway.ts`): does not duplicate approval logic — it reads the existing `ApprovalLevel` type (Sprint 3) and the existing `FinanceApprovalPolicy` categories (Finance Ledger) and applies the one rule already in `ATLAS.md`. It never grants an approval itself; omitting an approval context is always treated as "not approved," never as an implicit yes.
- **Retry Manager** (`retry-manager.ts`): deterministic exponential backoff (500ms → 1000ms → 2000ms by default, no jitter/randomness), dead-letter queue for exhausted retries — nothing is silently dropped.
- **Execution Log** (`execution-log.ts`): append-only, same "never edit history" principle as the Finance Ledger's audit trail.
- **Task Priority** (`task-priority.ts`): deterministic weighted score (opportunity score, log-dampened commercial value, mission urgency tier, due-date proximity) with a fixed tiebreak rule — no randomness anywhere.
- **Config** (`orchestration-config.ts`): provider selection, thresholds, retry/escalation policy, feature flags — no secrets or credentials.
- **Smoke test** (`smoke-test-orchestrator.ts`): 23 checks — event ordering, workflow transition rejection, backoff math, all four approval-gateway combinations, priority determinism, and full orchestrator dispatch (successful handler execution, approval blocking, missing-handler honesty, and confidence-based escalation) — all pass.

**Deliberate design choice:** the orchestrator's dispatch requires the caller to register a real handler function per event type (`registerHandler()`) rather than the orchestrator constructing Business/Evidence/Score/Audit inputs itself from a bare event. An orchestrator that guessed those inputs would be inventing data — exactly what Sprints 4A–4E's evidence/confidence discipline exists to prevent. This sprint ships the coordination layer (routing, approval, retry, escalation, logging); wiring real handlers to real UI actions is explicitly deferred, same as every prior sprint's service layer.

**No existing file was modified.** `src/services/{crm,mission-queue,evidence,scoring,audit,scout,finance}` and every UI file are untouched — verified by diff.

Full reasoning: [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-18.

This is a React + Vite web artifact for MapSpark Ghana, developed inside a pnpm monorepo (workspace root not included in this handoff ZIP — see [Build Compatibility Notes](#build-compatibility-notes)). The product is local-first and Firebase-ready; Firebase credentials and runtime connections are intentionally not configured.

## Verification methodology (2026-09-15)

Per [ATLAS_PRINCIPLES.md](./ATLAS_PRINCIPLES.md) rule 11, findings below are labeled:

- **Verified** — directly confirmed by running a command or tracing code end-to-end.
- **Verified (via workaround)** — confirmed by temporarily reconstructing the missing monorepo context in a scratch copy (stand-in `tsconfig.base.json`, a pinned `zod` version, a stub `attached_assets` folder) so `tsc` and `vite build` could actually run. The delivered repository itself was **not** modified by this workaround — see [Build Compatibility Notes](#build-compatibility-notes).
- **Unable to Verify** — could not be checked in this environment at all.
- **Requires Workspace Context** — can only be verified correctly inside the real Replit monorepo, because the check depends on files this ZIP doesn't contain.

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Verified (via workaround) — 0 errors |
| Production build (`vite build`) | Verified (via workaround) — succeeds, no warnings, including with sourcemaps enabled |
| Broken imports | Verified (via workaround) — a clean `tsc` pass rules out unresolved imports |
| TODO/FIXME markers | Verified — none found in `src/` |
| Unused files | Verified by code review — see [Known Issues](#known-issues) |
| CRM functionality (create/edit/delete/stage/search/filter) | Verified by code review — full trace in [SPEC-002-CRM.md](./docs/specs/SPEC-002-CRM.md) |
| Mobile responsiveness | Verified by code review (Tailwind responsive classes present and consistent) — **not** verified via rendered browser screenshot; this environment has no browser rendering tool |
| Standalone `npm install` without workaround | Unable to Verify as shipped — fails on `"zod": "catalog:"` and on `tsconfig.json`'s `extends` target, both of which only resolve inside the monorepo |
| Behavior of the real monorepo build (pnpm, real catalog, real `tsconfig.base.json`) | Requires Workspace Context — cannot be verified from this ZIP at all |

## Build Compatibility Notes

This ZIP is a **handoff snapshot** of one package (`@workspace/atlas-os`) from a larger pnpm monorepo. GitHub — inside that monorepo — remains the source of truth (see [ATLAS.md § Git Workflow](./ATLAS.md#git-workflow)). Two files in this package reference the monorepo root, which is not included in this ZIP:

1. **`package.json`** pins `"zod": "catalog:"` — pnpm workspace-catalog syntax. It only resolves against a `pnpm-workspace.yaml` catalog file at the monorepo root.
2. **`tsconfig.json`** has `"extends": "../../tsconfig.base.json"` — two directories above this package, i.e. outside this ZIP entirely. **`vite.config.ts`** also references `../../attached_assets` for the `@assets` alias and passes `../` as the cartographer plugin root.

**As a result, a plain `pnpm install` / `npm install` run directly on this extracted ZIP will fail** — not because of a code defect, but because the ZIP is intentionally a partial snapshot, not the full monorepo. This is expected and matches Decision 2026-09-15 in [DECISION_LOG.md](./DECISION_LOG.md) ("Leave the `zod: catalog:` dependency unpinned").

To independently verify the code itself (typecheck and build) despite this, verification for this handoff was performed in a **separate scratch copy**, not the delivered repository, using:

- A stand-in `tsconfig.base.json` with reasonable strict defaults.
- `zod` temporarily pinned to `^3.23.8` in the scratch copy only.
- A stub empty `attached_assets` folder.

Both `tsc --noEmit` and `vite build` succeeded cleanly against this workaround, giving real confidence in the code — but the actual monorepo's `tsconfig.base.json` and pnpm catalog were never seen, so **the exact resolved dependency versions and compiler options in production are Requires Workspace Context**, not verified here.

**Do not pin package versions in the delivered `package.json`** to work around this — per [DECISION_LOG.md](./DECISION_LOG.md), that would silently diverge this snapshot from the monorepo's dependency graph. Leave `"zod": "catalog:"` and the `tsconfig.json` `extends` path exactly as they are unless the CEO explicitly instructs otherwise.

## Completed features

### Product surfaces

- Mission Control dashboard with revenue, leads, clients, visibility score, and
  trading protection KPIs.
- AI Employees screen with the five Atlas operator profiles.
- CRM Pipeline route at `/crm`.
- Clients workspace with client cards, visibility history, notes, and upsells.
- Visibility Score Generator with weighted scoring and report sharing action.
- Atlas Leaderboard (renamed from "Atlas Index" 2026-09-15).
- Finance ledger and expense view with trading controls intentionally locked.
- Settings screen with the local/Firebase integration state visible.

### Sprint 2 CRM Foundation

- Six stages: Prospect, Contacted, Replied, Proposal Sent, Won, Lost.
- Local mock lead records with all required fields:
  business name, category, location, contact name, phone, email, website,
  Google Maps URL, visibility score, lead status, last contact date, next
  follow-up date, notes, and estimated deal value.
- Create, edit, delete, stage update, detail drawer, search, category/status
  filtering, and follow-up filtering.
- Mobile-first stacked pipeline layout and responsive detail/form drawers.
- Migration from the earlier `atlas-deals` localStorage shape.
- Reusable CRM components in `src/components/crm/`.
- Repository seam in `src/services/crm.ts` for future Firebase/API providers.

Full detail and per-item verification status: [SPEC-002-CRM.md](./docs/specs/SPEC-002-CRM.md).

### Sprint 3 Mission Queue Foundation

- `Task` model (`src/services/mission-queue.ts`) with the fields, priority
  levels, statuses, and approval levels specified in
  [SPEC-003-MissionQueue.md](./docs/specs/SPEC-003-MissionQueue.md).
- Local, localStorage-backed repository with the same shape as the CRM's
  (`getSnapshot`/`subscribe`/`create`/`update`/`remove`), plus `advance` and
  `sendBackForRevision` to drive the approval-aware state machine.
- Mission Queue page (`/mission-queue`) with a status board (Pending / In
  Progress / Waiting Approval / Completed), search, and filters by priority,
  approval level, and AI employee.
- Task Detail panel with state-aware next actions (Start → Mark
  complete/Submit for approval → Review → View result), matching the brief's
  state machine exactly.
- Approval Center view separating Auto / Approval Required / CEO Only tasks
  with visually distinct treatment (lock icon and red accent for CEO Only).
- AI employee fleet status strip, derived live from task data joined against
  the existing `src/agents` registry — no second employee model created.
- Today's Mission card on the existing Dashboard now shows live counts
  (pending, in progress, awaiting approval, employees working) and an
  "estimated value in motion" figure derived from CRM deal values linked via
  `clientId`, replacing the previous hardcoded checklist.
- 10 seed tasks representing realistic MapSpark development work (visibility
  audits, GBP diagnosis, client reports, competitor research, content packs,
  lead research, follow-up prep, finance reconciliation, pricing review).

### Sprints 4B–4F + Finance Ledger (2026-09-17)

Reviewed and integrated from three CEO-supplied patch bundles into `src/services/{scoring,audit,scout,finance}/` plus `mission-adapters.ts`. Every file was inspected before integration; real defects were found and fixed rather than shipped as-is.

- **4B — Visibility Score v1.0** (`scoring/visibility-score-v1.ts`, no patch supplied, written this sprint): the canonical ten-component evidence-based engine, built alongside — not replacing — the legacy `visibility-score.ts` still used by the Dashboard/Clients pages.
- **4C — Competitor Gap** (`scoring/competitor-{gap,benchmark,normalization}.ts`): null-safe, median/best-in-class benchmarking. **Fixed a real logic bug**: the patch computed a `direction` value per gap and never included it in the returned object — caught by `tsc`, fixed, and covered by a regression test.
- **4D — Opportunity Score** (`scoring/opportunity-*.ts`): seven-component model (Visibility Weakness 20%, Competitive Gap 20%, Commercial Value 15%, Conversion Readiness 15%, Demand/Local Intent 10%, Evidence Quality 10%, Execution Feasibility 10%), superseding the ten-component draft from the Sprint 4A pass. Confidence kept separate from the score; excluded components are excluded from the total, not assumed.
- **4E — Audit Generator** (`audit/*.ts`): consumes pre-computed scores, does not recalculate them. All ten required sections generate with per-section confidence/observability — a missing input (e.g. no competitors) renders `NOT_OBSERVABLE`, never a fabricated claim.
- **4F — Scout Workflow** (`scout/*.ts`): the full `DISCOVERED → ... → MISSION_CREATED` state machine, with `BLOCKED` reachable from any non-terminal state and no state skippable.
- **Finance Ledger** (`finance/*.ts`): `bigint`-based money (no floats), append-only audit trail, category-specific transaction validation, deterministic P&L/cash-flow/client-profitability reports. **Fixed a real gap**: the original patch had no TradeSpark exclusion at all in its operating reports — `profitLoss()`/`cashFlow()` now exclude `productId: "TradeSpark"` by default, requiring an explicit opt-in to include it. **Added `clientProfitability()`**, which the patch's own types promised but never implemented.
- **Mission Queue consolidation**: three more disconnected adapter stubs found (same pattern as Sprint 4A) in the opportunity, audit, and finance patches — none touched the real `Task`/`localMissionQueueRepository`. Replaced with real integrations in `mission-adapters.ts`; there is still exactly one Task model and one Mission Queue.
- **De-duplication**: competitor-gap and opportunity-score had each redefined their own copies of the confidence/observability string unions instead of importing Sprint 4A's canonical `ConfidenceLevel`/`ObservabilityState`. Both now alias the canonical types.
- Two smoke-test scripts added: `scripts/smoke-test-evidence.ts` (16 checks, from 4A, re-verified still passing) and `scripts/smoke-test-sprint4bf-finance.ts` (31 checks covering scoring, audit, Scout, and finance). All 47 pass.
- **No UI wired to any of this.** No external API calls, no scraping, no Google auth anywhere in the new code — verified by direct code search, not just by the patches' own claims.

Full reconciliation reasoning for every decision above: [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-17.

### Sprint 4A Evidence & Business Intelligence Foundation (2026-09-16)

Built from a CEO-supplied patch bundle (diff files + PDFs), reviewed, corrected, and integrated — not applied blindly. New module: `src/services/evidence/`.

- `business-intelligence.ts` — canonical `BusinessIntelligence` model (id, canonicalName, aliases, category(ies), status, geo, contact channels, hours, services/products, source/evidence references, timestamps), matching the Sprint 4A spec's field list.
- `evidence.ts` — canonical `EvidenceRecord` model with source type, evidence type, confidence, verification status, collector, and observability state.
- `confidence.ts` — `ConfidenceLevel` ranking and source→confidence defaults (fixed during review: `other_permitted_source` now correctly maps to `LOW`, matching the spec's explicit example — the original patch left it falling through to `UNKNOWN`).
- `conflicts.ts` — `fieldState()` distinguishes `OBSERVED_PRESENT` / `OBSERVED_ABSENT` / `NOT_OBSERVABLE` / `CONFLICTING`; conflicting evidence is preserved, never auto-resolved, and flags `humanReviewRequired`.
- `freshness.ts` — freshness classification (`fresh`/`stale`/`expired`/`unknown`) with **documented default windows per field** added during review (the original patch had the mechanism but no actual defaults, so every field silently returned `unknown`).
- `business-deduplication.ts` — signal-scored duplicate assessment (phone/website/name/coordinates); a single weak signal yields `POSSIBLE_DUPLICATE` with human review required, never an automatic merge.
- `source-registry.ts` — documented permitted sources (OSM, Nominatim, Overpass, official websites, directories, manual observation) with license/attribution/reliability notes; added the missing "legitimate public directories" entry during review.
- `provider-interfaces.ts` / `request-policy.ts` — `BusinessDiscoveryProvider`, `GeocoderProvider`, `BusinessEnrichmentProvider`, `EvidenceCollector` interfaces with **no external HTTP calls implemented**; per-source rate limits and cache TTLs (e.g. Nominatim 1 req/sec, 30-day cache). Added a documented-but-unimplemented `GoogleAuthorizedProvider` extension point during review, per the spec's explicit "architecture should allow" instruction.
- `opportunity-score-contract.ts` — `OpportunityScoreInputs` shape and the canonical weights (summing to 100); no calculation function yet (Sprint 4B candidate).
- `mission-adapter.ts` — **rewritten during review.** The original patch's adapter was a disconnected generic interface that never touched the real Mission Queue. Replaced with `createScoutMissionForBusiness()`, which builds a real `TaskInput` and calls the existing `localMissionQueueRepository.create()` from Sprint 3 — this is the actual "data connection to Mission Queue" the sprint brief required, not a parallel system.
- `scripts/smoke-test-evidence.ts` — a permanent, runnable regression script (16 checks: confidence mapping, all four observability states, conflict/human-review flagging, dedup thresholds including a genuine `LIKELY_DUPLICATE` case, freshness defaults and the "no invented default" guarantee). All 16 pass.

**No UI was wired to this module.** No external API calls exist anywhere in it. No Google authentication, Maps scraping, Search scraping, proxy rotation, or bulk review database was introduced — confirmed by direct code review, not just by the patch's own claim. `src/services/visibility-score.ts` was inspected, not rewritten; its six-input model differs from the canonical ten-component `VisibilityScore v1.0`, and the specific gap plus reconciliation path is now documented in [SPEC-004-MapSpark.md § Reconciliation with the Implemented Engine](./docs/specs/SPEC-004-MapSpark.md#reconciliation-with-the-implemented-engine-sprint-4a) rather than silently left unexplained.

### Constitutional Architecture (2026-09-15)

- `ATLAS.md` v2.1 — added Mandatory AI Entry Protocol (with the AI Oath) as a constitutional article, plus the v2.0 additions: Evidence & Uncertainty Policy, Financial Principles, Product & Customer Principles, Data/Privacy/Compliance, Research Standards, AI Performance & Promotion, Failure Handling, and Company Structure & Shared Infrastructure sections.
- `ATLAS_INDEX.md` (new) — the mandatory onboarding "Table of Truth" for every AI worker. Contains reading order, current status snapshot, CEO authority reminder, and the Before You Build checklist.
- `ATLAS_PRINCIPLES.md` v2.0 — consolidated with the twelve-principle Atlas Core Philosophy; original ten operating rules preserved under a new "Operating Rules" section.
- `docs/company/OPERATING_SPEC.md` (new) — actors, systems, and lifecycle detail for missions, approvals, CRM, evidence, product, AI, finance, research, memory, incidents, and measurement.
- `docs/specs/SPEC-004-MapSpark.md` (new) — MapSpark's full product operating specification: three-score model, Google evidence rule, Visibility/Opportunity scoring methodologies, field operations, data objects, API roadmap, audit/proposal structure, review policy, and safety/compliance.
- Light-touch updates to `docs/company/{CONSTITUTION,PRODUCTS,EMPLOYEES}.md`, `README.md`, and anchor-link fixes across the repo following the `ATLAS.md` restructure.

## Unresolved questions (need CEO input)

- ~~**Naming collision:** `ATLAS_INDEX.md` vs. the "Atlas Index" product feature.~~ **Resolved** — CEO Decision 004 (2026-09-15): `ATLAS_INDEX.md` permanently keeps the name "Atlas Index"; the product feature is renamed to **Atlas Leaderboard** everywhere (nav, route, page title, seed data). See [DECISION_LOG.md](./DECISION_LOG.md).
- **CRM pipeline:** adopt the twelve-stage target pipeline documented in `OPERATING_SPEC.md`, or keep the current six-stage implementation? See [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-15, "Record target CRM pipeline."
- **Visibility Score UI migration:** `visibility-v1.0` is now canonical, but the Dashboard/Clients pages still render the legacy `visibility-score.ts` calculation. Migrate the UI, or keep both indefinitely?
- **Opportunity Score model change:** the ten-component model documented after Sprint 4A was superseded by this sprint's seven-component model, per the CEO's Sprint 4D brief. Confirming this supersession (not a mistake) for the record.

## Incomplete features

These are intentionally outside the completed Sprint 2 scope:

- Firebase Authentication, Firestore, and Storage connection.
- Server/API persistence, multi-user tenancy, ownership, permissions, and
  conflict resolution.
- AI employee execution, approval flows, and automated outreach.
- Google Business Profile ingestion or live external visibility data.
- CRM activity timeline, reminders, import/export, bulk operations, and audit
  history.
- Finance integrations, accounting sync, and trading execution.
- Automated workflow scheduling and notification delivery.
- Mission Queue: real AI execution, dynamic task assignment logic, and
  Firestore persistence remain unbuilt — see
  [SPEC-003-MissionQueue.md](./docs/specs/SPEC-003-MissionQueue.md) for what
  Sprint 3 resolved versus what is still open.

Some existing screens also contain intentionally static or placeholder controls
that are outside this handoff's Sprint 2 scope. They are listed so the next
engineer does not mistake them for connected backend behavior.

## Pending sprint

**Sprint 5F** (working name) is not started, and awaits the CEO's manual Render deployment first (see `docs/DEPLOYMENT.md`). Candidates once deployed and verified: wiring `ai-job.ts` into an actual text-generation step (none of Sprint 5B's six required mappings need an LLM call, so `real-handlers.ts` doesn't use it yet); the first UI surface calling `AtlasOrchestrator.dispatch()` from a real user action; a real `BusinessDiscoveryProvider` feeding `BusinessDiscovered` from actual OSM/directory data; the Dashboard/Clients visibility-score migration decision (still open); resolving the `BusinessDiscovered`/`EvidenceUpdated` auto-chain gap.

## Known issues

- Persistence is browser localStorage only and has no authentication, tenant
  boundary, runtime schema validation, or cross-device sync.
- Seeded CRM dates are mock dates and should be replaced by provider-backed data
  before launch.
- The project contains a legacy CRM implementation inside
  `src/pages/atlas-pages.tsx`; routing uses `src/pages/crm-page.tsx`. Independently
  re-confirmed on 2026-09-15: `App.tsx` imports `CrmPage` only from `crm-page.tsx`,
  so the legacy implementation is unrouted dead code. It is retained as historical
  compatibility code and should be removed during a deliberate model consolidation
  pass — not in this handoff.
- **Newly identified (2026-09-15):** `src/lib/atlas-data.ts` and
  `src/services/atlas-data.ts` are two unrelated files that share a filename.
  `lib/atlas-data.ts` (72 lines) is legacy seed data used only by
  `atlas-pages.tsx`; `services/atlas-data.ts` (580 lines) is the active domain
  model used throughout the current app. TypeScript resolves both correctly via
  distinct import paths — this is not a build error — but the naming collision
  is a real risk for a future engineer scanning by filename rather than path.
  Recommend renaming or removing `lib/atlas-data.ts` in the same consolidation
  pass that removes the legacy CRM code above.
- The workspace includes generic Radix UI primitives from the starter template;
  only the imported subset is bundled. Independently re-confirmed on 2026-09-15
  via a reference scan across `src/`: roughly 35 `components/ui/*` primitives
  and `services/firebase-adapter.ts` are not currently imported anywhere. This
  matches the documented starter-template pattern and the intentionally-unused
  Firebase seam — not treated as dead code to delete, since both are expected
  scaffolding for future work.
- **Correction (2026-09-15):** the previous handoff notes claimed the production
  build prints a non-blocking Vite sourcemap warning from
  `src/components/ui/tooltip.tsx`. This was independently re-tested, including
  with sourcemaps explicitly enabled, and **did not reproduce** — the build
  completes with no warnings. Retracted; not a current known issue. Flagged
  here rather than silently removed, per [ATLAS_PRINCIPLES.md](./ATLAS_PRINCIPLES.md)
  rule 11 (never present an assumption as verified without saying what changed).
- No automated test suite exists yet, and no `lint` script is configured in
  `package.json`. Verification is currently typecheck, production build, code
  review, and browser preview validation.
- Standalone installation outside the monorepo requires a workaround — see
  [Build Compatibility Notes](#build-compatibility-notes).
- **Sprint 3:** `clientId` on a Task is a loose, unvalidated reference to a
  CRM lead id — there is no enforcement that it points to a real lead, and no
  UI to pick one (seed data only). Task assignment to an AI employee is
  static seed data; no assignment logic exists yet, per open question 3 in
  [SPEC-003-MissionQueue.md](./docs/specs/SPEC-003-MissionQueue.md).
- **Sprint 3:** "Estimated value in motion" on the dashboard sums linked CRM
  deal values for in-flight tasks. It is a development estimate for demo
  purposes, not a validated profit-impact metric — no new field was added to
  the Task model for this, per the Sprint 3 brief's guidance.

## Folder structure

```text
atlas-os/
├── ATLAS.md                    Constitution (v2.1, immutable without CEO approval)
├── ATLAS_INDEX.md               Mandatory AI onboarding document — every AI starts here
├── ATLAS_PRINCIPLES.md         One-page quick reference
├── AI_REGISTRY.md              Current AI worker per employee role
├── DECISION_LOG.md             Dated record of major decisions and reasoning
├── server/                     Sprint 5D: trusted AI execution boundary (ai-proxy-server.ts) — outside src/, never bundled by Vite
├── PROMOTION_BOARD.md          Candidate AI workers and promotion criteria
├── PROJECT_STATE.md            This state snapshot
├── README.md                   Product and setup documentation
├── docs/
│   ├── company/                Company-level reference (CEO, employees, products, roadmap, operating spec)
│   │   └── OPERATING_SPEC.md   Cross-product workflow, state, and lifecycle detail
│   ├── specs/                  Numbered specs (brand, CRM, Mission Queue, MapSpark)
│   │   └── SPEC-004-MapSpark.md  MapSpark product operating specification
│   └── handoff/                Engineer continuation notes (HANDOFF.md)
├── src/
│   ├── agents/                 AI employee contracts
│   ├── apis/                   External API boundaries
│   ├── automations/            Automation declarations
│   ├── components/
│   │   ├── crm/                Sprint 2 lead components
│   │   ├── mission-queue/      Sprint 3 task card, detail panel, approval center, fleet status
│   │   └── ui/                 Shared/template primitives
│   ├── hooks/                  Shared React hooks
│   ├── lib/                    Legacy seed data (see Known Issues re: atlas-data.ts collision)
│   ├── pages/                  Routed screens (+ unrouted legacy CRM code, see Known Issues)
│   │   └── mission-queue-page.tsx  Sprint 3 Mission Queue page (/mission-queue)
│   ├── orchestrator/            Sprint 5A/5B: Atlas Orchestrator — event bus, router, handler registry, real service wiring, idempotency, retry/escalation, approval, execution log
│   ├── workforce/                Sprint 5C: AI Workforce — provider abstraction, OpenRouter/NVIDIA, model router, escalation/confidence policy, cost tracker
│   └── services/
│       ├── crm.ts              CRM repository and local provider
│       ├── mission-queue.ts    Sprint 3 Task model, repository, and derived views
│       ├── evidence/           Sprint 4A evidence/business-intelligence foundation
│       ├── scoring/            Sprint 4B-4D: Visibility v1.0, Competitor Gap, Opportunity Score
│       ├── audit/              Sprint 4E: Audit Generator
│       ├── scout/              Sprint 4F: Scout workflow state machine
│       ├── finance/            Finance Ledger: money, ledger, validation, reports
│       ├── mission-adapters.ts Real Mission Queue integrations (audit, finance)
│       ├── firebase-adapter.ts Future Firebase seam
│       ├── local-store.ts      Existing snapshot store
│       └── visibility-score.ts Scoring engine
└── .replit-artifact/           Artifact routing and workflow manifest
```

## Recommended next steps

1. Resolve the remaining Mission Queue open questions (dynamic assignment
   rules, Firestore persistence timing) in
   [SPEC-003-MissionQueue.md](./docs/specs/SPEC-003-MissionQueue.md) before
   connecting real AI execution.
2. Add focused smoke tests for both CRM and Mission Queue: create/edit/delete,
   status transitions, approval flows, search, filters, and mobile layout.
3. Consolidate the duplicate domain models: remove the legacy CRM block in
   `atlas-pages.tsx` and resolve the `atlas-data.ts` filename collision, after
   confirming no stored data or route depends on either.
4. Add schema validation and versioned migrations around localStorage before
   introducing more local-first workflows (now covering both CRM and Mission
   Queue).
5. Implement Firestore-backed providers behind `CrmLeadRepository` and
   `MissionQueueRepository` together, only after authentication and workspace
   ownership rules are defined.
6. Add a `lint` script and a minimal automated test suite before Sprint 4
   (Visibility Engine) grows the surface area further.
7. Do not begin Sprint 4 (Visibility Engine) implementation until this
   documentation pass is reviewed.
