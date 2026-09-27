# Atlas OS Engineering Handoff

> **Status:** Active — current as of the 2026-09-15 documentation and verification pass
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md) · [../../ATLAS_PRINCIPLES.md](../../ATLAS_PRINCIPLES.md) · [../../PROJECT_STATE.md](../../PROJECT_STATE.md) · [../specs/SPEC-002-CRM.md](../specs/SPEC-002-CRM.md) · [../specs/SPEC-003-MissionQueue.md](../specs/SPEC-003-MissionQueue.md) · [../../DECISION_LOG.md](../../DECISION_LOG.md)

This document is for the engineer continuing Atlas after the Sprint 2 CRM
Foundation. It describes the current implementation, what is intentionally
local-only, and where to work next.

**Read [ATLAS.md](../../ATLAS.md) and [ATLAS_PRINCIPLES.md](../../ATLAS_PRINCIPLES.md)
first** — they cover company context, the AI employee hierarchy, and the
approval engine that this handoff assumes you already know. This document
stays scoped to engineering continuity.

## Architecture

Atlas is a React 19 + Vite application using TypeScript, Wouter routing,
Tailwind CSS v4, and the existing Atlas dark visual system. The app runs as the
`artifacts/atlas-os` web artifact inside the workspace.

The application entry points are:

- `src/main.tsx` — React bootstrap and global styles.
- `src/App.tsx` — providers, shell, and route table.
- `src/components/atlas-shell.tsx` — sidebar, header, page intro, and shared
  KPI/section primitives.
- `src/pages/atlas-pages.tsx` — the original non-CRM product screens.
- `src/pages/crm-page.tsx` — the routed Sprint 2 CRM screen.

The CRM deliberately does not call the API server. Its current data flow is:

```text
CRM page
  → reusable CRM components
  → useCrmLeads()
  → CrmLeadRepository contract
  → localCrmRepository
  → browser localStorage
```

`src/services/crm.ts` is the provider boundary. A future Firebase or API
implementation should satisfy the repository interface and preserve the `Lead`
and `LeadInput` contracts. The UI should not need to know whether the data is
local, remote, or synchronized.

## Design system

Do not introduce a new visual language for Atlas. The current system uses:

- Deep navy backgrounds around `#0B1F3A`.
- Gold actions and signal accents around `#D4AF37`.
- Teal success/online state around `#16A085`.
- Sora for display headings.
- Inter for application text.
- JetBrains Mono for labels, statuses, and metadata.
- Subtle grid texture, thin blue-gray borders, rounded cards, and restrained
  fade-up motion.

Use the existing `cardClass`, `buttonClass`, `ghostButton`, `PageIntro`,
`SectionLabel`, `MetricCard`, and focus-ring conventions before creating new
variants. Preserve the responsive shell and do not redesign unrelated pages.

## Current sprint

Sprint 2 is complete at the foundation level:

- Pipeline stages are fixed to Prospect, Contacted, Replied, Proposal Sent,
  Won, and Lost.
- Lead records contain business/contact identity, web/map links, visibility
  score, status, contact dates, follow-up date, notes, and estimated deal value.
- Create, edit, delete, stage updates, search, filters, and a responsive lead
  detail panel are available.
- Existing legacy `atlas-deals` local data is migrated into the new schema on
  first CRM load.

Do not start Mission Queue in this handoff. That belongs to Sprint 3.

## Next sprint

Sprint 3 should be Mission Queue, but it is not implemented. A planning spec
with these open questions already recorded is at
[SPEC-003-MissionQueue.md](../specs/SPEC-003-MissionQueue.md) — extend that
document rather than starting fresh. Before coding, define:

- Mission ownership and workspace boundaries.
- Queue state transitions and completion rules.
- Human approval requirements for AI-generated actions.
- Whether missions are local-first or provider-backed.
- Notification and audit expectations.

Avoid coupling Mission Queue to the CRM repository until those decisions are
made.

## Important files

### CRM

- `src/pages/crm-page.tsx` — route-level CRM composition, filtering, and modal
  state.
- `src/components/crm/lead-card.tsx` — reusable pipeline card and inline stage
  change.
- `src/components/crm/lead-form.tsx` — controlled create/edit form for all lead
  fields.
- `src/components/crm/lead-detail-panel.tsx` — responsive detail drawer with
  contact links and destructive action.
- `src/services/crm.ts` — lead domain types, seed data, migration, local
  persistence, repository seam, and date helpers.
- `src/services/index.ts` — service barrel export.

### Shell and routes

- `src/App.tsx` — route table; `/crm` imports the Sprint 2 page.
- `src/components/atlas-shell.tsx` — global navigation and responsive frame.
- `src/index.css` — theme tokens, fonts, grid background, and shared motion.

### Existing provider seams

- `src/services/firebase-adapter.ts` — intentionally paused Firebase
  Auth/Firestore/Storage contract.
- `src/apis/index.ts` — intentionally unavailable external API boundary.
- `src/agents/index.ts` — AI employee registry/task contracts.
- `src/automations/index.ts` — automation declarations without a runner.

## Run and verify

From the workspace root:

```bash
pnpm --filter @workspace/atlas-os run typecheck
pnpm --filter @workspace/atlas-os run build
```

The managed Atlas workflow uses:

```bash
pnpm --filter @workspace/atlas-os run dev
```

The workflow serves the artifact at `/`. The production build outputs
`artifacts/atlas-os/dist/public`; generated `dist/` and `node_modules/` content
should not be committed to the handoff ZIP or Git repository.

## Known handoff constraints

Independently re-verified 2026-09-15 (methodology: [PROJECT_STATE.md § Verification methodology](../../PROJECT_STATE.md#verification-methodology-2026-09-15)):

- Firebase is not connected and no credentials belong in the repository.
- LocalStorage data is not a production database and has no auth or tenancy.
- The old CRM block remains in `src/pages/atlas-pages.tsx` as legacy code; the
  active route is the new `src/pages/crm-page.tsx`. **Confirmed** by tracing
  `App.tsx`'s imports — `CrmPage` is only imported from `crm-page.tsx`.
- **New finding:** `src/lib/atlas-data.ts` and `src/services/atlas-data.ts` are
  two unrelated files sharing a filename — the former is legacy, used only by
  `atlas-pages.tsx`; the latter is the active domain model. Not a build error,
  but a naming hazard. Recommend resolving alongside the legacy CRM cleanup
  above. Full detail in [SPEC-002-CRM.md](../specs/SPEC-002-CRM.md#known-issues).
- There are no automated browser/unit tests yet, and no `lint` script is
  configured.
- **Correction:** the previously claimed non-blocking sourcemap warning from
  the tooltip primitive did not reproduce on re-test (including with
  sourcemaps explicitly enabled). Retracted — see
  [PROJECT_STATE.md § Known issues](../../PROJECT_STATE.md#known-issues) for
  the full correction record.
- This package cannot be installed or built standalone outside its pnpm
  monorepo (`zod: "catalog:"`, `tsconfig.json`'s `extends` path). This was
  independently verified anyway via a scratch-copy workaround — see
  [PROJECT_STATE.md § Build Compatibility Notes](../../PROJECT_STATE.md#build-compatibility-notes).
  Both `tsc --noEmit` and `vite build` passed cleanly.

## Handoff commit

This ZIP does not include Git history and no Git operations were run against
it (per CEO decision, see [DECISION_LOG.md](../../DECISION_LOG.md)). When this
snapshot's changes are applied to the GitHub repository, the recommended
commit message is:

```text
v0.3 - Atlas Constitution
```

## Recommended continuation order

1. Add CRM smoke tests without changing the visual system.
2. Consolidate the legacy CRM/domain models in a dedicated cleanup change.
3. Define auth/workspace ownership and provider contracts.
4. Implement a Firebase/API repository behind `CrmLeadRepository`.
5. Plan and build Sprint 3 Mission Queue separately.