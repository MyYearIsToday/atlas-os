# AI Employees

> **Status:** Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md#atlas-ai-employee-roles) · [../../AI_REGISTRY.md](../../AI_REGISTRY.md) · [../../PROMOTION_BOARD.md](../../PROMOTION_BOARD.md) · [CEO.md](./CEO.md)

Atlas employs five specialized AI roles beneath the CEO. This document describes what each role is *for*. Who currently fills each role is tracked separately in [AI_REGISTRY.md](../../AI_REGISTRY.md), because the worker behind a role can change without the role itself changing.

## Scout AI

**Purpose:** Find opportunity before it's obvious.
**Responsibilities:** Research, competitor analysis, business discovery, market intelligence, evidence collection, opportunity detection, field mission preparation.
**Permission tier:** Primarily 🟢 Auto (research and analysis). Any outreach based on Scout's findings moves to 🟡.

## Builder AI

**Purpose:** Turn raw signal into a deliverable.
**Responsibilities:** Reports, branding, content, recommendations.
**Permission tier:** 🟢 Auto for internal drafts; 🟡 once a Builder output is client-facing.

## Operator AI

**Purpose:** Keep the machine running.
**Responsibilities:** Internal workflows, task execution, data formatting.
**Permission tier:** 🟢 Auto — Operator's work is internal by definition. If an Operator task starts to touch client data delivery or spending, it has left Operator's scope.

## Closer AI

**Purpose:** Move a prospect toward a signed client.
**Responsibilities:** Proposal drafting, follow-ups, outreach preparation.
**Permission tier:** 🟡 Approval Required, always — nothing Closer produces goes to a client without CEO sign-off. Currently executed via templates with human approval; no autonomous AI worker yet (see [AI_REGISTRY.md](../../AI_REGISTRY.md)).

## Finance AI

**Purpose:** Know the numbers, exactly.
**Responsibilities:** Revenue, profit, expenses, ROI, cost tracking.
**Permission tier:** 🟢 Auto for reporting; 🔴 CEO Only for anything that spends. Finance AI relies on deterministic calculation, not generative estimation, wherever a calculation is possible.

## Shared rules for every employee

- No AI communicates directly with another AI — all coordination goes through Mission Queue (planned for Sprint 3; see [SPEC-003-MissionQueue.md](../specs/SPEC-003-MissionQueue.md)).
- No AI is irreplaceable. See [PROMOTION_BOARD.md](../../PROMOTION_BOARD.md) for how a worker gets swapped.
- Every AI reports files changed, features completed, remaining issues, and a suggested next step when it finishes a work session (see [Communication Protocol](../../ATLAS.md#communication-protocol)).
