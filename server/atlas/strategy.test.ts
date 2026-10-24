import test from "node:test";
import assert from "node:assert/strict";
import { DossierEngine, STAGES } from "./dossier";
import { buildComparison, buildTrace, learningSummary, strategies, strategyKey } from "./strategy";
import { readDossier } from "./scout-actions";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

const biz = { id: "b1", canonicalName: "Mesa UGBS", category: "education", address: "Legon, Accra", sourceReferences: ["manual"] } as never;
function setup() {
  const deps = createPipelineDeps({});
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner: { run: async () => ({ outcome: "FAILED" }) }, retryCooldownMs: 1e9 });
  deps.store.businesses.set("b1", biz); const d = engine.ensure(biz);
  d.sources.push({ id: "S1", url: "https://mesaugbs.org/", title: "Mesa", snippet: "", query: "", retrievedAt: "", confidence: "checked", decision: "approved", origin: "search", check: { status: "fetched" } } as never,
    { id: "S2", url: "https://rival.example/", title: "Rival", snippet: "", query: "", retrievedAt: "", confidence: "checked", decision: "approved", role: "competitor", origin: "search", check: { status: "fetched" } } as never);
  const done = (id: (typeof STAGES)[number]["id"], output: unknown) => { d.stages[id].status = "completed"; d.stages[id].output = output as never; };
  done("growth", { recommendations: [{ title: "Launch a website", area: "visibility", priority: "high", rationale: "No site found", basis: "verified", sourceRefs: ["S1"], quote: "official student association", kind: "finding-based" }, { title: "Weekly event recap posts", area: "content", priority: "medium", rationale: "r", basis: "hypothesis", sourceRefs: [], kind: "experiment" }] });
  done("campaign", { campaigns: [{ name: "Launch", addresses: ["Launch a website"], objective: "o", audience: "a", message: "m", callToAction: "c", channels: ["web"], kpis: [{ metric: "visits", baseline: "unknown" }], sourceRefs: ["S1"] }, { name: "Orphan", addresses: [], sourceRefs: [] }],
    content: [{ campaign: "Launch", platform: "Instagram", format: "post", draft: "Hello", callToAction: "Visit", creativeBrief: "Photo of the team", status: "internal draft: not published" }, { campaign: "Nowhere", platform: "X", format: "post", draft: "x", creativeBrief: "" }] });
  done("competitors", { shortlist: [{ name: "Rival Club", url: "https://rival.example/", type: "direct", whySelected: "same campus", sourceRefs: ["S2"], positioning: { text: "Career club", basis: "verified", sourceRefs: ["S2"] }, offerings: ["Mentoring"], pricing: null, strengths: [{ text: "Large", basis: "hypothesis", sourceRefs: ["S2"] }], weaknesses: [], digitalPresence: null, reputation: null }], whitespace: [{ text: "No one runs alumni events", basis: "hypothesis", sourceRefs: ["S2"] }], threats: [], gaps: ["Pricing for Rival Club was not found"], conflicts: [], method: "m" });
  done("profile", { productsServices: ["Events", "Networking"], brandNotes: "student body", facts: [{ claim: "x", basis: "verified" }] });
  return { deps, engine, d };
}
const sk = strategyKey("Launch a website");

test("competitor comparison is built from recorded evidence only: unknowns stay unknown, no performance scores", () => {
  const { d } = setup(); const c = buildComparison({ canonicalName: "Mesa UGBS" }, d);
  assert.equal(c.competitors.length, 1); assert.equal(c.competitors[0].pricing.basis, "unknown"); assert.equal(c.competitors[0].positioning.basis, "verified");
  assert.deepEqual(c.competitors[0].evidence, [{ id: "S2", url: "https://rival.example/", read: true }]);
  assert.ok(c.gaps.some((g) => g.kind === "whitespace") && c.gaps.some((g) => g.kind === "not established"));
  assert.match(c.benchmark!.unavailable, /not collected/); assert.match(c.benchmark!.method, /not performance scores/);
  assert.equal(c.you.offerings.length, 2);
});

test("only an approved strategy can produce deliverables; each is an Approval Required internal mission linked to evidence", async () => {
  const { deps, engine } = setup();
  const make = (extra: object) => engine.executionAction("b1", { action: "deliverable_create", strategyKey: sk, campaign: "Launch", ...extra });
  assert.equal((await make({ kind: "campaign_brief" })).status, 409, "not approved yet");
  assert.equal((await engine.executionAction("b1", { action: "strategy_decide", strategyKey: "nope", decision: "approved" })).status, 404);
  assert.equal((await engine.executionAction("b1", { action: "strategy_decide", strategyKey: sk, decision: "yes" })).status, 400);
  assert.equal((await engine.executionAction("b1", { action: "strategy_decide", strategyKey: sk, decision: "approved" })).status, 200);
  const brief = await make({ kind: "campaign_brief" }); assert.equal(brief.status, 200);
  const again = await make({ kind: "campaign_brief" }); assert.equal((again.body as { already?: boolean }).already, true);
  assert.equal((await make({ kind: "content_draft", contentIndex: 0 })).status, 200);
  assert.equal((await make({ kind: "creative_asset", contentIndex: 0 })).status, 200);
  assert.equal((await make({ kind: "content_draft", contentIndex: 1 })).status, 404, "content of another campaign");
  assert.equal((await engine.executionAction("b1", { action: "deliverable_create", strategyKey: sk, kind: "campaign_brief", campaign: "Orphan" })).status, 409, "campaign does not address the strategy");
  const tasks = deps.missionQueue.getSnapshot().filter((t) => t.title.startsWith("Campaign brief") || t.title.startsWith("Content draft") || t.title.startsWith("Creative asset"));
  assert.equal(tasks.length, 3);
  for (const t of tasks) { assert.equal(t.approvalRequired, "Approval Required"); assert.equal(t.missionType, "dossier_followup"); assert.match(t.description, /INTERNAL DRAFT ONLY/); assert.match(t.description, /S1 https:\/\/mesaugbs\.org\//); assert.match(t.description, new RegExp(sk)); }
  const d = engine.get("b1")!; assert.equal(d.execution!.deliverables.length, 3);
});

test("a declined strategy blocks deliverables; deliverable count is bounded", async () => {
  const { engine } = setup();
  await engine.executionAction("b1", { action: "strategy_decide", strategyKey: sk, decision: "declined" });
  assert.equal((await engine.executionAction("b1", { action: "deliverable_create", strategyKey: sk, kind: "campaign_brief", campaign: "Launch" })).status, 409);
});

test("trace links every recommendation to evidence, campaigns, content, missions and approval state; gaps are listed", async () => {
  const { deps, engine, d } = setup();
  await engine.executionAction("b1", { action: "strategy_decide", strategyKey: sk, decision: "approved" });
  await engine.executionAction("b1", { action: "deliverable_create", strategyKey: sk, kind: "content_draft", campaign: "Launch", contentIndex: 0 });
  const t = buildTrace(d, deps.missionQueue.getSnapshot());
  const a = t.chain.find((c) => c.strategy.key === sk)!;
  assert.deepEqual(a.evidence.map((e) => e.id), ["S1"]); assert.equal(a.campaigns[0].name, "Launch"); assert.equal(a.campaigns[0].content.length, 1);
  assert.equal(a.deliverables[0].approval, "Approval Required"); assert.ok(["Pending", "Waiting Approval"].includes(a.deliverables[0].status), a.deliverables[0].status);
  assert.ok(t.gaps.some((g) => /Weekly event recap posts.*cites no source/.test(g)));
  assert.ok(t.gaps.some((g) => /Orphan.*no strategy link/.test(g)));
  assert.ok(t.gaps.some((g) => /Content draft #2/.test(g)));
});

test("performance: only operator-entered, validated results; nothing is shown or inferred without data", async () => {
  const { engine, d } = setup();
  assert.match(learningSummary(d).note, /does not estimate or import/); assert.equal(learningSummary(d).campaigns.length, 0);
  const rec = (o: object) => engine.executionAction("b1", { action: "performance_record", campaign: "Launch", metric: "Website visits", value: 120, from: "2026-10-01", to: "2026-10-07", ...o });
  for (const bad of [{ campaign: "Made up" }, { metric: "" }, { value: -1 }, { value: "abc" }, { value: "" }, { from: "2026-10-09", to: "2026-10-01" }, { to: "2099-01-01" }, { from: "yesterday" }, { deliverableId: "D9" }]) assert.notEqual((await rec(bad)).status, 200, JSON.stringify(bad));
  assert.equal((await rec({})).status, 200);
  assert.equal(learningSummary(d).campaigns[0].metrics[0].note, "one data point: no comparison possible");
  await rec({ value: 150, from: "2026-10-08", to: "2026-10-14" });
  const m = learningSummary(d).campaigns[0].metrics[0]; assert.equal(m.change, 30); assert.equal(m.latest, 150);
  assert.equal(d.execution!.performance[0].origin, "operator_entered");
});

test("the dossier read model exposes strategies, comparison, trace, execution and learning, and survives a legacy dossier", () => {
  const { deps, d } = setup();
  const r = readDossier(deps as never, "b1") as Record<string, unknown>;
  for (const k of ["strategies", "comparison", "trace", "execution", "learning"]) assert.ok(k in r, k);
  assert.equal((r.strategies as unknown[]).length, 2);
  delete (d as { execution?: unknown }).execution; assert.doesNotThrow(() => readDossier(deps as never, "b1"));
  assert.equal(strategies(d).length, 2);
});
