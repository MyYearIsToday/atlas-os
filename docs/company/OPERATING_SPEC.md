# Atlas Operating Specification

> **Status:** Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md) · [../../ATLAS_INDEX.md](../../ATLAS_INDEX.md) · [../../ATLAS_PRINCIPLES.md](../../ATLAS_PRINCIPLES.md) · [../specs/SPEC-002-CRM.md](../specs/SPEC-002-CRM.md) · [../specs/SPEC-003-MissionQueue.md](../specs/SPEC-003-MissionQueue.md) · [../specs/SPEC-004-MapSpark.md](../specs/SPEC-004-MapSpark.md) · [EMPLOYEES.md](./EMPLOYEES.md)

`ATLAS.md` states Atlas's principles and authority structure. This document is the workflow-level detail underneath it: which actors do what, in what order, with what approval, producing what stored state. **Before using this document, complete the [Mandatory AI Entry Protocol](../../ATLAS.md#mandatory-ai-entry-protocol)** starting from [ATLAS_INDEX.md](../../ATLAS_INDEX.md) — this document assumes that context and does not repeat it. Where this document and a product spec (e.g. `SPEC-004-MapSpark.md`) both describe a workflow, this document holds the cross-product shape and the product spec holds the product-specific detail — they should not be read as contradicting each other; if they ever appear to, this document's actor/approval model wins and the product spec's detail should be corrected.

## Actors

| Actor | Type | Defined in |
|---|---|---|
| CEO | Human | [CEO.md](./CEO.md) |
| Scout AI, Builder AI, Operator AI, Closer AI, Finance AI | AI employee role | [EMPLOYEES.md](./EMPLOYEES.md), current worker in [AI_REGISTRY.md](../../AI_REGISTRY.md) |
| Customer / prospect | External | Represented as a CRM `Lead` record |
| Atlas systems (CRM, Mission Queue, Finance logic, Approval Engine) | Internal, non-AI | This document |

## Systems

| System | Purpose | Current implementation |
|---|---|---|
| CRM | Prospect/client pipeline and records | `src/services/crm.ts`, local-first |
| Mission Queue | Task backbone connecting AI employees to work | `src/services/mission-queue.ts`, local-first |
| Approval Engine | Three-tier permission gate on every AI action | Enforced by convention today (Task `approvalRequired` field); no separate service module yet |
| Atlas Brain | Institutional memory | `DECISION_LOG.md`, `AI_REGISTRY.md`, `PROMOTION_BOARD.md`, `PROJECT_STATE.md`, `docs/` |
| Finance | Deterministic revenue/cost logic | Dashboard KPI figures today; no dedicated ledger module yet — see [Financial Lifecycle](#financial-lifecycle) |

## Mission Lifecycle

States (as implemented in `src/services/mission-queue.ts`):

```text
Pending → In Progress → (Waiting Approval, if approvalRequired ≠ Auto) → Completed
                                        ↑___________________________________|
                                         (Send back for revision)
```

| State | Meaning | Who acts |
|---|---|---|
| `Pending` | Created, not started | Assigned AI employee starts it |
| `In Progress` | Assigned AI employee is working it | AI employee marks complete/submits for approval |
| `Waiting Approval` | Prepared, needs CEO sign-off (Approval Required or CEO Only tasks only) | CEO approves or sends back |
| `Completed` | Done | — |

A task's `approvalRequired` value (`Auto` / `Approval Required` / `CEO Only`) determines whether it passes through `Waiting Approval` at all — see [Approval Lifecycle](#approval-lifecycle) below. This resolves Mission Queue open question 2 from [SPEC-003-MissionQueue.md](../specs/SPEC-003-MissionQueue.md).

**Not yet implemented:** dynamic/rule-based task assignment (a mission is currently assigned to an AI employee at creation, by seed data or manual entry, not computed); enforced approval identity (today there is one human operator, so "who clicked approve" is not modeled).

## Approval Lifecycle

| Approval level | Path | Who can finalize |
|---|---|---|
| 🟢 Auto | `Pending → In Progress → Completed` | AI employee, no CEO step |
| 🟡 Approval Required | `Pending → In Progress → Waiting Approval → Completed` | CEO approves in the Approval Center |
| 🔴 CEO Only | Same path as Approval Required, with stronger visual distinction (lock icon) | CEO only — this level must never be executed automatically regardless of UI state |

See [ATLAS.md § Approval Engine](../../ATLAS.md#approval-engine) for the authority definition and [Failure Handling](../../ATLAS.md#failure-handling) for what happens when a "send back" occurs.

## CRM / Customer Lifecycle

**Current implementation** (`src/services/crm.ts`, Sprint 2): six stages —

```text
Prospect → Contacted → Replied → Proposal Sent → Won / Lost
```

**Target pipeline** (research-informed, not yet implemented) — a more granular pipeline was proposed during the 2026-09-15 constitutional pass:

```text
Identified → Researched → Contact Attempted → Replied → Qualified →
Audit Sent → Proposal Sent → Negotiation → Won (Awaiting Payment) →
Paid (Onboarding) → Lost → Nurture
```

**This is a documented conflict, not a silent change.** The current six-stage CRM is left exactly as implemented — no code was changed by this documentation pass, per [ATLAS_PRINCIPLES.md](../../ATLAS_PRINCIPLES.md)'s engineering-safety rules and this task's explicit instruction not to touch working CRM logic. The twelve-stage pipeline above is recorded as the **target model** a future CRM sprint should evaluate and reconcile against the live six-stage implementation (likely by inserting sub-states or CRM metadata rather than a breaking rename). See [DECISION_LOG.md](../../DECISION_LOG.md), 2026-09-15, "Record target CRM pipeline without changing the implemented pipeline."

| Field group | Fields |
|---|---|
| Identity | business, contact, category, location |
| Channel | contact channel, profile URL, consent, contact preference |
| Commercial | score, audit, proposal, value, next action |
| Outcome | loss reason, owner |

## Evidence Lifecycle

Every intelligence record (a Scout observation, a competitor data point, a scoring input) should be able to answer:

1. What do we know?
2. Where did we get it?
3. When was it observed?
4. Who/what produced it?
5. How confident are we?
6. Is it `OFFICIAL`, `OBSERVED`, `INDUSTRY_PRACTICE`, `HYPOTHESIS`, or `INFERRED`? (see [ATLAS.md § Evidence & Uncertainty Policy](../../ATLAS.md#evidence--uncertainty-policy))
7. Can we measure it?
8. What decision does it support?

Recommended evidence record shape (not yet implemented as a data model — see [SPEC-004-MapSpark.md § Core Data Objects](../specs/SPEC-004-MapSpark.md#core-data-objects)):

| Field | Purpose |
|---|---|
| `sourceUrlOrArtifact` | Where the evidence came from |
| `sourceType` | e.g. official doc, field observation, industry article |
| `publicationDate` / `retrievalDate` | When it was published vs. when Atlas captured it |
| `geography` | Where it applies |
| `methodology` | How it was produced |
| `confidence` | Atlas's confidence in it |
| `classification` | `OFFICIAL` / `OBSERVED` / `INDUSTRY_PRACTICE` / `HYPOTHESIS` / `INFERRED` |
| `claimType` | Observation vs. claim/interpretation |

Evidence is stored separately from AI's interpretation of it — an AI may write a summary or recommendation referencing evidence, but the evidence record itself is not overwritten by that interpretation.

## Product Lifecycle

```text
Market → Scout → Opportunity → Evidence → Visibility → Audit →
Proposal → Customer → Delivery → Outcome → Retention
```

This is MapSpark's customer-facing shape; see [SPEC-004-MapSpark.md § Customer Journey](../specs/SPEC-004-MapSpark.md#customer-journey) for the full per-stage input/process/role/approval/output breakdown. Future products (ContentSpark, LeadSpark) are expected to fit the same general shape — market signal in, evidence-based decision, human-approved action, measured outcome, retained relationship — reusing the same CRM and Mission Queue rather than inventing a parallel pipeline.

## AI Lifecycle

```text
Assigned a role → Performs within its Approval tier → Measured (AI Performance)
→ Reviewed on the Promotion Board → Promoted / Retained / Replaced (CEO Only)
```

See [ATLAS.md § AI Performance & Promotion](../../ATLAS.md#ai-performance--promotion), [AI_REGISTRY.md](../../AI_REGISTRY.md), and [PROMOTION_BOARD.md](../../PROMOTION_BOARD.md).

## Financial Lifecycle

```text
Revenue/cost event occurs → Recorded deterministically (Finance AI) →
Aggregated into margin/ROI/CAC/LTV → Reported → Informs 🔴 CEO Only pricing/spend decisions
```

**Implemented 2026-09-17** in `src/services/finance/`. This is the Finance Ledger foundation — no UI is wired to it yet, and Dashboard financial figures remain illustrative KPI values until a future sprint connects them.

- **Money (`money.ts`):** all amounts are `bigint` minor units plus a currency and scale — never floating-point. `decimalToMoney()`/`toDecimal()` convert to/from human-readable decimal strings without precision loss (`0.10 + 0.20 = 0.30` exactly, verified by `scripts/smoke-test-sprint4bf-finance.ts`). Currency conversion (`convert()`) always preserves the original `Money` alongside the converted value — originals are never overwritten.
- **Ledger (`ledger.ts`):** `OperationalLedger` only accepts `POSTED` transactions, rejects duplicate transaction IDs, and every post/reverse is written to an append-only audit trail. Reversing a transaction marks the original `REVERSED` rather than deleting or editing it — full history is preserved.
- **Validation (`validation.ts`):** enforces category-specific rules deterministically — e.g. a `REFUND` must reference the transaction it reverses, a `TRANSFER` must have both accounts, an `OWNER_WITHDRAWAL` cannot be tagged as product revenue.
- **Chart of Accounts / Journal Entries:** `Account` and `JournalEntry`/`JournalLine` types exist in `finance-types.ts` for double-entry-compatible bookkeeping; no chart-of-accounts UI or seed data exists yet.
- **Reports (`metrics.ts`):** `profitLoss()`, `cashFlow()`, and `clientProfitability()` (the CRM↔Finance link — see [CRM / Customer Lifecycle](#crm--customer-lifecycle)) are deterministic, period-scoped, and state their own limitations inline (e.g. "excludes unallocated shared costs") rather than implying completeness.
- **TradeSpark isolation:** `profitLoss()`/`cashFlow()` exclude `productId: "TradeSpark"` transactions **by default** — a caller must explicitly pass `{ includeTradeSpark: true }` to include them. This was a real gap in the originally-submitted patch (it computed operating reports without any TradeSpark filter at all) — see [DECISION_LOG.md](../../DECISION_LOG.md), 2026-09-17.
- **Reconciliation (`reconciliation.ts`):** compares a posted transaction against an external amount/reference and returns `MATCHED`/`PARTIAL`/`CONFLICT` — a mismatch is recorded, never silently resolved.
- **Allocation (`allocation.ts`):** shared-cost allocation across products requires an `APPROVED` `AllocationRule` before it will run — it throws rather than allocating under an unapproved methodology.
- **Approval policy (`approval-policy.ts`):** defines Auto/Approval-Required/CEO-Only categories matching [ATLAS.md § Approval Engine](../../ATLAS.md#approval-engine) exactly — reports/calculations are Auto; expense entries, vendor payments, and refunds are Approval Required; large expenditures, pricing changes, capital allocation, investment, trading capital, and owner withdrawals are CEO Only.
- **Mission Queue integration:** `src/services/mission-adapters.ts`'s `createMissionForFinanceApproval()` creates a real Mission Queue task for a transaction awaiting approval — it does not authorize anything itself; approval still happens through the ledger/Approval Engine.

**Not yet implemented:** budgets and recurring-expense scheduling have types (`Budget`, `RecurringExpense`) but no processing logic; AI cost attribution has a type (`AIUsageCost`) but nothing populates it yet; no UI exists anywhere in this layer.

## Research Lifecycle

```text
External research / field observation → Classified (see Evidence Lifecycle) →
Applied to scoring or strategy with its classification intact →
Never re-labeled to a stronger class without new evidence
```

See [ATLAS.md § Research Standards](../../ATLAS.md#research-standards) and [SPEC-004-MapSpark.md § Google Evidence Rule](../specs/SPEC-004-MapSpark.md#google-evidence-rule).

## Atlas Brain & Memory Lifecycle

```text
Decision/observation/outcome occurs → Recorded in the repository (Markdown today) →
Cross-linked from related documents → Available to any future AI session without conversation history
```

Current storage: Markdown files (`DECISION_LOG.md`, `AI_REGISTRY.md`, `PROMOTION_BOARD.md`, `PROJECT_STATE.md`, `docs/`) plus `localStorage`-backed CRM and Mission Queue data in the running application. **Not yet implemented:** structured, queryable storage for evidence and mission history at scale — Markdown and `localStorage` are adequate for the current single-operator, local-first stage but are noted as a future migration target once volume requires it.

## Incident Handling

See [ATLAS.md § Failure Handling](../../ATLAS.md#failure-handling). Operationally: a failure is recorded on the task/mission it occurred on, escalated to `Waiting Approval` or flagged rather than silently retried if it involves a 🟡/🔴 action, and — if it changes how Atlas should operate going forward — written up as a [DECISION_LOG.md](../../DECISION_LOG.md) entry so the lesson survives past the conversation that surfaced it.

## Measurement & Feedback Loops

Atlas's company-wide operating loop:

```text
Observe → Understand → Decide → Execute → Measure → Learn → Improve
```

MapSpark's application of it:

```text
Scout → Score → Audit → Proposal → Close → Deliver → Measure → Learn
```

Learning from one cycle should improve the next cycle's scouting, scoring, proposals, delivery, retention, and product design — this is why evidence and outcomes are recorded rather than discarded once a task is `Completed`.
