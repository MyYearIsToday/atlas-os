# SPEC-004 — MapSpark Ghana Product Operating Specification

> **Status:** Active — Evidence Foundation (4A), Visibility Score v1.0 (4B), Competitor Gap (4C), Opportunity Score (4D), Audit Generator (4E), and Scout Workflow (4F) implemented; Proposal Engine, ContentSpark rendering, and live UI remain not-yet-implemented (marked inline)
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-17
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md) · [../company/OPERATING_SPEC.md](../company/OPERATING_SPEC.md) · [SPEC-001-Brand.md](./SPEC-001-Brand.md) · [SPEC-002-CRM.md](./SPEC-002-CRM.md) · [SPEC-003-MissionQueue.md](./SPEC-003-MissionQueue.md) · [../../PROJECT_STATE.md](../../PROJECT_STATE.md)

This is MapSpark's product-level constitution and technical/commercial specification. It is written to the same evidentiary standard as `ATLAS.md`: claims about Google are labeled by how confirmed they are, field assumptions are labeled as hypotheses, and nothing here should be read as already implemented in code unless it references an existing file (`src/services/...`). Where this spec proposes a data object, workflow, or pipeline stage not yet in the codebase, it is marked **Not yet implemented**.

## Contents

1. [Core Business Philosophy](#core-business-philosophy)
2. [Three-Score Model](#three-score-model)
3. [Google Evidence Rule](#google-evidence-rule)
4. [Visibility Score Methodology](#visibility-score-methodology)
5. [Scout Opportunity Score](#scout-opportunity-score)
6. [Greater Accra Field Prioritization](#greater-accra-field-prioritization)
7. [Category Intelligence](#category-intelligence)
8. [Competitor Gap Engine](#competitor-gap-engine)
9. [Ghana Channel Strategy](#ghana-channel-strategy)
10. [Customer Journey](#customer-journey)
11. [Scout](#scout)
12. [Field Scouting Protocol](#field-scouting-protocol)
13. [Core Data Objects](#core-data-objects)
14. [Evidence Model](#evidence-model)
15. [API Architecture Principle](#api-architecture-principle)
16. [API Roadmap](#api-roadmap)
17. [Audit Engine](#audit-engine)
18. [Proposal Engine](#proposal-engine)
19. [CRM Integration](#crm-integration)
20. [Delivery Workflow](#delivery-workflow)
21. [Review Policy](#review-policy)
22. [Retention Workflow](#retention-workflow)
23. [ContentSpark Integration](#contentspark-integration)
24. [Automation Roadmap](#automation-roadmap)
25. [Competitive Intelligence](#competitive-intelligence)
26. [Scout Mission Example](#scout-mission-example)
27. [Safety & Compliance](#safety--compliance)
28. [Metrics](#metrics)
29. [Confidence Model](#confidence-model)
30. [Future Roadmap](#future-roadmap)

---

## Core Business Philosophy

MapSpark does not sell "we do SEO." MapSpark sells:

> "We make your business easier to discover and easier to buy from."

MapSpark must never promise: a #1 Google ranking, guaranteed ranking improvement, guaranteed leads, guaranteed revenue, or secret access to Google's algorithm. MapSpark's own score is an Atlas/MapSpark methodology — **it is not Google's score**, and must never be presented as if it were.

## Three-Score Model

MapSpark deliberately separates three distinct questions, because collapsing them into one number hides whether real business value was created (Principle 10, [ATLAS_PRINCIPLES.md](../../ATLAS_PRINCIPLES.md)).

| Score | Question it answers | Scale | Owner |
|---|---|---|---|
| **Visibility Score** | How strong is this business's local presence? | 0–100 | MapSpark methodology, see [below](#visibility-score-methodology) |
| **Opportunity Score** | How attractive and winnable is this prospect right now? | 0–100 | Scout prioritization, see [below](#scout-opportunity-score) |
| **Outcome Score** | Did MapSpark actually create measurable business value? | Not yet implemented | Future — evidence: visibility change, calls, website visits, directions, WhatsApp enquiries, bookings, leads, sales, revenue, retention |

**A business moving from Visibility Score 54 to 82 does not automatically mean MapSpark created commercial success.** Only the Outcome Score, once implemented and backed by real customer-action evidence, can support that claim — and even then, only with appropriate confidence labeling (see [Confidence Model](#confidence-model)).

## Google Evidence Rule

Atlas must distinguish four categories of claim about how Google local ranking works:

| Category | Meaning |
|---|---|
| **Google-confirmed** | Directly supported by Google's official documentation |
| **Measured observation** | Something Atlas observed from actual data |
| **Industry practice** | Common professional methodology, not confirmed by Google |
| **MapSpark hypothesis** | A testable Atlas assumption |

**Never allow "often observed" to become "Google confirms."** Google's own published local-ranking guidance describes three broad concepts — relevance, distance, and prominence — and does not publish a stable percentage formula for individual local-ranking factors. Any percentage weighting used in MapSpark's Visibility Score (see below) is **MapSpark's own scoring methodology**, not a disclosed Google formula, and must always be presented that way.

## Visibility Score Methodology

**VisibilityScore v1.0** — a deterministic 100-point framework. **Implemented Sprint 4B** in `src/services/scoring/visibility-score-v1.ts`, as a **new, additional** evidence-based engine — the pre-existing `src/services/visibility-score.ts` (used live by the Dashboard/Clients pages, six-input model) was left untouched, per Sprint 4B's explicit instruction not to rewrite the scoring engine without necessity. **`visibility-v1.0` is now the canonical methodology name and version**; the legacy engine's six-input model is not versioned and remains a separate, UI-facing calculation until a future decision migrates the UI to consume the new engine. See [Reconciliation with the Implemented Engine](#reconciliation-with-the-implemented-engine-sprint-4a) below and [DECISION_LOG.md](../../DECISION_LOG.md), 2026-09-17.

| Component | Points |
|---|---|
| Profile completeness and accuracy | 15 |
| Category and relevance alignment | 15 |
| Reviews and rating quality | 15 |
| Review responses | 8 |
| Services/products/attributes | 10 |
| Photos/visual trust | 10 |
| Website/conversion path | 10 |
| Recent activity | 5 |
| Local trust signals | 7 |
| Measurement/customer-action readiness | 5 |
| **Total** | **100** |

Rules:

- The score is **deterministic** — the same inputs always produce the same score.
- AI may interpret evidence (e.g., judge whether a photo looks recent or generic) but must **never secretly adjust the mathematical score** based on that interpretation outside the defined component weights.
- The methodology is versioned (`VisibilityScore v1.0`); a future revision to weights or components must increment the version and be logged in [DECISION_LOG.md](../../DECISION_LOG.md), not silently applied.

**Bands** (MapSpark methodology labels — not Google classifications):

| Range | Label |
|---|---|
| 0–39 | High risk / major missed opportunity |
| 40–59 | Basic presence with significant gaps |
| 60–79 | Reasonable foundation with competitive weaknesses |
| 80–100 | Strong operational foundation |

### Reconciliation with the Implemented Engine (Sprint 4A)

Per Sprint 4A's instruction not to rewrite the scoring engine without necessity, `src/services/visibility-score.ts` was **inspected, not rewritten**. Its actual implementation uses a different, six-input weighted model: `profileCompleteness` (20%), `reviews` (20%), `photos` (15%), `localSeo` (20%), `businessInfo` (15%), `engagement` (10%) — a simpler shape than the ten-component `VisibilityScore v1.0` above, predating this specification.

| Canonical v1.0 component | Present in implemented engine? |
|---|---|
| Profile completeness and accuracy (15) | Yes, as `profileCompleteness` (weighted 20%, not 15%) |
| Category and relevance alignment (15) | No direct equivalent |
| Reviews and rating quality (15) | Yes, as `reviews` (weighted 20%, not 15%) |
| Review responses (8) | No direct equivalent |
| Services/products/attributes (10) | Partially — folded into `businessInfo` |
| Photos/visual trust (10) | Yes, as `photos` (weighted 15%, not 10%) |
| Website/conversion path (10) | No direct equivalent |
| Recent activity (5) | Partially — folded into `engagement` |
| Local trust signals (7) | Partially — folded into `localSeo` |
| Measurement/customer-action readiness (5) | No direct equivalent |

**Reconciliation decision (executed Sprint 4B, 2026-09-17):** rather than choosing (a) migrate the legacy engine or (b) adopt its six-input model as v1.0, Sprint 4B took option **(c): build the ten-component `visibility-v1.0` engine as a new, additional module** (`src/services/scoring/visibility-score-v1.ts`), leaving the legacy `visibility-score.ts` running exactly as-is behind the Dashboard/Clients UI. The two engines now coexist deliberately: `visibility-v1.0` is canonical and evidence-based, ready for Audit/Scout to consume; the legacy engine keeps the current UI working without a risky mid-sprint swap. **Migrating the Dashboard/Clients UI to consume `visibility-v1.0` instead of the legacy engine remains open** — see [PROJECT_STATE.md](../../PROJECT_STATE.md).

## Scout Opportunity Score

**Implemented Sprint 4D** in `src/services/scoring/opportunity-*.ts` — the canonical seven-component weighting below (not the earlier ten-component draft in this document's prior revision, which is superseded by the CEO's Sprint 4D brief). Weight total is asserted to equal 100 at module load. Confidence is computed separately from the score itself (`opportunity-confidence.ts`) and is explicitly documented as "not a probability of success." Components with `NOT_OBSERVABLE` or `CONFLICTING` observability are excluded from the score rather than assumed.

A 100-point model for Scout prioritization — **not the Visibility Score, and not a guarantee of closing a deal.**

| Component | Weight |
|---|---|
| Visibility Weakness | 20% |
| Competitive Gap | 20% |
| Commercial Value | 15% |
| Conversion Readiness | 15% |
| Demand / Local Intent | 10% |
| Evidence Quality | 10% |
| Execution Feasibility | 10% |
| **Total** | **100%** |

**Superseded:** an earlier ten-component draft (Customer intent 20, Business value 15, Profile weakness 15, Competitor gap 15, Public contact 10, WhatsApp readiness 10, Owner accessibility 5, Business activity 5, Route efficiency 3, Data confidence 2) appeared in this document before Sprint 4D. The CEO's Sprint 4D brief specified the seven-component model above instead; it is what `src/services/scoring/opportunity-weights.ts` implements, and is now the canonical version. See [DECISION_LOG.md](../../DECISION_LOG.md), 2026-09-17.

**Purpose:** identify businesses where meaningful customer intent, visible weakness, reachable ownership, and realistic improvement potential overlap.

## Greater Accra Field Prioritization

**This is a field hypothesis, not authoritative public data.** Potential starting areas: Lapaz, Achimota, Madina, Adenta, East Legon, Spintex, Dansoman, Kaneshie, Circle, Osu, Tema, Teshie, Nungua, Kasoa.

Hypothesized factors: active business density, GBP maturity, competition, walkability, commercial value, WhatsApp availability, customer intent. **Do not represent these neighborhood opportunity labels as verified datasets.** Scout must calibrate these assumptions against real field observations over time, and any area's ranking should update based on `OBSERVED` evidence, not remain fixed on the initial hypothesis.

Proposed field-prioritization scoring (not yet implemented):

| Component | Points |
|---|---|
| Active density | 20 |
| Profile weakness | 20 |
| Commercial value | 15 |
| Public contact/WhatsApp | 15 |
| Competitor gap | 15 |
| Demand intent | 10 |
| Walking efficiency | 5 |
| **Total** | **100** |

## Category Intelligence

Priority categories and observed opportunity patterns — **operating hypotheses, not universal truths**, to be confirmed or revised by field evidence per business category over time:

| Category | Common observed gaps (hypothesis) |
|---|---|
| Barbers | Few photos, stale activity, weak reviews |
| Salons | Incomplete services, weak visual proof |
| Restaurants | Missing menu/hours/photos, weak review responses |
| Clinics | Trust and service clarity; **sensitive claims require human review** |
| Pharmacies | Hours, location, trust, service clarity |
| Gyms | Stale visuals, unclear memberships |
| Hotels | Old visuals, booking friction, review competition |
| Fashion | Weak product/location identity, WhatsApp/Instagram inconsistency |
| Auto workshops | Weak service taxonomy, poor proof |
| Schools | Weak program/facility information |
| Real estate | Unclear service areas, stale listings |
| Cafés | Visual/hours gaps |
| Event venues | Weak packages, poor visual proof |

## Competitor Gap Engine

**Implemented Sprint 4C** in `src/services/scoring/competitor-{gap,benchmark,normalization,gap-types}.ts`. Supports explicit and candidate competitors, per-dimension confidence/observability, median and best-in-class benchmarking, and normalized gap comparison. Null-safe throughout — a competitor missing a data point yields `direction: "unknown"` and a `null` gap, never a fabricated value.

MapSpark compares a prospect against relevant nearby competitors across: reviews (count, rating, recency, velocity, replies), photos (recency, variety, quality, coverage), services (categories, services, products, attributes), category (primary/secondary alignment or mismatch), activity (posts, photos, updates, reviews), and trust (website, NAP consistency, mentions, complaints, conversion path).

**Output:** measurable gaps, competitor-relative weaknesses, possible improvement areas, and a confidence level. **Never automatically declare a Google ranking cause** from a competitor gap — a gap is a comparative observation, not a proven ranking-impact claim. Not yet implemented as a standalone engine; candidate for the MapSpark Visibility Engine sprint (see [Future Roadmap](#future-roadmap)).

## Ghana Channel Strategy

Ghana-specific research directly connecting Maps/reviews/WhatsApp to business selection is currently limited — channel assumptions below should be treated carefully and are **not backed by Ghana-specific studies** unless stated otherwise.

| Channel | Hypothesized role |
|---|---|
| Google Maps | Discovery, directions, hours, legitimacy |
| Google Reviews | Trust and risk reduction |
| WhatsApp | Fast enquiries, availability, social commerce |
| Instagram | Visual proof and aspiration |
| Facebook | Local community and offers |
| TikTok | Discovery and demonstrations |
| Word of mouth | Trust transfer |

**Do not invent Ghana-specific conversion percentages.** Where external research is not Ghana-specific, label it explicitly as external evidence/hypothesis, not local fact.

## Customer Journey

```text
Scout → Score → Audit → Proposal → Close → Deliver → Retain → Upsell
```

Each stage:

| Stage | Objective | AI role | Human approval | CRM state |
|---|---|---|---|---|
| Scout | Find qualified prospects | Scout AI collects evidence and proposes candidates | 🟢 Auto (internal research) | `Identified` / `Researched` (target pipeline, see [OPERATING_SPEC.md](../company/OPERATING_SPEC.md#crm--customer-lifecycle)) |
| Score | Compute Visibility + Opportunity Score | Scout/Builder AI feeds evidence to deterministic scoring | 🟢 Auto (calculation) | Same |
| Audit | Produce the evidence-backed audit document | Builder AI drafts | 🟡 Approval Required before delivery | `Audit Sent` |
| Proposal | Present scoped offer | Closer AI drafts | 🟡 Approval Required before send | `Proposal Sent` |
| Close | Convert to paying client | Closer AI prepares follow-ups | 🟡 Approval Required for outreach; 🔴 CEO Only for pricing exceptions | `Negotiation` → `Won` |
| Deliver | Execute scoped work | Builder/Operator AI execute prepared tasks | 🟡/🔴 per action (see [Delivery Workflow](#delivery-workflow)) | `Paid — Onboarding` |
| Retain | Monthly reporting tied to outcomes | Builder AI drafts report | 🟡 Approval Required before send | Client record, ongoing |
| Upsell | Offer ContentSpark/expanded scope when signals justify it | Builder/Closer AI prepare offer | 🟡 Approval Required | Client record, ongoing |

## Scout

**Workflow state machine implemented Sprint 4F** in `src/services/scout/workflow.ts`: `DISCOVERED → QUALIFIED → EVIDENCE_COLLECTION → SCORED → AUDIT_READY → AUDIT_GENERATED → ACTION_RECOMMENDED → MISSION_CREATED`, with `BLOCKED` reachable from any non-terminal state and `MISSION_CREATED`/`BLOCKED` both terminal. `canTransition()` enforces the graph — a state cannot be skipped (e.g. `DISCOVERED` cannot jump straight to `SCORED`). `intake.ts` flags any discovery with a non-`NONE` duplicate status for human review before it proceeds, reusing Sprint 4A's deduplication output rather than a new check. `next-action.ts`'s `nextActionFromAudit()` is the deterministic function deciding what Scout should do next (collect more evidence, generate an audit, review opportunity data, or create a mission) — it does not recalculate anything, only routes based on already-computed state.

Ideal prospect characteristics: real business, meaningful customer demand, local/service-area relevance, visible profile weakness, reachable owner/manager, competitors outperforming, realistic improvement path.

Acquisition channels: Google Maps prospecting, competitor prospecting, referrals, networking, outbound, walk-ins. WhatsApp can be a major channel where publicly available; phone/email are alternatives; walk-ins can be used in dense/high-value areas. **Do not spam.**

## Field Scouting Protocol

**Before fieldwork:** route, targets, safety rules, consent rules, offline capture plan, approved opening messages.

**At each business, verify:** name, signage, category, location, operating status, public contact, profile URL, hours, decision-maker access.

**Capture only public business information** unless proper permission exists. **Do NOT:** photograph customers without permission, capture private documents, collect sensitive personal information, or photograph staff/interiors without permission.

**Required evidence:**

| Group | Fields |
|---|---|
| Identity | Name, sign, category, location, profile URL |
| Contact | Phone, WhatsApp, email, social |
| Profile | Rating, reviews, latest review, photos, hours, categories, services |
| Conversion | Call, WhatsApp, website, booking, menu, directions |
| Competitors | 2–5 comparable businesses |
| Sales context | Owner accessibility, pain point, next action |

## Core Data Objects

**Sprint 4A (2026-09-16) implemented these as TypeScript types** in `src/services/evidence/` — `business-intelligence.ts` (`BusinessIntelligence`), `evidence.ts` (`EvidenceRecord`, confidence/observability/verification enums), `confidence.ts`, `conflicts.ts`, `freshness.ts`, `business-deduplication.ts`, `provider-interfaces.ts`, `request-policy.ts`, `source-registry.ts`, `opportunity-score-contract.ts`, `mission-adapter.ts`. These are foundation types and pure functions only — no UI is wired to them yet, and no external API calls exist. The shapes below reflect what shipped; where Sprint 4A extended the shape beyond this document's original proposal (e.g. adding `observability` to the Evidence record), the code is the current source of truth and this document has been updated to match.

**Business** (`BusinessIntelligence`)
`id, canonicalName, aliases, category?, categories, businessType?, status (ACTIVE|INACTIVE|UNKNOWN|CONFLICT), address?, latitude?, longitude?, neighborhood?, serviceArea?, phone?, whatsapp?, email?, website?, socialLinks, googleProfileUrl?, hours?, services, products, sourceReferences, evidenceReferences, createdAt, updatedAt`

**Evidence** (`EvidenceRecord`)
`evidenceId, businessId, field, value, sourceType, sourceUrl?, observedAt, retrievedAt, evidenceType, confidence, verificationStatus, collector, notes?, expiresAt?, humanReviewRequired, observability`

**Score** — not yet implemented as a stored object. `opportunity-score-contract.ts` defines the `OpportunityScoreInputs` shape and canonical weights (summing to 100); an actual `calculateOpportunityScore()` function and a persisted `Score` record are Sprint 4B candidates.

**Mission** — reuses the existing Sprint 3 `Task` model directly (`src/services/mission-queue.ts`) via `mission-adapter.ts`'s `createScoutMissionForBusiness()`, rather than introducing a parallel `Mission` type. See [OPERATING_SPEC.md § Mission Lifecycle](../company/OPERATING_SPEC.md#mission-lifecycle).

**Action / Outcome** — not yet implemented; remain Sprint 4B+ candidates.

These are reusable Atlas data primitives — `EvidenceRecord` and the confidence/observability model in particular are general enough for other products' evidence needs, per [ATLAS.md § Company Structure & Shared Infrastructure](../../ATLAS.md#company-structure--shared-infrastructure).

## Evidence Model

**Implemented Sprint 4A** in `src/services/evidence/evidence.ts` and `confidence.ts`, `conflicts.ts`, `freshness.ts`. See [OPERATING_SPEC.md § Evidence Lifecycle](../company/OPERATING_SPEC.md#evidence-lifecycle) for the cross-product model. Every `EvidenceRecord` carries source URL/artifact, source type, publication/retrieval date, geography (via `field`/business context), methodology (`evidenceType`), confidence, and observability state.

**Observability states** (`ObservabilityState`, computed by `fieldState()` in `conflicts.ts`): `OBSERVED_PRESENT`, `OBSERVED_ABSENT`, `NOT_OBSERVABLE`, `CONFLICTING`. Absence of evidence is never conflated with confirmed absence — no records for a field yields `NOT_OBSERVABLE`, not `OBSERVED_ABSENT`. Two sources disagreeing yields `CONFLICTING` with `humanReviewRequired: true`; neither observation is discarded or auto-resolved.

**Confidence levels** (`ConfidenceLevel`): `VERIFIED` (client-provided, authorized connector) > `HIGH` (official website, manual observation) > `MEDIUM` (OSM, directory, public business page) > `LOW` (other permitted sources) > `UNKNOWN` (unclassified). These represent evidence reliability, not a statistical probability.

**Freshness** (`freshness.ts`): configurable per field, with documented MapSpark-methodology defaults (`HYPOTHESIS`-classified, not Google-confirmed) — e.g. reviews 30 days, website 60 days, phone/WhatsApp/email 180 days, coordinates/address 365 days. A field with no documented default returns `unknown` rather than an invented value.

## API Architecture Principle

Preferred pipeline:

```text
API → raw evidence → Atlas Logic → score/decision → AI interpretation → human approval → action → outcome
```

**Not this:**

```text
API → AI guess → automatic action
```

AI must not become the source of truth for deterministic business calculations (scores, pricing, financial figures) — Atlas Logic computes them; AI interprets and explains them.

## API Roadmap

**Sprint 4A implemented the provider abstraction layer** — `src/services/evidence/provider-interfaces.ts` defines `BusinessDiscoveryProvider`, `GeocoderProvider`, `BusinessEnrichmentProvider`, and `EvidenceCollector` as interfaces with **no concrete external API implementation**. `source-registry.ts` documents the permitted sources (OpenStreetMap, Nominatim, Overpass, official websites, legitimate directories, manual observation) with license/attribution/rate-limit notes; `request-policy.ts` defines per-source rate-limit and cache-TTL defaults (e.g. Nominatim: 1 request/second, 30-day cache). **No external HTTP requests are made by any Sprint 4A code.** A documented-but-unimplemented `GoogleAuthorizedProvider` extension point exists in `provider-interfaces.ts`, explicitly marked as requiring a future CEO-approved decision before any implementation — Google access remains fully optional, per [Core Business Philosophy](#core-business-philosophy) and [ATLAS.md § Research Standards](../../ATLAS.md#research-standards).

This table records the intended division of responsibility once real connections are built — it is not yet implemented:

| Capability | Atlas's role | AI's role | Human's role |
|---|---|---|---|
| Profile data | API pulls evidence | Interprets anomalies | Reviews identity |
| Score | Calculates | Does not calculate | — |
| Audit | Selects template | Drafts explanation | Reviews claims |
| Competitors | Creates candidate set | Summarizes | Validates |
| Outreach | Sequences/throttles | Drafts | Approves |
| Reminders | Controls timing | Drafts wording | — |
| Pricing | Finance logic checks margins | — | Approves |
| Performance | Tracks baseline/deltas | Explains changes | — |
| Mission generation | Creates queue | Suggests priorities | Approves high-impact missions |
| Content | Applies constraints | Drafts | Approves public-facing content |

## Audit Engine

**Implemented Sprint 4E** in `src/services/audit/`. `generate-audit.ts`'s `generateAudit()` consumes pre-computed Business/Evidence/Visibility/Competitor/Opportunity/Recommendation inputs — it does not recalculate any score itself. All ten required sections (Executive Summary, Business Profile, Visibility, Competition, Opportunity, Key Gaps, Quick Wins, Recommended Actions, Measurement Readiness, Limitations) are generated with per-section confidence and observability, so an unavailable input (e.g. no competitors) renders as `NOT_OBSERVABLE`, not a fabricated claim. `lineage.ts` collects and de-duplicates every evidence reference across the audit for traceability. `rendering/contracts.ts` separates audit data from a presentation model, so dashboard/PDF/email/WhatsApp renderers can consume the same audit without duplicating business logic (only the presentation model conversion is implemented; the four concrete renderers are not).

**Not yet implemented.** Structure: cover, executive summary, Visibility Score, key findings, quick wins, competitor comparison, 30-day action plan, next steps. Possible visual components: score gauge, screenshots, map/geo snapshots, priority labels, competitor tables, annotated screenshots, roadmap. **Every important claim in an audit must have evidence** — no unsupported claim ships in a client-facing audit.

## Proposal Engine

**Not yet implemented.** A proposal explains: what is wrong, why it matters, what MapSpark will do, what the client must provide, how success will be measured, timeline, price, exclusions, next step. Possible packages: Starter, Standard, Premium, Monthly Monitoring. Structure: setup fee + monthly retainer, priced in GHS and appropriate to the Ghanaian market (not copied from a foreign price list). Potential payment methods: Mobile Money, bank transfer. Payment is required before implementation per eventual commercial policy. **Never use fake scarcity. Never guarantee rankings.**

## CRM Integration

MapSpark uses Atlas's shared CRM — it does not get its own. See [SPEC-002-CRM.md](./SPEC-002-CRM.md) for what is implemented (six-stage pipeline) and [OPERATING_SPEC.md § CRM / Customer Lifecycle](../company/OPERATING_SPEC.md#crm--customer-lifecycle) for the documented target twelve-stage pipeline and why the two currently differ. Required lead fields per the target model: business, contact, category, location, contact channel, profile URL, score, audit, proposal, value, next action, loss reason, consent, contact preference, owner.

**Mission Queue consolidation (Sprint 4B–4F, 2026-09-17):** every score/audit/finance system introduced this sprint reuses the single existing Mission Queue (`src/services/mission-queue.ts`) — none introduced a second task system. `src/services/evidence/mission-adapter.ts` (Sprint 4A) creates missions from Opportunity Score; `src/services/mission-adapters.ts` (this sprint) adds real mission creation from audit recommendations, audit quick wins, and finance transactions needing approval. All three call the same `localMissionQueueRepository.create()` and produce the same `Task` shape — there is one canonical task model, referenced from four different trigger points.

**Finance → CRM link:** `src/services/finance/metrics.ts`'s `clientProfitability()` attributes revenue and direct cost to a CRM lead/client id (the same loose `clientId` reference pattern Mission Queue already uses), giving the `Client → Deal → Revenue → Costs → Contribution` chain the CRM audit required — without adding a second client record anywhere.

## Delivery Workflow

**Before implementation:** scope accepted, payment/deposit received, identity confirmed, access documented, responsibilities understood, approval process agreed. **Never request or store client passwords** where proper delegated access is available.

| Phase | Focus |
|---|---|
| Baseline | Profile, competitors, customer actions, existing performance, current score |
| Foundation | Factual business information, categories, services, attributes, links |
| Trust | Authentic photos, review responses, compliant review requests, relevant listings |
| Activity | Useful updates, photos, service information, website/local content |
| Measurement | Score, competitor comparison, calls, site visits, directions, bookings, WhatsApp where measurable |

## Review Policy

MapSpark must never create fake, paid, incentivized, or selectively-manipulated reviews, or fabricated testimonials. Review requests must be authentic and compliant. Review response assistance can be drafted by AI, but **sensitive situations require human approval** before anything is posted publicly.

## Retention Workflow

Monthly reporting connects work to business outcomes, not just activity. Possible report contents: score change, geo/rank movement where legitimately measured, calls, website activity, directions, bookings, WhatsApp enquiries, review statistics, completed work, key findings, next plan, client actions. **Never present a ranking movement as proof of revenue** — that conflates the Visibility Score with the (not yet implemented) Outcome Score; see [Three-Score Model](#three-score-model).

## ContentSpark Integration

Trigger an upsell offer when: the profile lacks fresh photos, the business lacks recent activity, social proof is weak, social channels are inconsistent, or the client explicitly requests content. Content pillars: products/services, education, proof/testimonials, behind the scenes, local identity, offers, FAQs.

**Human approval required before publishing content involving:** people's images/videos, consent confirmation, prices/promotions, health claims, financial/legal claims, testimonials, cultural nuance, or crisis responses.

## Automation Roadmap

| Phase | Focus | Examples |
|---|---|---|
| Phase 1 — Internal efficiency | Automate internal record-keeping | Lead records, profile snapshots, missing-field detection, score calculation, audit/proposal templates, follow-ups, monthly metric collection |
| Phase 2 — Assisted intelligence | AI assists, human decides | Findings, review drafts, service/description drafts, competitor summaries, proposals, churn alerts, content calendars |
| Phase 3 — Controlled automation | Bounded automation with human oversight retained on high-impact areas | Reports, review alerts, approval queues, reminders, approved publishing, monitoring alerts |

**Human remains responsible, at every phase, for:** strategy, pricing, client relationships, reputation incidents, suspensions, ownership issues, public identity changes, and high-impact decisions.

## Competitive Intelligence

Relevant category/feature references (for positioning awareness, not implementation copying): BrightLocal, Whitespark, Local Falcon, NearbyNow. **Do not copy proprietary implementation** — use these only as category/feature references for concepts like unified reporting, citation gap analysis, competitor analysis, geo-grid visualization, reputation management, and local visibility monitoring.

MapSpark's differentiation: Ghana-specific workflows, WhatsApp-first operations, mobile-first UX, local competitor intelligence, Ghanaian business categories, local directories, low-bandwidth considerations, Mobile Money context, field scouting, and outcome tracking.

## Scout Mission Example

**Mission #104 — illustrative, not a live mission.**

- **Area:** Lapaz
- **Objective:** Identify and contact five high-opportunity beauty/food businesses.
- **Process:** Read area/category constraints → pull candidate businesses → deduplicate → pre-score → reject closed/duplicate/ambiguous businesses → select targets using `expected value × win probability × route efficiency` → generate evidence checklist → generate personalized opening → conduct fieldwork → update mission state → record confidence → create audit candidates → create follow-ups → feed reply/meeting/proposal/close/revenue/retention/loss-reason back into Atlas.

## Safety & Compliance

See [ATLAS.md § Data, Privacy & Compliance](../../ATLAS.md#data-privacy--compliance) for the company-wide rules; MapSpark's field, review, and content-specific applications are covered above in [Field Scouting Protocol](#field-scouting-protocol), [Review Policy](#review-policy), and [ContentSpark Integration](#contentspark-integration).

## Metrics

Atlas should eventually track, per client and in aggregate: Visibility Score trend, Opportunity Score accuracy (did high-scored prospects actually close more often), Outcome Score once implemented, calls/website visits/directions/WhatsApp enquiries/bookings where measurable, review count and rating trend, retention rate, and revenue attributable per the Outcome Score's confidence level — never revenue attributed as certain from a Visibility Score change alone.

## Confidence Model

Every scored or measured claim MapSpark makes to a client should carry a confidence indicator derived from its underlying evidence classification (see [Evidence Model](#evidence-model)). A claim built entirely on `HYPOTHESIS`-classified inputs should read differently to the client than one built on `OBSERVED` data — this is not yet implemented as a UI treatment and is a candidate requirement for the Audit Engine.

## Future Roadmap

**Sprints 4A–4F and the Finance Ledger foundation are complete** as of 2026-09-17 (see [PROJECT_STATE.md](../../PROJECT_STATE.md), [DECISION_LOG.md](../../DECISION_LOG.md)). Remaining candidates, in rough priority order:

1. Migrate Dashboard/Clients UI from the legacy `visibility-score.ts` to `visibility-score-v1.ts`, or formally decide not to.
2. A first concrete `BusinessDiscoveryProvider` (OSM/Nominatim-backed).
3. Proposal Engine implementation.
4. Concrete audit renderers (dashboard/PDF/email/WhatsApp) against the existing rendering contract.
5. Finance: budget processing, recurring expenses, AI cost attribution population.
6. A minimal UI surface across all of the above — none of Sprints 4B–4F or the Finance Ledger have any UI yet.

This list is a recommendation, not an instruction to build all of it at once.
