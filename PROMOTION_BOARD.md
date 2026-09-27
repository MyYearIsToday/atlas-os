# Promotion Board

> **Status:** Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [AI_REGISTRY.md](./AI_REGISTRY.md) · [ATLAS.md](./ATLAS.md#atlas-ai-employee-roles) · [DECISION_LOG.md](./DECISION_LOG.md)

Tracks candidate workers for each Atlas AI employee role, and the criteria a candidate must meet before it replaces the current worker in [AI_REGISTRY.md](./AI_REGISTRY.md). No AI is irreplaceable; this board is where that principle becomes a process.

## Promotion Criteria (applies to every role)

A candidate worker is eligible for promotion when it can demonstrably:

1. Perform the role's responsibilities (see [ATLAS.md](./ATLAS.md#atlas-ai-employee-roles)) at or above the current worker's quality.
2. Respect the Approval Engine — it must not act outside its permission tier.
3. Communicate only through Mission Queue once Mission Queue exists (Sprint 3+); until then, through the agreed interim channel.
4. Be measurably better on at least one axis: accuracy, cost, latency, or capability the current worker lacks.

Promotions are 🔴 CEO Only. A promotion is not executed until it has a CEO-approved entry in [DECISION_LOG.md](./DECISION_LOG.md) and the registry is updated.

## Board

| Role | Current Worker | Candidate | Readiness | Blocking Criteria |
|---|---|---|---|---|
| Scout AI | Perplexity | Astra Research | Not yet available | Astra Research does not exist as a usable worker yet |
| Builder AI | Gemini | Astra | Not yet available | Astra general capability not yet available |
| Operator AI | OpenRouter Free Models | GPT-6 Astra Computer Use | Not yet available | Computer-use capability not yet available |
| Closer AI | Templates + human approval | — | No candidate proposed | Awaiting a candidate with reliable 🟡 Approval Required behavior |
| Finance AI | Atlas Logic | — | No candidate proposed | Current worker satisfies the deterministic-calculation requirement |

## How to propose a candidate

1. Add a row (or update an existing one) with the candidate name and current readiness.
2. List the specific blocking criteria from the list above that are unmet.
3. When all criteria are met, log the promotion decision in [DECISION_LOG.md](./DECISION_LOG.md) and wait for CEO approval before updating [AI_REGISTRY.md](./AI_REGISTRY.md).
