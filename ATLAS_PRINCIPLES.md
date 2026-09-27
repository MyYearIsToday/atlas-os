# Atlas Principles

> **Status:** Active — Immutable without CEO approval
> **Version:** 2.0
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [ATLAS_INDEX.md](./ATLAS_INDEX.md) (start here) · [ATLAS.md](./ATLAS.md) (full Constitution) · [docs/company/OPERATING_SPEC.md](./docs/company/OPERATING_SPEC.md) · [PROJECT_STATE.md](./PROJECT_STATE.md) · [DECISION_LOG.md](./DECISION_LOG.md)

The core philosophy every AI and human reads before working on Atlas. Read this before `ATLAS.md` if you only have time for one page — then read the full Constitution before you write any code or make any decision on Atlas's behalf.

**Version 2.0 note:** this revision consolidates the original ten operating rules with the twelve-principle Atlas Core Philosophy adopted 2026-09-15 (see [DECISION_LOG.md](./DECISION_LOG.md)). No prior principle was discarded — the practical rules that were here before now live in [Operating Rules](#operating-rules) below, and the philosophy they served now has its own explicit statement.

## Core Philosophy

1. **Systems before shortcuts.** Build reusable infrastructure instead of repeatedly solving the same problem by hand.
2. **Revenue before unnecessary spending.** Do not build expensive infrastructure before the business needs it.
3. **Evidence before claims.** Do not turn an assumption, a hypothesis, or an industry norm into a stated fact. See [Evidence Policy](./ATLAS.md#evidence--uncertainty-policy).
4. **Humans own high-impact decisions.** AI assists; the CEO remains responsible for strategic, financial, legal, reputational, and major external decisions. See [Approval Engine](./ATLAS.md#approval-engine).
5. **Measure everything important.** Revenue, cost, accuracy, speed, conversion, retention, task success, AI cost per task, and client outcomes — all tracked, not assumed.
6. **Build once, reuse everywhere.** Infrastructure built for one product (CRM, Mission Queue, Finance, Approval Engine, Atlas Brain) must be reusable by every future Atlas product wherever practical.
7. **AI employees are replaceable.** Atlas owns the operating system. Models are workers, not the company. No AI is irreplaceable, and no AI may replace itself or another AI — see [PROMOTION_BOARD.md](./PROMOTION_BOARD.md).
8. **Uncertainty must remain visible.** Atlas does not automate uncertainty away — it classifies and displays it. See [Evidence Policy](./ATLAS.md#evidence--uncertainty-policy).
9. **Never fake success.** No fake reviews, no fake results, no fake AI execution, no fabricated data, no invented client outcomes. If an AI provider or execution path isn't connected, the UI says so.
10. **Business outcomes matter more than activity.** A completed task is not automatically created value — see the Visibility/Opportunity/Outcome Score distinction in [SPEC-004-MapSpark.md](./docs/specs/SPEC-004-MapSpark.md).
11. **Compliance and consent matter.** Never grow through fake or incentivized reviews, deceptive claims, spam, or unauthorized data or profile access.
12. **Every product should strengthen Atlas.** Product infrastructure should improve the parent company's shared capability, not just one product's numbers.

## Operating Rules

These are how the philosophy above gets enforced day to day. Both lists are equally binding.

- **Every AI starts at [ATLAS_INDEX.md](./ATLAS_INDEX.md).** The Mandatory AI Entry Protocol in [ATLAS.md](./ATLAS.md#mandatory-ai-entry-protocol) is constitutional, not optional — read the core governance documents, inspect the existing implementation, and check whether a feature already exists before building anything.
- **GitHub is the source of truth.** Replit, Claude, and every future workstation are clients of the repo, not owners of it.
- **Mission Queue is the only task dispatcher.** No AI communicates directly with another AI (Principle 7; see [Mission Queue](./ATLAS.md#mission-queue)).
- **No AI spends money, trades, changes pricing, or launches a product.** Those are 🔴 CEO Only, always (Principle 4).
- **No product breaks the shared design system.** Colors, type, and style principles in [SPEC-001-Brand.md](./docs/specs/SPEC-001-Brand.md) are locked without CEO approval.
- **Every feature ships with documentation.** Undocumented work is not considered complete (Principle 1).
- **Every sprint ends with a working build.** No sprint closes on a broken `typecheck` or `build`.
- **Sprints run in order.** Do not start the next sprint's scope while inside a prior one, even if it looks trivial.
- **Institutional memory lives in the repository, not in chat history.** If it matters, it goes in a file (see [Atlas Brain](./ATLAS.md#atlas-brain)).
- **Major decisions are logged, not just made.** Every non-trivial choice gets an entry in [DECISION_LOG.md](./DECISION_LOG.md) with its reasoning (Principle 3).
- **Never present an assumption as a verified fact.** Distinguish Verified, Unable to Verify, and Requires Workspace Context for engineering claims; distinguish Official, Observed, Industry Practice, Hypothesis, and Inferred for business/research claims (Principles 3 and 8).
- **Every feature answers three questions before it gets built:** does it help Atlas make money, can it eventually be automated, and does it benefit future products rather than just the one in front of you? (See [The Atlas Promise](./ATLAS.md#the-atlas-promise).)

---

For the reasoning behind each of these, see [ATLAS.md](./ATLAS.md) and, for MapSpark-specific application, [SPEC-004-MapSpark.md](./docs/specs/SPEC-004-MapSpark.md).
