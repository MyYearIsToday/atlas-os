# SPEC-002 — CRM (Sprint 2 Foundation)

> **Status:** Implemented — Sprint 2 complete
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md#sprint-workflow) · [../../PROJECT_STATE.md](../../PROJECT_STATE.md) · [../handoff/HANDOFF.md](../handoff/HANDOFF.md) · [SPEC-003-MissionQueue.md](./SPEC-003-MissionQueue.md)

This spec describes what Sprint 2 (CRM) actually built, as independently verified against the codebase on 2026-09-15. It is documentation of an implemented system, not a forward-looking plan — for what comes after CRM, see [SPEC-003-MissionQueue.md](./SPEC-003-MissionQueue.md).

## Scope

A local-first sales pipeline for MapSpark Ghana's lead-to-client workflow. Six stages: Prospect → Contacted → Replied → Proposal Sent → Won / Lost.

## Data model

Defined in `src/services/crm.ts`. Each `Lead` record has:

business name, category, location, contact name, phone, email, website, Google Maps URL, visibility score, status (`LeadStatus`), last contact date, next follow-up date, notes, estimated deal value.

`LeadInput` is `Lead` minus `id` — used for both create and edit forms.

## Architecture

```text
CRM UI → useCrmLeads() → CrmLeadRepository → localCrmRepository → browser localStorage
```

- `CrmLeadRepository` is an interface (`getSnapshot`, `subscribe`, `create`, `update`, `remove`) — a deliberate seam so a Firebase- or API-backed repository can replace `localCrmRepository` later without touching any component.
- `useCrmLeads()` (in `crm.ts`) wraps `useSyncExternalStore` around the repository, so React components re-render on any local mutation.
- Storage key: `atlas-os:crm-leads:v2`. A legacy key, `atlas-deals`, is migrated automatically on first load if the new key is empty (see `migrateLegacyDeals()` in `crm.ts`).

## UI components

| Component | File | Responsibility |
|---|---|---|
| `CrmPage` | `src/pages/crm-page.tsx` | Stage columns, search, filters, pipeline health summary |
| `LeadCard` | `src/components/crm/lead-card.tsx` | Compact card per lead, inline status change |
| `LeadDetailPanel` | `src/components/crm/lead-detail-panel.tsx` | Slide-over detail view, edit/delete entry points |
| `LeadForm` | `src/components/crm/lead-form.tsx` | Shared create/edit form |

## Verified functionality (2026-09-15 independent re-verification)

| Capability | Status |
|---|---|
| Create, edit, delete leads | Verified — code path traced end-to-end through `crm.ts` repository methods |
| Stage change (inline dropdown on card, and via edit form) | Verified |
| Detail drawer | Verified |
| Search (business, contact, phone, email, website, notes) | Verified — `crm-page.tsx` builds a combined haystack per lead |
| Category / status / follow-up filtering | Verified |
| Local mock data (6 seeded leads) | Verified — seeded in `crm.ts`, realistic Ghana business data |
| Migration from legacy `atlas-deals` key | Verified by code review; not exercised against a real legacy localStorage payload in this pass |
| Mobile responsiveness | Verified by code review — `grid md:grid-cols-2 xl:grid-cols-6`, `flex-col sm:flex-row` patterns throughout; not verified via rendered browser screenshot in this environment |
| TypeScript correctness | Verified — `tsc --noEmit` passes with zero errors (via workaround, see [PROJECT_STATE.md § Build Compatibility Notes](../../PROJECT_STATE.md#build-compatibility-notes)) |
| Production build | Verified — `vite build` completes successfully (via workaround, same caveat) |

## Known issues (see also [PROJECT_STATE.md](../../PROJECT_STATE.md#known-issues))

- **Legacy CRM code**: `src/pages/atlas-pages.tsx` still contains a full, unrouted legacy `CrmPage` implementation (deals, `useLocalState('atlas-deals', ...)`, its own `DealCard`). Confirmed unrouted — `App.tsx` imports `CrmPage` only from `src/pages/crm-page.tsx`. Retained intentionally for now; scheduled for removal in a future consolidation pass, not in this handoff.
- **Duplicate file name, different purpose**: `src/lib/atlas-data.ts` (72 lines, legacy types/seed data used only by `atlas-pages.tsx`) and `src/services/atlas-data.ts` (580 lines, the active domain model used by `crm.ts`, `local-store.ts`, `visibility-score.ts`) share a filename but are unrelated. This is not a build error — TypeScript resolves both correctly via distinct paths — but it is a real institutional-memory hazard for a future engineer scanning by filename. Recommend renaming or removing `src/lib/atlas-data.ts` in the same consolidation pass that removes the legacy CRM code.
- No automated test suite exists. Verification above is typecheck + build + code review, not a browser or unit test run.

## Out of scope (by design, per Sprint 2 boundaries)

Firebase/Firestore/Auth connection, server persistence, multi-user tenancy, AI-executed outreach, CRM activity timeline, reminders, import/export, bulk operations, audit history. See [PROJECT_STATE.md § Incomplete features](../../PROJECT_STATE.md#incomplete-features) for the full list.
