# Atlas Index — Table of Truth

> **Status:** Foundational Document — Immutable without CEO approval
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Last Constitutional Version:** ATLAS.md v2.1
> **Related Documents:** [ATLAS.md](./ATLAS.md) · [ATLAS_PRINCIPLES.md](./ATLAS_PRINCIPLES.md) · [docs/company/OPERATING_SPEC.md](./docs/company/OPERATING_SPEC.md) · [PROJECT_STATE.md](./PROJECT_STATE.md) · [DECISION_LOG.md](./DECISION_LOG.md)

> ## Every AI starts here.

This is the official onboarding document for every AI worker in Atlas — Claude, Replit, GPT, Gemini, Astra, Manus, OpenRouter-connected models, and any future AI worker. It is the entry point required by the [Mandatory AI Entry Protocol](./ATLAS.md#mandatory-ai-entry-protocol) in `ATLAS.md`.

**Naming disambiguation (resolved 2026-09-15, CEO Decision 004):** "Atlas Index" previously referred to two unrelated things in this repository — this document, and a leaderboard feature that already exists in the app (`src/pages/atlas-pages.tsx`'s `LeaderboardPage`, at `/atlas-leaderboard`). The CEO resolved this permanently: **this document keeps the name "Atlas Index."** The product feature has been renamed to **Atlas Leaderboard** everywhere — nav label, route, page title, and lead-source seed data. See [DECISION_LOG.md](./DECISION_LOG.md), 2026-09-15, "CEO Decision 004 — Rename the Atlas Index product feature."

## Document Purposes & Recommended Reading Order

Read in this order before taking any action:

| # | Document | Purpose |
|---|---|---|
| 1 | [ATLAS.md](./ATLAS.md) | The Constitution — identity, mission, authority, approval engine, principles. Immutable without CEO approval. |
| 2 | [ATLAS_PRINCIPLES.md](./ATLAS_PRINCIPLES.md) | One-page Core Philosophy + Operating Rules. |
| 3 | [docs/company/OPERATING_SPEC.md](./docs/company/OPERATING_SPEC.md) | Cross-product workflows, states, and data lifecycles. |
| 4 | [PROJECT_STATE.md](./PROJECT_STATE.md) | What's built, what isn't, current sprint, known issues, unresolved questions. |
| 5 | [DECISION_LOG.md](./DECISION_LOG.md) | Every major decision made and why — read before assuming something hasn't been decided yet. |
| 6 | The relevant product spec (e.g. [SPEC-004-MapSpark.md](./docs/specs/SPEC-004-MapSpark.md)) | Product-specific rules, data models, and constraints for whatever you're about to touch. |

Supporting references, read as needed rather than up front: [AI_REGISTRY.md](./AI_REGISTRY.md) (current AI worker per role), [PROMOTION_BOARD.md](./PROMOTION_BOARD.md) (AI performance/replacement), [docs/company/](./docs/company/) (CEO authority, employee roles, product definitions, roadmap), [docs/specs/](./docs/specs/) (brand, CRM, Mission Queue, MapSpark), [docs/handoff/HANDOFF.md](./docs/handoff/HANDOFF.md) (engineering continuity notes), [README.md](./README.md) (setup and build instructions).

## Current Status Snapshot

| Field | Value |
|---|---|
| **Current sprint** | Sprint 3 (Mission Queue foundation) complete; Sprint 4 (MapSpark Visibility Engine) not started |
| **Active product** | MapSpark Ghana (Phase 1) |
| **Current architectural status** | Constitutional layer complete (ATLAS.md v2.1, Operating Spec, SPEC-004-MapSpark); CRM and Mission Queue implemented local-first; Atlas Leaderboard exists as a static mock-data scaffold page (not the evidence-backed Sprint 5 version); no Firestore, no real AI execution, no Finance ledger yet |
| **Last constitutional version** | ATLAS.md v2.1 — see [DECISION_LOG.md](./DECISION_LOG.md) for what changed |

This snapshot is a pointer, not a substitute for reading [PROJECT_STATE.md](./PROJECT_STATE.md) in full — it will go stale faster than that document does.

## CEO Authority Reminder

The CEO is the final decision-maker. AI can recommend; **AI cannot silently decide.** Spending, pricing, trading, product launches, AI employee replacement, and major strategy or contractual decisions are 🔴 CEO Only, always — see [ATLAS.md § Approval Engine](./ATLAS.md#approval-engine) and [§ Human Accountability](./ATLAS.md#human-accountability).

## Before You Build — Checklist

Confirm all of the following before writing code, modifying documentation, making an architectural decision, or creating a new system:

- [ ] I opened the Atlas Index (this document).
- [ ] I read the Constitution (`ATLAS.md` and `ATLAS_PRINCIPLES.md`).
- [ ] I checked `PROJECT_STATE.md`.
- [ ] I checked `DECISION_LOG.md`.
- [ ] I verified whether what I'm about to build already exists.
- [ ] I understand the current sprint and am not starting a later sprint's scope.
- [ ] I know which product I'm modifying, and whether it should reuse shared Atlas infrastructure instead of building its own.
- [ ] I know whether what I'm about to do requires 🟡 or 🔴 approval before it goes further.

If any box can't honestly be checked, stop and resolve it before proceeding — see [ATLAS.md § Mandatory AI Entry Protocol](./ATLAS.md#mandatory-ai-entry-protocol).
