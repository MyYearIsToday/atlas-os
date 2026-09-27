# Roadmap

> **Status:** Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md#company-mission--vision) · [PRODUCTS.md](./PRODUCTS.md) · [../../PROJECT_STATE.md](../../PROJECT_STATE.md) · [../specs/](../specs/)

Two roadmaps run in parallel at Atlas: the **company phase roadmap** (which product ships next) and the **engineering sprint roadmap** (what the shared operating system needs next). This document tracks both and how they relate.

## Company phase roadmap

| Phase | Goal | Status |
|---|---|---|
| Phase 1 | MapSpark Ghana | In development |
| Phase 2 | ContentSpark | Not started |
| Phase 3 | LeadSpark | Not started |
| Phase 4 | TradeSpark | Not started |
| Phase 5 | Atlas AI Workforce | Not started |

## Engineering sprint roadmap

| Sprint | Goal | Status |
|---|---|---|
| Sprint 1 | Dashboard | Complete |
| Sprint 2 | CRM | Complete — see [PROJECT_STATE.md](../../PROJECT_STATE.md) |
| Sprint 3 | Mission Queue | Complete — foundation implemented, see [PROJECT_STATE.md](../../PROJECT_STATE.md) and [SPEC-003-MissionQueue.md](../specs/SPEC-003-MissionQueue.md) |
| Sprint 4 | MapSpark Visibility Engine | Not started — specification at [SPEC-004-MapSpark.md](../specs/SPEC-004-MapSpark.md) |
| Sprint 5 | Atlas Leaderboard | Scaffold exists (`/atlas-leaderboard`, static mock data) — full evidence-backed version not started. Renamed from "Atlas Index" 2026-09-15, see [DECISION_LOG.md](../../DECISION_LOG.md) |
| Sprint 6 | Automation | Not started |

## How the two roadmaps relate

Every sprint in the engineering roadmap builds shared platform capability (CRM, Mission Queue, Finance, etc.) that every phase in the company roadmap depends on. Phase 1 (MapSpark Ghana) is the current proving ground: features are built for MapSpark first, but only kept if they generalize to the shared platform (see [The Atlas Promise](../../ATLAS.md#the-atlas-promise)).

Sprints do not start early. Sprint 3 (Mission Queue) does not begin until Sprint 2 (CRM) is verified complete and documented — see [DECISION_LOG.md](../../DECISION_LOG.md) for the 2026-09-15 decision to complete documentation before Sprint 3 begins.
