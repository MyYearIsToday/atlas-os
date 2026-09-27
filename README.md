# Atlas OS

> **Status:** Active — Sprint 2 complete
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [ATLAS.md](./ATLAS.md) · [ATLAS_PRINCIPLES.md](./ATLAS_PRINCIPLES.md) · [PROJECT_STATE.md](./PROJECT_STATE.md) · [docs/handoff/HANDOFF.md](./docs/handoff/HANDOFF.md)

Atlas OS is the internal business operating system for MapSpark Ghana. It
gives the CEO one place to see revenue, move leads, manage clients, operate AI
employees, generate Google Business Profile visibility scores, and protect the
company's financial controls.

This build is intentionally Firebase-ready but Firebase credentials are not
connected yet. The app runs with a persisted local data provider so the
product surface and workflows can be exercised immediately without putting
credentials in the repository.

## Handoff status

The current handoff package is **Atlas OS 1.0.0 — Sprint 2 CRM Foundation**.
The project typechecks and produces a production build with the existing Atlas
visual system unchanged (verified 2026-09-15 — see
[PROJECT_STATE.md § Verification methodology](PROJECT_STATE.md#verification-methodology-2026-09-15)
for exactly what was checked and how). See [PROJECT_STATE.md](PROJECT_STATE.md)
for the current scope and known issues, and
[docs/handoff/HANDOFF.md](docs/handoff/HANDOFF.md) for the continuation guide.

## Read this first

**Every AI engineer starts at [ATLAS_INDEX.md](ATLAS_INDEX.md)** — it's the
mandatory onboarding document (reading order, current status, CEO authority
reminder, and a Before You Build checklist), required by
[ATLAS.md](ATLAS.md#mandatory-ai-entry-protocol). This table is a quick
reference, not a substitute for it.

| Document | Purpose |
|---|---|
| [ATLAS_INDEX.md](ATLAS_INDEX.md) | Mandatory AI onboarding document — reading order, current status, CEO authority reminder, Before You Build checklist. |
| [ATLAS.md](ATLAS.md) | The Constitution — company mission, product suite, AI hierarchy, approval engine, design system, coding standards. Immutable without CEO approval. |
| [ATLAS_PRINCIPLES.md](ATLAS_PRINCIPLES.md) | Twelve non-negotiable rules, one page. |
| [PROJECT_STATE.md](PROJECT_STATE.md) | What's built, what isn't, known issues, verified vs. unable-to-verify. |
| [AI_REGISTRY.md](AI_REGISTRY.md) | Which AI worker fills which Atlas employee role right now. |
| [PROMOTION_BOARD.md](PROMOTION_BOARD.md) | Candidate workers and what it takes to promote one. |
| [DECISION_LOG.md](DECISION_LOG.md) | Dated record of major decisions and why they were made. |
| [docs/company/](docs/company/) | CEO role, AI employee detail, product definitions, roadmap, [cross-product operating spec](docs/company/OPERATING_SPEC.md) |
| [docs/specs/](docs/specs/) | Numbered specs — brand system, CRM, Mission Queue, [MapSpark product spec](docs/specs/SPEC-004-MapSpark.md) |
| [docs/handoff/HANDOFF.md](docs/handoff/HANDOFF.md) | Everything the next engineer needs to continue. |

## Product surface

### Mission Control

- KPI overview for revenue, leads, active clients, visibility score, and
  trading protection.
- Activity feed showing what Atlas employees have done.
- Today's missions with progress and completion state.

### AI Employees

Atlas has five operating agents:

- **Scout AI** — market intelligence and opportunity discovery.
- **Builder AI** — GBP audit production and client deliverables.
- **Operator AI** — routing, delivery, and systems operations.
- **Closer AI** — proposals, follow-ups, and revenue movement.
- **Finance AI** — cash visibility and financial controls.

Each employee has a status, active task, update time, queue size, and daily
completion count.

### CRM

The sales pipeline is organized into Prospect, Contacted, Replied, Proposal
Sent, Won, and Lost. Sprint 2 turns this into a local-first CRM foundation:

- Lead records cover business identity, category, location, contact details,
  website, Google Maps URL, visibility score, stage, contact dates, follow-up
  date, notes, and estimated deal value.
- Leads can be created, edited, deleted, opened in a detail drawer, searched,
  filtered by stage/category/follow-up state, and moved between stages.
- Existing `atlas-deals` local data is migrated into the new CRM record shape
  the first time the CRM loads.
- `src/services/crm.ts` owns the repository contract and localStorage provider;
  Firebase can replace the provider later without changing the UI components.

### Clients

Client records include account health, visibility score history, review count,
rating, photo count, notes, contact details, and next upsell opportunities.

### Visibility Score Generator

The scoring engine evaluates:

- Profile Completeness
- Reviews
- Photos
- Local SEO
- Business Info
- Engagement

It returns a weighted score, grade, recommendation, and shareable report
content. The calculation lives in `src/services/visibility-score.ts` so it can
be reused by future API or Firebase implementations.

### Atlas Leaderboard

The Atlas Leaderboard (renamed from "Atlas Index" 2026-09-15 — see
[DECISION_LOG.md](DECISION_LOG.md) — not to be confused with
[ATLAS_INDEX.md](ATLAS_INDEX.md), the AI onboarding document) ranks
businesses by visibility score and shows category, location, review volume,
and week-over-week movement.

### Finance

Finance includes a revenue and expense ledger with pending/cleared status. The
trading section is present but locked by design. It does not expose execution
controls.

### Settings

Settings include workspace identity, timezone, notification preferences,
compact mode, and an explicit Firebase integration state. The state is visible
so the team knows the app is operating locally until credentials are connected.

## Folder map

```text
src/
├── agents/                 AI employee registry and task contracts
├── apis/                   External API boundaries and unavailable provider guard
├── automations/            Scheduled automation definitions
├── components/             Reusable UI primitives and product components
│   └── crm/                Lead card, form, and detail components
├── hooks/                  Shared React hooks
├── pages/                  Route-level screens and fallback states
├── services/
│   ├── atlas-data.ts       Domain types and starter workspace data
│   ├── crm.ts              CRM lead repository, types, seed data, and migration
│   ├── firebase-adapter.ts Future Firestore/Auth/Storage provider contract
│   ├── local-store.ts      Persisted local snapshot store
│   ├── use-atlas-store.ts  React subscription hook for the local store
│   └── visibility-score.ts Weighted scoring engine
├── App.tsx                 Application shell and routing
├── index.css               Atlas dark theme tokens and global styles
└── main.tsx                React entry point
```

## Architecture

Atlas separates domain data from presentation. Screens consume typed domain
objects and service functions instead of embedding scoring math, provider
calls, or persistence logic inside components.

The current persistence path is:

```text
UI → useAtlasStore → local-store → browser localStorage
```

The Sprint 2 CRM persistence path is intentionally isolated:

```text
CRM UI → useCrmLeads → CrmLeadRepository → localCrmRepository → browser localStorage
```

The intended production path is:

```text
UI → domain services → Firebase provider → Firestore/Auth/Storage
```

`src/services/firebase-adapter.ts` is the provider seam. It is intentionally
not initialized until Firebase configuration is available. This keeps the
current app functional and prevents credentials from being committed.

## Local development

This package is developed inside a pnpm monorepo. Installing or building it
standalone, outside that monorepo, will fail — see
[PROJECT_STATE.md § Build Compatibility Notes](PROJECT_STATE.md#build-compatibility-notes)
for exactly why and how this was still independently verified for this
handoff.

From the workspace root:

```bash
pnpm --filter @workspace/atlas-os run dev
```

The managed app workflow provides the port and base path automatically.

Useful checks:

```bash
pnpm --filter @workspace/atlas-os run typecheck
pnpm --filter @workspace/atlas-os run build
```

A prior handoff noted a non-blocking Vite sourcemap warning from the template
tooltip primitive during build. This was independently re-tested on
2026-09-15, including with sourcemaps explicitly enabled, and did not
reproduce — the build currently completes with no warnings. See
[PROJECT_STATE.md § Known issues](PROJECT_STATE.md#known-issues) for the
correction record.

## Future roadmap

1. **Firebase connection** — connect Firebase Authentication, Firestore, and
   Storage through Replit Secrets and implement the `AtlasDataProvider`
   contract.
2. **Google Business Profile ingestion** — connect verified profile data and
   replace local score inputs with measured signals.
3. **AI employee execution** — connect Replit AI Integrations behind agent
   services and persist task runs, approvals, and audit events.
4. **Team access** — add role-based workspace access and approval boundaries
   for CEO, operator, and finance actions.
5. **Reports and delivery** — generate stored client reports and send approved
   share links.
6. **Finance controls** — connect accounting data and maintain the trading
   lock as a separate, auditable capability boundary.
7. **Observability** — add structured event history, error tracking, and
   performance metrics for each agent and automation.

## Safety boundaries

- No Firebase credentials are stored in this repository.
- The current app uses seeded starter data and browser persistence only.
- Trading is visibly locked and has no execution path.
- External providers are isolated behind service boundaries.
- Any future AI write action should remain approval-aware and auditable.