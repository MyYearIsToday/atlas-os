# AI Registry

> **Status:** Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [ATLAS.md](./ATLAS.md#atlas-ai-employee-roles) · [PROMOTION_BOARD.md](./PROMOTION_BOARD.md) · [docs/company/EMPLOYEES.md](./docs/company/EMPLOYEES.md) · [DECISION_LOG.md](./DECISION_LOG.md)

The current registry of AI workers filling each Atlas employee role. This file is the single place to update when a worker is promoted or replaced — the surrounding architecture (Mission Queue schema, approval engine, agent contracts in `src/agents/`) should never need to change as a result.

## Current Registry

| Employee | Worker | Assigned Since | Status | Notes |
|---|---|---|---|---|
| Scout AI | Perplexity | Project inception | Active | Research, competitor analysis, market intelligence |
| Builder AI | Gemini | Project inception | Active | Reports, branding, content, recommendations |
| Operator AI | OpenRouter Free Models | Project inception | Active | Internal workflows, task execution, data formatting |
| Closer AI | Templates + human approval | Project inception | Active | No AI worker yet — human-executed with template assistance |
| Finance AI | Atlas Logic | Project inception | Active | Deterministic calculation only, no generative estimates |
| Repository Engineer | Claude (this handoff) | 2026-09-15 | Active | Workstation only — see [Git Workflow](./ATLAS.md#git-workflow) |

## Planned Successors

| Employee | Planned Worker | Trigger Condition |
|---|---|---|
| Scout AI | Astra Research | When Astra research capability is available and validated |
| Builder AI | Astra | When Astra general capability is available and validated |
| Operator AI | GPT-6 Astra Computer Use | When computer-use capability is available and validated |

## Governance

- Replacing or promoting a worker is a 🔴 CEO Only decision (see [Approval Engine](./ATLAS.md#approval-engine)).
- Every promotion or replacement gets an entry in [DECISION_LOG.md](./DECISION_LOG.md) and a corresponding update in [PROMOTION_BOARD.md](./PROMOTION_BOARD.md).
- No AI is irreplaceable — this registry exists so replacing a worker is a one-file edit, not an architecture change.
