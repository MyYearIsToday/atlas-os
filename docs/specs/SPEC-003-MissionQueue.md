# SPEC-003 — Mission Queue (Sprint 3 Planning)

> **Status:** Foundation implemented (Sprint 3) — some open questions remain
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md#mission-queue) · [../../PROJECT_STATE.md](../../PROJECT_STATE.md) · [SPEC-002-CRM.md](./SPEC-002-CRM.md) · [../company/EMPLOYEES.md](../company/EMPLOYEES.md)

Sprint 3 implemented the Mission Queue foundation described below. This document originally captured the Constitution's definition plus open questions to resolve before implementation; the [Implementation Notes](#implementation-notes-sprint-3) section records how those questions were resolved by the Sprint 3 brief, and which remain genuinely open.

## What Mission Queue is (from the Constitution)

Mission Queue is Atlas's nervous system. Every job becomes a structured task. No AI communicates directly with another AI — every AI communicates through Mission Queue.

Baseline schema from [ATLAS.md](../../ATLAS.md#mission-queue):

| Field | Purpose |
|---|---|
| `taskId` | Unique ID |
| `assignedAI` | Worker |
| `priority` | Importance |
| `approvalRequired` | Permission level |
| `status` | Progress |

## Open questions to resolve before implementation

These must be answered — and logged in [DECISION_LOG.md](../../DECISION_LOG.md) — before Sprint 3 code is written:

1. **Mission data ownership.** Does a mission belong to the CRM lead/client it relates to, to the AI employee assigned, or is it its own top-level entity referencing both?
2. **Queue states.** The baseline schema has `status: Progress` but no defined state machine. Minimum needed: created → assigned → in progress → awaiting approval (if 🟡/🔴) → complete / rejected.
3. **Assignment rules.** Manual CEO assignment, rule-based routing by task type, or AI self-selection from a shared queue?
4. **Approval behavior.** How does a 🟡 Approval Required mission surface for CEO review — inline in the queue UI, a separate approval inbox, or both? What happens to a 🔴 CEO Only mission that a non-CEO AI attempts to create?
5. **Relationship to CRM.** Should a lead's stage change (e.g. `Contacted` → `Replied`) automatically generate a Mission Queue task for follow-up, or remain a manual CRM action until Mission Queue exists?
6. **Persistence.** Sprint 2 CRM uses local-first `localStorage` (see [SPEC-002-CRM.md](./SPEC-002-CRM.md)). Should Mission Queue follow the same pattern for consistency, or does its cross-employee nature require a different persistence strategy sooner?

## Non-goals for Sprint 3 (to be confirmed at planning time)

- AI employees do not gain autonomous execution ability just because Mission Queue exists — the Approval Engine still applies per mission.
- Mission Queue is not a chat interface between AIs; it is a structured task store. Direct AI-to-AI messaging is explicitly disallowed by [ATLAS.md](../../ATLAS.md#mission-queue).

## Implementation Notes (Sprint 3)

Resolution of the open questions above, as directed by the Sprint 3 brief and implemented in `src/services/mission-queue.ts`:

1. **Mission data ownership** — resolved. `Task` is its own top-level entity in `mission-queue.ts`, with a loose optional `clientId` string referencing a CRM lead id (not a hard foreign key) and `assignedAI: AgentId` referencing `src/agents`' existing registry.
2. **Queue states** — resolved. `Pending → In Progress → (Waiting Approval if not Auto) → Completed`. Implemented as `nextForwardStatus()`; Auto-approval tasks skip Waiting Approval and complete directly from In Progress.
3. **Assignment rules** — **still open.** Sprint 3 uses static seed assignment only; no rule-based or self-selecting assignment logic exists yet.
4. **Approval behavior** — resolved for this sprint. A dedicated Approval Center groups open tasks by Auto / Approval Required / CEO Only. From Task Detail, a Waiting Approval task offers "Approve & complete" or "Send back"; CEO Only tasks are visually distinguished (lock icon, red accent) but use the same underlying action — Sprint 3 has one operator (the CEO) using the app, so there is no enforced identity check preventing a non-CEO from clicking approve. That enforcement is a genuine gap once multiple humans/agents can act in the UI.
5. **Relationship to CRM** — resolved narrowly. Tasks do not auto-generate from CRM stage changes. `resolveClientLabel()` and `resolveClientDealValue()` provide read-only lookups from a task's `clientId` into the CRM's `localCrmRepository` snapshot, used for display and for the dashboard's "estimated value in motion" figure.
6. **Persistence** — resolved. Same pattern as CRM: browser localStorage, key `atlas-os:mission-queue:v1`, via a repository interface (`getSnapshot`/`subscribe`/`create`/`update`/`remove`/`advance`/`sendBackForRevision`) designed to be swapped for a Firestore-backed implementation without UI changes.

## Still open for a future sprint

- Dynamic/rule-based task assignment (question 3 above).
- Enforced approval identity — today, "who is allowed to click Approve" is not modeled at all.
- Firestore persistence (the interface supports it; no implementation exists).
- Real AI execution behind any task — Sprint 3 deliberately has no AI-generated results; see [Task Detail's "Completed" state notice](../../PROJECT_STATE.md#known-issues) for how this is surfaced honestly in the UI.
