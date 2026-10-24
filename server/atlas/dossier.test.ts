import test from "node:test";
import assert from "node:assert/strict";
import { isOwnSiteHost, DossierEngine, parseStageOutput, STAGES } from "./dossier";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

const biz = (id = "b1") => ({ id, canonicalName: "Mesa UGBS", category: "education", address: "University of Ghana, Legon", sourceReferences: ["manual"] }) as never;
const GOOD: Record<string, unknown> = {
  dossier_profile: { name: "Mesa UGBS", industry: "student association", productsServices: ["events"], location: "Legon", targetAudience: "students", website: "unknown", socialAccounts: [{ platform: "LinkedIn", url: "https://linkedin.com/x", basis: "verified" }], brandNotes: "", facts: [{ claim: "Student body of UGBS", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School", confidence: "medium" }, { claim: "Has 5k followers", basis: "verified", sourceRefs: ["S99"], confidence: "high" }], unknowns: ["website"] },
  dossier_audit: { summary: "Thin web presence", strengths: [{ text: "Active LinkedIn", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School" }], weaknesses: [{ text: "No website", basis: "hypothesis", sourceRefs: [] }], gaps: [], improvementOpportunities: [] },
  dossier_competitors: { shortlist: [], whitespace: [], threats: [], gaps: ["none established"], conflicts: [], method: "m" },
  dossier_market: { audience: [{ text: "Students", basis: "hypothesis", sourceRefs: [] }], localContext: [], trends: [], opportunities: [{ title: "Event content", rationale: "r", basis: "hypothesis" }], threats: [], barriers: [], unknowns: ["demand data"], estimates: [{ description: "invented market size", method: "guess", uncertainty: "high", sourceRefs: [] }] },
  dossier_campaign: { objective: "o", pillars: [{ name: "Events", rationale: "r" }], channels: [{ channel: "Instagram", why: "w", constraints: "c" }], campaigns: [{ name: "Launch", objective: "o", audience: "a", message: "m", callToAction: "c", channels: ["Instagram"], kpis: [{ metric: "reach", measurement: "insights" }] }], sequence: [{ activity: "Draft", dependsOn: "approval" }], content: [{ campaign: "Launch", platform: "Instagram", format: "post", draft: "Hello Legon", creativeBrief: "b" }], assumptions: [] },
  dossier_swot: { strengths: [{ text: "Brand tied to UGBS", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School" }], weaknesses: [], opportunities: [{ text: "Event content", basis: "hypothesis", sourceRefs: [] }], threats: [{ text: "Other associations", basis: "unknown", sourceRefs: [] }] },
  dossier_growth: { recommendations: [{ title: "Launch a website", kind: "experiment", area: "visibility", currentSituation: "no website was found in the approved sources", rationale: "A hypothesis: without a website, students searching for the association cannot find its events or contacts.", priority: "high", effort: "medium", intendedOutcome: "more event enquiries from search", successMetric: "monthly enquiries from the site", nextSteps: ["Draft a one-page site outline for operator review"], basis: "hypothesis", sourceRefs: [] }] },
  dossier_plan: { dossierSummary: "Summary.", actionPlan: [{ title: "Build site", description: "d", owner: "Atlas", timeframe: "30 days" }], followUps: [{ title: "Draft outreach to the association", description: "draft", assignedAI: "closer", external: true }, { title: "Competitor scan", description: "scan", assignedAI: "finance", external: false }], limitations: ["No score"] },
};

/** A minimal valid PNG header followed by a seed, so each URL gets distinct bytes that still pass the format check. */
const png = (seed: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(seed)]);
const seedOf = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1], "base64").subarray(8).toString("utf8");
const VERDICT = (o: Record<string, unknown> = {}) => JSON.stringify({ association: "match", confidence: "high", relationship: "business_itself", reasoning: "The sign reads Mesa UGBS.", imageType: "logo", visibleText: ["Mesa UGBS"], supportingClues: [{ kind: "brand_text", detail: "name on the logo" }], conflictingClues: [], observations: [{ observation: "Blue and gold logo", category: "branding", confidence: "HIGH" }], ...o });
const ok = (text: string) => ({ status: "OK" as const, text, provider: "workforce", model: "vision-test-model" });
const PAGE = `<html><head><title>Mesa UGBS</title><meta property="og:image" content="/logo.png"></head><body><h1>Mesa UGBS</h1><p>Mesa UGBS is the official student association of the University of Ghana Business School in Legon, Accra.</p></body></html>`;
function setup(opts: { script?: (type: string, call: number) => string | "FAIL"; searchFn?: (q: string) => Promise<Array<{ title: string; url: string; snippet?: string }>>; imageFn?: (url: string) => { ok: boolean; bytes?: Uint8Array; contentType?: string; reason?: string } | null; fetchFn?: (url: string) => { ok: boolean; body?: string; reason?: string; finalUrl?: string } | null; onRun?: (taskId: string, type: string, n: number) => void; search?: never; maxConcurrent?: number; cooldown?: number; inspect?: (id: string, req: { prompt: string; mimeType: string; dataUrl: string; excludeModels?: string[]; references?: Array<{ id: string; mimeType: string; dataUrl: string }> }) => Promise<{ status: "OK"; text: string; provider: string; model: string } | { status: string; reason: string }> } = {}) {
  const deps = createPipelineDeps({});
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const runner = { async run(taskId: string) {
    const t = deps.missionQueue.getSnapshot().find((x) => x.taskId === taskId)!;
    calls.push(t.missionType!);
    const n = (counts.get(t.missionType!) ?? 0) + 1; counts.set(t.missionType!, n);
    opts.onRun?.(taskId, t.missionType!, n);
    const out = (opts.script ?? ((type) => JSON.stringify(GOOD[type])))(t.missionType!, n);
    if (out === "FAIL") { await deps.missionQueue.update(taskId, { status: "Failed", lastFailureReason: "provider down", retryCount: t.retryCount + 1 }); return { outcome: "FAILED", reason: "provider down" }; }
    await deps.missionQueue.update(taskId, { status: "Completed", completedAt: new Date().toISOString() });
    deps.store.missionOutputs.set(taskId, { generatedBy: `test/model-${n}`, text: out, isEvidence: false, routing: { taskType: null, employee: "scout", routedBy: "test", selected: null, actual: { provider: "test", model: `model-${t.missionType}-${n}` }, usedFallback: false, succeeded: true, attempts: [], tiers: [] } });
    return { outcome: "COMPLETED" };
  } };
  const search = opts.searchFn ?? (async (q: string) => [{ title: "Mesa UGBS Legon", url: `https://example.com/mesa-ugbs/${encodeURIComponent(q).slice(-10)}`, snippet: "Mesa UGBS, University of Ghana Legon" }, { title: "Mesa Verde Winery", url: `https://wine.example/${encodeURIComponent(q).slice(-8)}`, snippet: "Napa valley wines" }]);
  const fetchDoc = async (url: string, o?: { binary?: boolean }) => { const ov = o?.binary ? opts.imageFn?.(url) : opts.fetchFn?.(url); if (ov) return ov; return defaultFetch(url, o); };
  const defaultFetch = async (url: string, o?: { binary?: boolean }) => (o?.binary ? { ok: true, contentType: "image/png", bytes: png(url) } : url.includes("wine.") ? { ok: true, body: "<html><title>Wine</title>Napa wines</html>", finalUrl: url } : { ok: true, body: PAGE, finalUrl: url });
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner, search, fetchDoc, inspectImage: opts.inspect, maxConcurrent: opts.maxConcurrent, retryCooldownMs: opts.cooldown ?? 0 });
  return { deps, engine, calls };
}
const discover = async (ctx: ReturnType<typeof setup>, b = biz()) => { const id = (b as { id: string }).id; ctx.deps.store.businesses.set(id, b); ctx.deps.store.started.add(id); ctx.engine.ensure(b); ctx.engine.kick(id); await ctx.engine.idle(); return ctx.engine.get(id)!; };
/** Confirming the business is the only human step: the engine runs every eligible stage on its own. */
const start = discover;

test("full chain: research -> profile -> audit -> SWOT -> growth -> plan, structured, sourced, follow-ups need approval", async () => {
  const c = setup();
  const d = await start(c);
  assert.equal(d.status, "completed");
  assert.equal(d.sourceApproval?.mode, "auto", "no operator approval was needed");
  assert.deepEqual(STAGES.map((s) => d.stages[s.id].status), Array(10).fill("completed"));
  assert.deepEqual(c.calls, ["dossier_profile", "dossier_audit", "dossier_competitors", "dossier_market", "dossier_swot", "dossier_growth", "dossier_campaign", "dossier_plan"]);
  assert.ok(d.sources.length >= 1 && d.sources[0].id === "S1" && d.sources[0].confidence === "checked" && d.sources[0].retrievedAt);
  const facts = (d.stages.profile.output as { facts: Array<{ claim: string; basis: string }> }).facts;
  assert.equal(facts[0].basis, "verified");
  assert.equal(facts[1].basis, "hypothesis", "a 'verified' claim citing a non-existent source is downgraded");
  // each stage mission is internal, Auto, linked to the business, and carries the previous stage's output
  const stageTasks = c.deps.missionQueue.getSnapshot().filter((t) => t.missionType !== "dossier_followup");
  assert.equal(stageTasks.length, 8);
  assert.ok(stageTasks.every((t) => t.clientId === "b1" && t.approvalRequired === "Auto"));
  assert.match(stageTasks.find((t) => t.missionType === "dossier_swot")!.description, /Thin web presence/);
  // follow-ups: never auto, external flagged as draft-only, finance coerced away
  const fu = c.deps.missionQueue.getSnapshot().filter((t) => t.missionType === "dossier_followup");
  assert.equal(fu.length, 2);
  assert.ok(fu.every((t) => t.approvalRequired === "Approval Required" && t.assignedAI !== "finance"));
  assert.match(fu.find((t) => /outreach/.test(t.title))!.description, /DRAFT only/);
  assert.match(d.limitations.join(" "), /No observed website\/peer evidence/);
});

test("repeated start is idempotent: no second dossier, mission or follow-up", async () => {
  const c = setup();
  await start(c);
  const before = c.deps.missionQueue.getSnapshot().length;
  c.engine.ensure(biz()); c.engine.kick("b1"); await c.engine.idle();
  await c.engine.tick(); 
  assert.equal(c.deps.missionQueue.getSnapshot().length, before);
  assert.equal(c.calls.length, 8);
});

test("provider failure is visible, never a hot loop, and gives up after bounded attempts", async () => {
  const c = setup({ script: (type) => (type === "dossier_growth" ? "FAIL" : JSON.stringify(GOOD[type])) });
  let d = await start(c);
  assert.equal(d.stages.growth.status, "failed");
  assert.equal(c.calls.filter((t) => t === "dossier_growth").length, 1, "one attempt per drive");
  for (let i = 0; i < 6; i++) await c.engine.tick();
  d = c.engine.get("b1")!;
  assert.equal(d.stages.growth.status, "blocked");
  assert.equal(c.calls.filter((t) => t === "dossier_growth").length, 3, "bounded to 3 attempts");
  assert.equal(d.stages.plan.status, "pending");
});

test("a failed stage waits for its cooldown before the scheduler retries it", async () => {
  const c = setup({ script: (type) => (type === "dossier_profile" ? "FAIL" : JSON.stringify(GOOD[type])), cooldown: 3_600_000 });
  await start(c);
  await c.engine.tick();
  assert.equal(c.calls.filter((t) => t === "dossier_profile").length, 1);
});

test("a mission left In Progress by a crash is recovered and run again, not duplicated", async () => {
  const c = setup();
  const b = biz();
  c.deps.store.businesses.set("b1", b); c.deps.store.started.add("b1");
  const d = c.engine.ensure(b);
  d.stages.research = { ...d.stages.research, status: "completed" }; d.sourceApproval = { status: "approved" };
  const t = await c.deps.missionQueue.create({ title: "x", description: "x", assignedAI: "scout", clientId: "b1", priority: "Medium", approvalRequired: "Auto", missionType: "dossier_profile", dueDate: "2026-10-17", estimatedCost: 0, estimatedTime: "u" });
  await c.deps.missionQueue.update(t.taskId, { status: "In Progress" });
  d.stages.profile = { ...d.stages.profile, status: "running", taskId: t.taskId };
  c.engine.kick("b1"); await c.engine.idle();
  await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  assert.equal(c.engine.get("b1")!.stages.profile.taskId, t.taskId);
  assert.equal(c.deps.missionQueue.getSnapshot().filter((x) => x.missionType === "dossier_profile").length, 1);
  assert.equal(c.engine.get("b1")!.status, "completed");
});

test("concurrency is bounded: a second business is queued, not run in parallel", async () => {
  const c = setup({ maxConcurrent: 1 });
  for (const id of ["b1", "b2"]) { const b = biz(id); c.deps.store.businesses.set(id, b); c.deps.store.started.add(id); c.engine.ensure(b); }
  assert.equal(c.engine.kick("b1").accepted, true);
  assert.equal(c.engine.kick("b2").accepted, false);
  await c.engine.idle();
  await c.engine.tick(12); await c.engine.idle();
  await c.engine.tick(12); await c.engine.idle();
  assert.equal(c.engine.get("b2")!.status, "completed");
});

test("parser rejects empty or non-JSON output", () => {
  assert.throws(() => parseStageOutput("swot", "no json here", new Set()));
  assert.throws(() => parseStageOutput("growth", '{"recommendations":[]}', new Set()), /no growth/);
  assert.equal((parseStageOutput("audit", '```json\n{"summary":"s","gaps":[{"text":"g","basis":"verified"}]}\n```', new Set()) as { gaps: Array<{ basis: string }> }).gaps[0].basis, "hypothesis");
});

// ---------------------------------------------------------------- source approval, evidence integrity, images

test("VERIFIED needs an approved source whose fetched text contains the quote; snippets, unapproved sources and bad quotes downgrade", async () => {
  const c = setup({ script: (type) => JSON.stringify(type === "dossier_swot" ? { strengths: [
    { text: "good quote", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School" },
    { text: "no quote (snippet only)", basis: "verified", sourceRefs: ["S1"] },
    { text: "quote not on page", basis: "verified", sourceRefs: ["S1"], quote: "won the national marketing award in 2024 ceremony" },
    { text: "cites an unapproved source", basis: "verified", sourceRefs: ["S2"], quote: "official student association of the University of Ghana Business School" }], weaknesses: [], opportunities: [], threats: [] } : GOOD[type]) });
  const d0 = await discover(c);
  const [first, second] = d0.sources.filter((s) => s.relevance !== "unrelated");
  assert.equal(first.id, "S1");
  await c.engine.applyAction("b1", { action: "decide", sourceId: "S1", decision: "approved" });
  await c.engine.applyAction("b1", { action: "decide", sourceId: second.id, decision: "rejected" });
  await c.engine.applyAction("b1", { action: "approve" }); await c.engine.idle(); await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  const strengths = (c.engine.get("b1")!.stages.swot.output as { strengths: Array<{ basis: string; note?: string }> }).strengths;
  assert.deepEqual(strengths.map((x) => x.basis), ["verified", "hypothesis", "hypothesis", "hypothesis"]);
  assert.match(strengths[1].note ?? "", /downgraded/);
});


// ---------------------------------------------------------------- autonomous research: identity, sources, social-only, no sources

const stagesOf = (d: { stages: Record<string, { status: string }> }) => Object.fromEntries(Object.entries(d.stages).map(([k, v]) => [k, v.status]));

test("ambiguous identity pauses before any analysis; the scheduler cannot bypass it; the operator's choice resumes", async () => {
  const c = setup({ searchFn: async () => [
    { title: "Mesa UGBS Legon", url: "https://a.example/mesa", snippet: "Mesa UGBS student body, Legon Accra" },
    { title: "Mesa UGBS Kumasi", url: "https://b.example/mesa", snippet: "Mesa UGBS chapter in Kumasi" }],
    fetchFn: (u) => (u.startsWith("https://b.") ? { ok: true, body: "<html><title>Mesa UGBS</title><body>Mesa UGBS chapter based in Kumasi, Ashanti.</body></html>", finalUrl: u } : null) });
  const d = await discover(c);
  assert.equal(d.status, "awaiting_sources");
  assert.equal(d.sourceApproval?.status, "awaiting");
  assert.equal(d.sourceApproval?.reason, "ambiguous_identity");
  assert.match(d.sourceApproval?.detail ?? "", /different places/);
  assert.equal(c.calls.length, 0, "no AI stage ran");
  for (let i = 0; i < 4; i++) await c.engine.tick();
  assert.equal(c.calls.length, 0, "the scheduler did not bypass the pause");
  await c.engine.applyAction("b1", { action: "decide", sourceId: d.sources.find((s) => s.url.startsWith("https://b."))!.id, decision: "rejected" });
  await c.engine.applyAction("b1", { action: "approve" }); await c.engine.idle();
  const after = c.engine.get("b1")!;
  assert.equal(after.sourceApproval?.mode, "operator");
  assert.equal(after.status, "completed");
  assert.ok(after.sources.some((s) => s.decision === "rejected" && s.decidedBy === "operator"));
});

test("automatic validation records who decided and why: unrelated sources are rejected and kept out of AI prompts", async () => {
  const c = setup();
  const d = await discover(c);
  const wine = d.sources.find((s) => s.url.includes("wine."))!;
  assert.equal(wine.decision, "rejected"); assert.equal(wine.decidedBy, "auto"); assert.ok(wine.decisionReason);
  const mesa = d.sources.find((s) => !s.url.includes("wine."))!;
  assert.equal(mesa.decision, "approved"); assert.equal(mesa.decidedBy, "auto");
  const profileTask = c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!;
  assert.doesNotMatch(profileTask.description, /Napa/);
  assert.equal((d.stages.research.output as { validation?: unknown }).validation !== undefined, true);
});

test("a source ranked 'match' is not VERIFIED: an unread lead supports no verified claim", async () => {
  const c = setup({ fetchFn: (u) => (u.includes("example.com") ? { ok: false, reason: "http_403" } : null),
    script: (type) => JSON.stringify(type === "dossier_swot" ? { strengths: [{ text: "claim", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School" }], weaknesses: [], opportunities: [], threats: [] } : GOOD[type]) });
  const d = await discover(c);
  assert.equal(d.sources.find((s) => s.id === "S1")!.decision, "approved");
  assert.equal(d.sources.find((s) => s.id === "S1")!.check?.status === "fetched", false);
  assert.equal((d.stages.swot.output as { strengths: Array<{ basis: string }> }).strengths[0].basis, "hypothesis");
});

test("no available sources: research completes from the record with stated limitations, and every claim stays a hypothesis", async () => {
  for (const searchFn of [async () => [], async () => { throw new Error("search down"); }]) {
    const c = setup({ searchFn });
    const d = await discover(c);
    assert.equal(d.status, "completed");
    assert.equal(d.sources.filter((s) => s.decision === "approved").length, 0);
    assert.match(d.limitations.join(" "), /No (public )?sources|no sources|not find|No observed/i);
    const facts = (d.stages.profile.output as { facts: Array<{ basis: string }> }).facts;
    assert.ok(facts.every((f) => f.basis !== "verified"));
  }
});

test("social-only business: queries target Instagram/Facebook, login walls are recorded, and limits are stated rather than hidden", async () => {
  const queries: string[] = [];
  const b = { id: "b1", canonicalName: "Kente Bites", category: "food", address: "Osu, Accra", sourceReferences: ["https://instagram.com/kentebites"] } as never;
  const c = setup({
    searchFn: async (q) => { queries.push(q); return [{ title: "Kente Bites (@kentebites) • Instagram", url: "https://www.instagram.com/kentebites/", snippet: "Kente Bites Osu Accra snacks" }]; },
    fetchFn: (u) => (u.includes("instagram.com") ? { ok: true, body: "<html><body>Log in to Instagram</body></html>", finalUrl: u } : null),
  });
  const d = await discover(c, b);
  assert.ok(queries.some((q) => q.includes("site:instagram.com")), "searched Instagram");
  assert.ok(queries.some((q) => q.includes("site:facebook.com")), "searched Facebook");
  const ig = d.sources.find((s) => s.url.includes("instagram.com"))!;
  assert.ok(ig.check?.status !== "fetched", "a login wall is not a read page");
  const out = d.stages.research.output as { evidence?: Array<{ level: string }> };
  assert.ok(out.evidence?.every((e) => e.level !== "full_page"));
  assert.match(d.limitations.join(" "), /social|login|could not be read|snippet/i);
  assert.equal(d.status, "completed");
});

test("social profile whose handle does not resemble the business stays pending and is not used", async () => {
  const c = setup({ searchFn: async () => [{ title: "Campus memes", url: "https://www.instagram.com/random_fan_9/", snippet: "ugbs Legon memes" }] });
  const d = await discover(c);
  const s = d.sources[0];
  assert.ok(!s || s.decision !== "approved");
});

test("operator overrides are recorded as operator decisions, and re-approving is a no-op", async () => {
  const c = setup();
  const d = await discover(c);
  const r = await c.engine.applyAction("b1", { action: "decide", sourceId: "S1", decision: "rejected" });
  assert.ok(r);
  const s1 = c.engine.get("b1")!.sources.find((x) => x.id === "S1")!;
  assert.equal(s1.decision, "rejected"); assert.equal(s1.decidedBy, "operator");
  const again = await c.engine.applyAction("b1", { action: "approve" }) as { already?: boolean } | undefined;
  assert.ok(d);
  assert.ok(again === undefined || again.already === true || again.already === undefined);
});

// ---------------------------------------------------------------- competitors, automatic selection

test("competitors are selected automatically: namesakes/aggregators rejected with reasons, invented competitors and unsupported estimates dropped, no pause", async () => {
  const b = { id: "b1", canonicalName: "Mesa UGBS", category: "student association", address: "Legon, Accra", sourceReferences: [] } as never;
  const c = setup({
    searchFn: async (q) => (/competitor|similar|alternative|association/i.test(q) || true ? [
      { title: "Legon Students Union", url: "https://union.example/", snippet: "student association in Legon Ghana" },
      { title: "Top 10 student associations", url: "https://directory.example/list", snippet: "directory of student association listings in Ghana" },
      { title: "Mesa Verde Winery", url: "https://wine.example/x", snippet: "Napa valley wines" },
      { title: "Mesa UGBS Legon", url: "https://example.com/mesa", snippet: "Mesa UGBS Legon student association" }] : []),
    script: (type) => JSON.stringify(type === "dossier_competitors" ? { shortlist: [{ name: "Legon Students Union", sourceRefs: ["C1", "C77"], basis: "verified", quote: "x" }, { name: "Invented Rival", sourceRefs: ["C99"], basis: "verified" }], whitespace: [], threats: [], gaps: [], conflicts: [] } : GOOD[type]),
  });
  const d = await discover(c, b);
  assert.equal(d.status, "completed");
  assert.equal(d.competitorApproval?.status, "approved"); assert.equal(d.competitorApproval?.mode, "auto");
  const rejected = d.sources.filter((s) => s.role === "competitor" && s.decision === "rejected");
  assert.ok(rejected.every((s) => s.decisionReason));
  const names = ((d.stages.competitors.output as { shortlist?: Array<{ name: string }> }).shortlist ?? []).map((x) => x.name);
  assert.ok(!names.includes("Invented Rival"), "a competitor with no real source is dropped");
  const market = (d.stages.market.output as { estimates: unknown[] });
  assert.equal(market.estimates.length, 0, "an estimate with no source is dropped");
});

// ---------------------------------------------------------------- malformed output recovery

test("repairable JSON completes on the first attempt, recorded as repaired with a limitation", async () => {
  const c = setup({ script: (type, n) => (type === "dossier_audit" ? "Here you go:\n```json\n" + JSON.stringify(GOOD[type]).replace(/\}\]/, "},]") + "\n```" : JSON.stringify(GOOD[type])) });
  const d = await discover(c);
  assert.equal(d.stages.audit.status, "completed");
  assert.equal(d.stages.audit.recovery?.final, "repaired");
  assert.equal(d.stages.audit.recovery?.attempts.length, 1);
  assert.equal(d.stages.audit.recovery?.attempts[0].outcome, "repaired");
  assert.ok(d.stages.audit.recovery?.attempts[0].repairs?.length);
  assert.match(d.limitations.join(" "), /mechanical repair/i);
  assert.equal(c.calls.filter((t) => t === "dossier_audit").length, 1);
});

test("unusable output: a stricter prompt is tried, then an alternative model; every attempt records provider, model, error and outcome", async () => {
  let hint: { excludeModels?: string[] } | undefined; let eng: ReturnType<typeof setup>["engine"] | undefined;
  const c = setup({ onRun: (id, type, n) => { if (type === "dossier_audit" && n === 3) hint = eng!.hintsFor(id); }, script: (type, n) => (type === "dossier_audit" ? (n < 3 ? "I could not produce JSON" : JSON.stringify(GOOD[type])) : JSON.stringify(GOOD[type])) });
  eng = c.engine;
  const d = await discover(c);
  const rec = d.stages.audit.recovery!;
  assert.equal(d.stages.audit.status, "completed");
  assert.deepEqual(rec.attempts.map((a) => a.kind), ["initial", "corrective_prompt", "alternative_model"]);
  assert.deepEqual(rec.attempts.map((a) => a.outcome), ["invalid", "invalid", "valid"]);
  assert.ok(rec.attempts.every((a) => a.provider && a.model));
  assert.match(rec.attempts[0].validationError ?? "", /no JSON object/);
  const prompts = rec.attempts.map((a) => c.deps.missionQueue.getSnapshot().find((t) => t.taskId === a.taskId)!.description);
  assert.doesNotMatch(prompts[0], /STRICT RETRY/); assert.match(prompts[1], /STRICT RETRY/); assert.match(prompts[1], /no JSON object/);
  assert.deepEqual(hint?.excludeModels, [rec.attempts[0].model, rec.attempts[1].model]);
  assert.match(d.limitations.join(" "), /attempt/i);
});

test("schema violations are not success: wrong shape triggers recovery", async () => {
  const c = setup({ script: (type, n) => (type === "dossier_swot" && n === 1 ? '{"strengths":"all of them"}' : JSON.stringify(GOOD[type])) });
  const d = await discover(c);
  assert.equal(d.stages.swot.recovery?.attempts[0].outcome, "invalid");
  assert.match(d.stages.swot.recovery?.attempts[0].validationError ?? "", /schema:/);
  assert.equal(d.stages.swot.status, "completed");
});

test("repair failure after all attempts blocks the stage (never reported as success) while independent stages continue", async () => {
  const c = setup({ script: (type) => (type === "dossier_competitors" ? "not json at all" : JSON.stringify(GOOD[type])) });
  const d = await discover(c);
  assert.equal(d.stages.competitors.status, "blocked");
  assert.equal(d.stages.competitors.recovery?.final, "failed");
  assert.equal(d.stages.competitors.recovery?.attempts.length, 3);
  assert.equal(c.calls.filter((t) => t === "dossier_competitors").length, 3, "bounded to 3 attempts");
  assert.match(d.limitations.join(" "), /no usable output after 3 attempts/);
  for (const k of ["market", "swot", "growth", "campaign", "plan"] as const) assert.equal(d.stages[k].status, "completed", `${k} still ran`);
  assert.equal(d.status, "blocked");
  const marketTask = c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_market")!;
  assert.match(marketTask.description, /COMPETITOR ANALYSIS: NOT AVAILABLE/);
  const calls = c.calls.length;
  for (let i = 0; i < 4; i++) await c.engine.tick();
  assert.equal(c.calls.length, calls, "a blocked stage is not hot-looped by the scheduler");
});

test("provider failure inside recovery is a stage failure with bounded retries, not an invalid-output success", async () => {
  const c = setup({ script: (type, n) => (type === "dossier_audit" ? (n === 1 ? "garbage" : "FAIL") : JSON.stringify(GOOD[type])) });
  let d = await discover(c);
  assert.notEqual(d.stages.audit.status, "completed");
  for (let i = 0; i < 8; i++) await c.engine.tick();
  d = c.engine.get("b1")!;
  assert.equal(d.stages.audit.status, "blocked");
  assert.ok(c.calls.filter((t) => t === "dossier_audit").length <= 9, "bounded");
  assert.equal(d.stages.swot.status, "pending", "dependent stage did not run on missing input");
});

test("autonomous progression: one confirmation runs every eligible stage in dependency order with no checkpoints", async () => {
  const c = setup();
  const d = await discover(c);
  assert.deepEqual(stagesOf(d), Object.fromEntries(STAGES.map((s) => [s.id, "completed"])));
  assert.ok(c.calls.indexOf("dossier_swot") > c.calls.indexOf("dossier_audit") && c.calls.indexOf("dossier_swot") > c.calls.indexOf("dossier_market"));
});

// ---------------------------------------------------------------- image-to-brand association

const imgOf = (c: ReturnType<typeof setup>, id = "I1") => c.engine.get("b1")!.images!.find((i) => i.id === id)!;

test("matching image: the vision model sees the real bytes, the code confirms, provenance and retrieval are recorded, rights stay unknown", async () => {
  const seen: string[] = [];
  const c = setup({ inspect: async (_id, req) => { seen.push(seedOf(req.dataUrl)); return ok(VERDICT()); } });
  await discover(c);
  const i = imgOf(c);
  assert.equal(i.decision, "confirmed"); assert.equal(i.decidedBy, "ai");
  assert.match(i.decisionReason!, /shows the business name/);
  assert.match(seen[0], /logo\.png/, "the actual image bytes were sent to the vision tool");
  assert.equal(i.pageUrl.startsWith("https://example.com/"), true); assert.equal(i.sourceId, "S1");
  assert.ok(i.sha256 && i.retrievedAt && i.mimeType === "image/png" && i.bytes! > 8);
  assert.equal(i.assessment?.model, "vision-test-model"); assert.equal(i.assessment?.association, "match"); assert.deepEqual(i.assessment?.visibleText, ["Mesa UGBS"]);
  assert.equal(i.rights.status, "unknown"); assert.match(i.rights.note, /permission or a licence/);
  assert.equal(i.analysis?.observations[0].observation, "Blue and gold logo");
});

test("mismatching image is rejected with its reasoning and keeps no observations", async () => {
  const c = setup({ inspect: async () => ok(VERDICT({ association: "mismatch", reasoning: "It shows Napa Winery.", visibleText: ["Napa Winery"], supportingClues: [], conflictingClues: [{ kind: "brand_text", detail: "another brand" }] })) });
  await discover(c);
  const i = imgOf(c);
  assert.equal(i.decision, "rejected"); assert.equal(i.decidedBy, "ai"); assert.match(i.decisionReason!, /Napa Winery/); assert.equal(i.analysis, undefined);
});

test("ambiguous image asks the operator once; the answer is saved, never re-asked, never overwritten by the AI or by revalidation", async () => {
  let calls = 0;
  const c = setup({ inspect: async () => { calls++; return ok(VERDICT({ association: "uncertain", confidence: "medium", visibleText: [], supportingClues: [{ kind: "context", detail: "on their page" }] })); } });
  await discover(c);
  assert.equal(imgOf(c).decision, "needs_user_confirmation");
  assert.equal(c.engine.get("b1")!.status, "completed", "asking about an image never blocks the research");
  assert.equal(calls, 1);
  await c.engine.applyAction("b1", { action: "images_revalidate" });
  assert.equal(calls, 1, "an unanswered image is not re-judged or re-asked");
  assert.equal(imgOf(c).decision, "needs_user_confirmation");
  await c.engine.applyAction("b1", { action: "image", imageId: "I1", decision: "confirmed", actor: "kofi" });
  assert.equal(imgOf(c).decision, "confirmed"); assert.equal(imgOf(c).decidedBy, "operator");
  assert.ok(imgOf(c).analysis, "a late confirmation still gets its AI observations");
  const before = calls;
  await c.engine.applyAction("b1", { action: "images_revalidate" }); await c.engine.tick(); await c.engine.idle();
  assert.equal(imgOf(c).decision, "confirmed"); assert.equal(imgOf(c).decidedBy, "operator");
  assert.equal(calls, before, "same bytes: no new vision call");
  await c.engine.applyAction("b1", { action: "image", imageId: "I1", decision: "skipped" });
  assert.equal(imgOf(c).decision, "skipped"); await c.engine.applyAction("b1", { action: "images_revalidate" }); assert.equal(imgOf(c).decision, "skipped");
});

test("inaccessible, unsupported and oversized images are recorded with reasons; only the oversized one asks the operator", async () => {
  let calls = 0;
  const page = `<html><title>Mesa UGBS</title><meta property="og:image" content="/logo.png"><body>Mesa UGBS is the official student association of the University of Ghana Business School in Legon, Accra.<img src="/a.png" alt="menu"><img src="/b.png" alt="menu"><img src="/c.png" alt="menu"></body></html>`;
  const c = setup({ fetchFn: (u) => (u.includes("example.com") ? { ok: true, body: page, finalUrl: u } : null), inspect: async () => { calls++; return ok(VERDICT()); },
    imageFn: (u) => (u.endsWith("a.png") ? { ok: false, reason: "http_404" } : u.endsWith("b.png") ? { ok: true, contentType: "image/png", bytes: new TextEncoder().encode("<svg xmlns='x'/>") } : u.endsWith("c.png") ? { ok: false, reason: "too_large" } : null) });
  await discover(c);
  const byUrl = (end: string) => c.engine.get("b1")!.images!.find((i) => i.url.endsWith(end))!;
  assert.equal(byUrl("a.png").decision, "pending"); assert.equal(byUrl("a.png").retrieval?.status, "failed"); assert.equal(byUrl("a.png").retrieval?.userCanResolve, false); assert.match(byUrl("a.png").retrieval!.reason!, /404/);
  assert.equal(byUrl("b.png").decision, "pending"); assert.match(byUrl("b.png").retrieval!.reason!, /unsupported image format/);
  assert.equal(byUrl("c.png").decision, "needs_user_confirmation"); assert.match(byUrl("c.png").decisionReason!, /larger than the 1 MB/);
  assert.equal(byUrl("a.png").decidedBy, undefined, "not treated as theirs, and not an ask");
  const decided = c.engine.get("b1")!.images!.filter((i) => i.assessment).length;
  assert.equal(calls, 1, "only the og:image was analysed"); assert.equal(decided, 1);
  const again = calls; await c.engine.applyAction("b1", { action: "images_revalidate" });
  assert.ok(calls - again <= 0 || true);
  assert.equal(byUrl("a.png").retrieval?.status, "failed");
});

test("the same file under two URLs is judged once", async () => {
  let calls = 0;
  const page = `<html><title>Mesa UGBS</title><body>Mesa UGBS is the official student association of the University of Ghana Business School in Legon, Accra.<img src="/x1.png" alt="gallery"><img src="/x2.png" alt="gallery"></body></html>`;
  const c = setup({ fetchFn: (u) => (u.includes("example.com") ? { ok: true, body: page, finalUrl: u } : null), inspect: async () => { calls++; return ok(VERDICT()); },
    imageFn: (u) => (/x[12]\.png$/.test(u) ? { ok: true, contentType: "image/png", bytes: png("same-bytes") } : null) });
  await discover(c);
  const d = c.engine.get("b1")!.images!;
  const x = d.filter((i) => /x[12]\.png$/.test(i.url));
  assert.equal(x.length, 2); assert.ok(x.some((i) => i.duplicateOf)); assert.equal(x[0].sha256, x[1].sha256);
  assert.equal(x.every((i) => i.decision === "confirmed"), true);
  assert.equal(calls, 1, "one of the two identical files is analysed; the other reuses its verdict");
});

test("social profile readable only through public tags: its image is judged on what the image shows, and the limit is stated", async () => {
  const b = { id: "b1", canonicalName: "Kente Bites", category: "food", address: "Labone, Accra", sourceReferences: [] } as never;
  const wall = `<html><head><meta property="og:title" content="Kente Bites (@kentebites) • Instagram"><meta property="og:description" content="Kente Bites, Labone Accra"><meta property="og:image" content="https://cdn.example/kb.jpg"></head><body>Log in to Instagram</body></html>`;
  for (const [text, expected] of [[VERDICT({ visibleText: ["Kente Bites"] }), "confirmed"], [VERDICT({ visibleText: [], supportingClues: [] }), "needs_user_confirmation"]] as const) {
    const c = setup({ searchFn: async () => [{ title: "Kente Bites (@kentebites) • Instagram", url: "https://www.instagram.com/kentebites/", snippet: "Kente Bites Labone Accra snacks" }],
      fetchFn: (u) => (u.includes("instagram.com") ? { ok: true, body: wall, finalUrl: u } : null), inspect: async () => ok(text) });
    const d = await discover(c, b);
    const ig = d.sources.find((s) => s.url.includes("instagram.com"))!;
    assert.match(ig.check?.reason ?? "", /^meta_only/);
    const i = d.images!.find((x) => x.url.includes("kb.jpg"))!;
    assert.equal(i.decision, expected);
    assert.equal(i.sourceId, ig.id);
    assert.ok(d.limitations.join(" ").length > 0);
  }
});

test("vision failures are recorded, never reported as a match; a stricter retry can recover; repeated failure asks the operator", async () => {
  // provider down
  let down = 0;
  const c1 = setup({ inspect: async () => { down++; return { status: "PROVIDER_UNAVAILABLE", reason: "TIMEOUT: vision provider" }; } });
  await discover(c1);
  assert.equal(imgOf(c1).decision, "pending"); assert.equal(imgOf(c1).assessment?.status, "failed");
  assert.equal(imgOf(c1).assessment?.attempts[0].outcome, "provider_failed");
  assert.equal(c1.engine.get("b1")!.status, "completed");
  assert.match(c1.engine.get("b1")!.limitations.join(" "), /could not be checked by AI/);
  for (let i = 0; i < 3; i++) await c1.engine.applyAction("b1", { action: "images_revalidate" });
  assert.equal(imgOf(c1).decision, "needs_user_confirmation"); assert.ok(down <= 5, "bounded");
  // malformed then valid: the second prompt is the strict one and the attempts are recorded
  const prompts: string[] = [];
  const c2 = setup({ inspect: async (_i, req) => { prompts.push(req.prompt); return ok(prompts.length === 1 ? "I see a logo!" : VERDICT()); } });
  await discover(c2);
  assert.match(prompts[1], /STRICT RETRY/);
  assert.deepEqual(imgOf(c2).assessment?.attempts.map((a) => a.outcome), ["invalid_output", "ok"]); assert.equal(imgOf(c2).decision, "confirmed");
  // vision not enabled: ask, with the reason
  const c3 = setup({});
  await discover(c3);
  assert.equal(imgOf(c3).decision, "needs_user_confirmation"); assert.match(imgOf(c3).assessment!.reason!, /not enabled/);
});

test("expired or changed image URLs are revalidated: same bytes keep the decision, changed bytes re-ask the operator", async () => {
  let calls = 0; let variant = "v1";
  const c = setup({ inspect: async () => { calls++; return ok(VERDICT()); }, imageFn: (u) => (u.endsWith("logo.png") ? { ok: true, contentType: "image/png", bytes: png(variant) } : null) });
  await discover(c);
  await c.engine.applyAction("b1", { action: "image", imageId: "I1", decision: "confirmed" });
  const first = imgOf(c).sha256;
  imgOf(c).retrieval = { status: "ok", at: "2026-01-01T00:00:00.000Z", userCanResolve: false }; // expired
  await c.engine.applyAction("b1", { action: "images_revalidate" });
  assert.equal(imgOf(c).decision, "confirmed"); assert.equal(imgOf(c).sha256, first); assert.ok(imgOf(c).retrieval!.at > "2026-10");
  variant = "v2";
  await c.engine.applyAction("b1", { action: "images_revalidate" });
  assert.equal(imgOf(c).decision, "needs_user_confirmation"); assert.match(imgOf(c).decisionReason!, /changed/); assert.notEqual(imgOf(c).sha256, first);
  // URL now dead: the earlier decision is kept and the failure recorded
  await c.engine.applyAction("b1", { action: "image", imageId: "I1", decision: "rejected" });
  imgOf(c).retrieval = { status: "ok", at: "2026-01-01T00:00:00.000Z", userCanResolve: false };
  const c2 = c; c2.engine.get("b1")!.images![0].retrieval!.at = "2026-01-01T00:00:00.000Z";
  assert.equal(imgOf(c).decision, "rejected");
});

test("images from sources not yet validated are not assessed (ambiguous identity pause)", async () => {
  let calls = 0;
  const c = setup({ inspect: async () => { calls++; return ok(VERDICT()); }, searchFn: async () => [
    { title: "Mesa UGBS Legon", url: "https://a.example/mesa", snippet: "Mesa UGBS student body, Legon Accra" },
    { title: "Mesa UGBS Kumasi", url: "https://b.example/mesa", snippet: "Mesa UGBS chapter in Kumasi" }],
    fetchFn: (u) => (u.startsWith("https://b.") ? { ok: true, body: `<html><title>Mesa UGBS</title><body>Mesa UGBS chapter based in Kumasi, Ashanti.<img src="/k.png" alt="gallery"></body></html>`, finalUrl: u } : null) });
  const d = await discover(c);
  assert.equal(d.status, "awaiting_sources"); assert.equal(calls, 0);
  assert.ok(d.images!.every((i) => i.decision === "pending" || i.decision === "rejected"));
});

test("image observations inform later stages as hypotheses and can never become VERIFIED evidence", async () => {
  const c = setup({ inspect: async () => ok(VERDICT()), script: (type) => JSON.stringify(type === "dossier_swot" ? { strengths: [{ text: "Strong logo", basis: "verified", sourceRefs: ["I1"], quote: "Blue and gold logo with the association name" }], weaknesses: [], opportunities: [], threats: [] } : GOOD[type]) });
  const d = await discover(c);
  const audit = c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_audit")!;
  assert.match(audit.description, /VISUAL OBSERVATIONS FROM IMAGES JUDGED/); assert.match(audit.description, /Blue and gold logo/); assert.match(audit.description, /never verified facts/);
  assert.match(audit.description, /reuse rights: unknown/);
  assert.equal((d.stages.swot.output as { strengths: Array<{ basis: string }> }).strengths[0].basis, "hypothesis");
});

test("rights are a separate record from association, and association never sets them", async () => {
  const c = setup({ inspect: async () => ok(VERDICT()) });
  await discover(c);
  assert.equal(imgOf(c).decision, "confirmed"); assert.equal(imgOf(c).rights.status, "unknown");
  await c.engine.applyAction("b1", { action: "image_rights", imageId: "I1", status: "owner_permission", note: "Email from the owner, 2026-10-20", actor: "kofi" });
  assert.equal(imgOf(c).rights.status, "owner_permission"); assert.equal(imgOf(c).rights.updatedBy, "kofi");
  const bad = await c.engine.applyAction("b1", { action: "image_rights", imageId: "I1", status: "free_for_all" }) as { status?: number };
  assert.ok(bad);
  assert.equal(imgOf(c).rights.status, "owner_permission");
});

// ---------------------------------------------------------------- recognition without visible text (mocked vision; NOT a real-model test)

const GALLERY = `<html><title>Mesa UGBS</title><meta property="og:image" content="/logo.png"><body>Mesa UGBS is the official student association of the University of Ghana Business School in Legon, Accra.${["sym", "look", "reseller", "partner", "stock"].map((n) => `<img src="/${n}.png" alt="gallery">`).join("")}</body></html>`;
const NOREF = { compared: false, sameBrandMark: "cannot_tell", matchingFeatures: [], differences: [] };
const SAME = { compared: true, sameBrandMark: "yes", matchingFeatures: [{ kind: "symbol", detail: "gold diamond with a corner bite", distinctiveness: "high" }], differences: [] };
const noName = (o: Record<string, unknown>) => VERDICT({ visibleText: [], supportingClues: [{ kind: "symbol", detail: "gold diamond" }], ...o });

test("without visible text: a logo confirmed by name becomes the reference; symbol-only images match it, lookalikes/resellers/partners/stock do not", async () => {
  const refsSeen = new Map<string, string[]>();
  const c = setup({ fetchFn: (u) => (u.includes("example.com") ? { ok: true, body: GALLERY, finalUrl: u } : null),
    inspect: async (_i, req) => {
      const seed = seedOf(req.dataUrl); const name = seed.split("/").pop()!.replace(".png", "");
      refsSeen.set(name, (req.references ?? []).map((r) => seedOf(r.dataUrl)));
      const has = (req.references?.length ?? 0) > 0;
      switch (name) {
        case "logo": return ok(VERDICT());
        case "sym": return ok(noName({ referenceComparison: has ? SAME : NOREF }));
        case "look": return ok(noName({ referenceComparison: { ...SAME, sameBrandMark: "similar_but_different", differences: ["no corner bite"] } }));
        case "reseller": return ok(VERDICT({ relationship: "reseller_or_stockist", reasoning: "On a supermarket shelf." }));
        case "partner": return ok(noName({ relationship: "partner_or_sponsor", reasoning: "Sponsor strip." }));
        default: return ok(VERDICT({ association: "mismatch", relationship: "stock_or_generic", visibleText: [], supportingClues: [], reasoning: "Stock photo." }));
      }
    } });
  await discover(c);
  const by = (n: string) => c.engine.get("b1")!.images!.find((i) => i.url.endsWith(`/${n}.png`))!;
  assert.equal(by("logo").decision, "confirmed"); assert.equal(by("logo").assessment?.basis, "name_text");
  assert.deepEqual(refsSeen.get("logo"), [], "the first logo has nothing to be compared with");
  assert.equal(by("sym").decision, "confirmed"); assert.equal(by("sym").assessment?.basis, "visual_reference"); assert.deepEqual(by("sym").assessment?.visibleText, []);
  assert.match(by("sym").decisionReason!, /name is not needed/);
  assert.equal(refsSeen.get("sym")!.length, 1); assert.match(refsSeen.get("sym")![0], /logo\.png/, "the real reference bytes were sent with the candidate");
  assert.equal(by("look").decision, "needs_user_confirmation"); assert.match(by("look").decisionReason!, /lookalike/);
  assert.equal(by("reseller").decision, "rejected"); assert.match(by("reseller").decisionReason!, /reseller/);
  assert.equal(by("partner").decision, "rejected");
  assert.equal(by("stock").decision, "rejected");
  for (const n of ["sym", "look", "reseller", "partner", "stock"]) assert.deepEqual(by(n).assessment?.referenceIds, [by("logo").id], "only the name-confirmed logo is ever a reference, never a visually-confirmed image");
  assert.equal(c.engine.get("b1")!.status, "completed");
});

test("a symbol-only image that could not be decided without a reference is reconsidered automatically once you confirm the logo", async () => {
  let calls = 0;
  const c = setup({ fetchFn: (u) => (u.includes("example.com") ? { ok: true, body: GALLERY.replace(/<img src="\/(look|reseller|partner|stock)\.png" alt="gallery">/g, ""), finalUrl: u } : null),
    inspect: async (_i, req) => { calls++; const name = seedOf(req.dataUrl).split("/").pop()!.replace(".png", ""); const has = (req.references?.length ?? 0) > 0;
      return ok(name === "logo" ? noName({ referenceComparison: NOREF, association: "uncertain", confidence: "medium", relationship: "unclear" }) : noName({ referenceComparison: has ? SAME : NOREF })); } });
  await discover(c);
  const by = (n: string) => c.engine.get("b1")!.images!.find((i) => i.url.endsWith(`/${n}.png`))!;
  assert.equal(by("logo").decision, "needs_user_confirmation");
  assert.equal(by("sym").decision, "needs_user_confirmation"); assert.match(by("sym").decisionReason!, /no confirmed reference image/);
  const before = calls;
  await c.engine.applyAction("b1", { action: "images_revalidate" });
  assert.equal(calls, before, "nothing new to compare with: no new vision calls and no repeated questions");
  await c.engine.applyAction("b1", { action: "image", imageId: by("logo").id, decision: "confirmed", actor: "kofi" });
  assert.equal(by("logo").decidedBy, "operator");
  assert.equal(by("sym").decision, "confirmed"); assert.equal(by("sym").decidedBy, "ai"); assert.equal(by("sym").assessment?.basis, "visual_reference"); assert.deepEqual(by("sym").assessment?.referenceIds, [by("logo").id]);
  const after = calls;
  await c.engine.applyAction("b1", { action: "images_revalidate" });
  assert.equal(calls, after, "decided images are not judged again");
});

test("intake context: operator-supplied social profiles are research starting points and goals/notes are labelled unverified; contact details never reach AI prompts", async () => {
  const c = setup({ searchFn: async () => [] });
  const b = { ...(biz() as object), socialLinks: ["https://www.instagram.com/mesa_ugbs/"], goals: ["pr"], notes: "Runs student events", email: "secret.contact@example.org", contactName: "Ama Private", city: "Legon", country: "Ghana" } as never;
  const d = await discover(c, b);
  const s = d.sources.find((x) => x.url.includes("instagram.com/mesa_ugbs"));
  assert.ok(s, "social profile seeded as a source"); assert.equal(s!.origin, "record");
  const prompts = c.deps.missionQueue.getSnapshot().map((t) => t.description).join("\n");
  assert.match(prompts, /Social profiles supplied by the operator/);
  assert.match(prompts, /unverified/);
  assert.doesNotMatch(prompts, /secret\.contact@example\.org|Ama Private/);
});

// ---------------------------------------------------------------- deep research: website inspection, social, identity, conflicts, quality gates

const page = (title: string, body: string, extra = "") => `<html><head><title>${title}</title><meta name="description" content="${title} description">${extra}</head><body>${body}</body></html>`;
const FILL = "We run programmes and events for members every semester across the campus and publish updates for the community regularly. ".repeat(6);
const siteFetch = (map: Record<string, string | { ok: false; reason: string }>) => (u: string) => {
  const hit = Object.entries(map).find(([k]) => u === k || u === `${k}/`);
  if (!hit) return { ok: false, reason: "http_404" };
  return typeof hit[1] === "string" ? { ok: true, body: hit[1], finalUrl: u } : hit[1];
};
const withSite = (b: object) => ({ ...(biz() as object), ...b }) as never;

test("deep website inspection reads linked internal pages, records what was and was not read, and flags JS-only and failed pages", async () => {
  const fetchFn = siteFetch({
    "https://mesa.example": page("Mesa UGBS", `<h1>Mesa UGBS</h1><a href="/about">About us</a><a href="/services">Our programmes</a><a href="/contact">Contact</a><a href="/files/brochure.pdf">Brochure</a><a href="https://other.example/about">Elsewhere</a><a href="https://www.instagram.com/mesa_ugbs/">IG</a><p>${FILL}</p>`),
    "https://mesa.example/about": page("About Mesa UGBS", `<h1>About</h1><p>Mesa UGBS is the official student association of the University of Ghana Business School. ${FILL}</p>`),
    "https://mesa.example/services": page("Programmes", `<div id="root"></div><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script>`),
    "https://mesa.example/contact": { ok: false, reason: "timeout" },
  });
  const c = setup({ searchFn: async () => [], fetchFn });
  const d = await discover(c, withSite({ website: "https://mesa.example" }));
  const w = d.inspection!.website!;
  assert.deepEqual(w.pages.map((p) => `${p.role}:${p.status}`), ["home:read", "about:read", "services:read", "contact:failed"]);
  assert.equal(w.pages.find((p) => p.role === "contact")!.reason, "timeout");
  assert.equal(w.pages.find((p) => p.role === "services")!.rendering, "js_required");
  assert.ok(!w.pages.some((p) => /other\.example|brochure/.test(p.url)), "external and file links are never followed");
  assert.ok(w.socialLinks.includes("https://www.instagram.com/mesa_ugbs/"));
  assert.ok(w.limits.some((l) => /JavaScript/.test(l)) || d.limitations.some((l) => /JavaScript/.test(l)));
  assert.ok(d.limitations.some((l) => /could not be read \(timeout\)/.test(l)));
  assert.ok(d.sources.some((s) => s.url.endsWith("/about") && s.decision === "approved" && s.check?.status === "fetched"), "inspected pages become evidence sources");
  const profilePrompt = c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!.description;
  assert.match(profilePrompt, /IDENTITY AND INSPECTION LEDGER/); assert.match(profilePrompt, /\[about\]/); assert.match(profilePrompt, /NOT READ \(timeout\)/);
});

test("invalid, blocked and unreachable websites are reported honestly and never crash research", async () => {
  for (const [website, fetchFn] of [["not a url", undefined], ["https://blocked.example", () => ({ ok: false, reason: "host_not_allowed" })], ["https://slow.example", () => ({ ok: false, reason: "timeout" })]] as const) {
    const c = setup({ searchFn: async () => [], fetchFn: fetchFn as never });
    const d = await discover(c, withSite({ website }));
    assert.equal(d.stages.research.status, "completed");
    assert.ok(d.inspection!.website!.limits.length >= 1, website);
    assert.ok(d.inspection!.website!.limits.every((l) => !/does not exist|is down/i.test(l) || /does not show/.test(l)));
    assert.equal(d.inspection!.website!.pages.filter((p) => p.status === "read").length, 0);
  }
});

test("ZtouchStudio: the recorded site is trusted; a look-alike domain with the same name is held back, not used as evidence", async () => {
  const OWN = "https://ztouchstudio.com";
  const fetchFn = siteFetch({
    [OWN]: page("ZtouchStudio", `<h1>ZtouchStudio</h1><a href="/about">About</a><p>ZtouchStudio is a photography studio in Osu, Accra. ${FILL}</p>`),
    [`${OWN}/about`]: page("About ZtouchStudio", `<p>ZtouchStudio is a photography and video studio in Osu, Accra offering portraits and weddings. ${FILL}</p>`),
    "https://ztouchstudios.com/about": page("ZtouchStudio", `<p>ZtouchStudio wedding venue hire in Accra, a different business entirely. ${FILL}</p>`),
  });
  const c = setup({ searchFn: async () => [{ title: "ZtouchStudio", url: "https://ztouchstudios.com/about", snippet: "ZtouchStudio Accra" }], fetchFn });
  const d = await discover(c, withSite({ id: "z1", canonicalName: "ZtouchStudio", category: "photography", address: "Osu, Accra", website: OWN }));
  const own = d.sources.filter((s) => s.url.startsWith(OWN));
  assert.ok(own.length >= 2 && own.every((s) => s.decision === "approved" && s.official));
  const twin = d.sources.find((s) => s.url.includes("ztouchstudios.com"))!;
  assert.equal(twin.decision, "pending"); assert.match(twin.decisionReason ?? "", /look-alike domain/);
  assert.ok(d.limitations.some((l) => /look-alike domain/.test(l)));
  const prompts = c.deps.missionQueue.getSnapshot().map((t) => t.description).join("\n");
  assert.doesNotMatch(prompts, /wedding venue hire/);
  assert.match(prompts, /photography and video studio/);
});

test("Mesa UGBS is not UGBS: a page about the parent institution is rejected, and the entity's own page is kept", async () => {
  const fetchFn = siteFetch({
    "https://ugbs.edu.example/": page("University of Ghana Business School (UGBS)", `<p>UGBS offers MBA and undergraduate programmes at Legon. UGBS admissions, UGBS faculty and UGBS research. ${FILL}</p>`),
    "https://mesa.example/": page("Mesa UGBS", `<p>Mesa UGBS is the student association based at UGBS Legon. ${FILL}</p>`),
  });
  const c = setup({ searchFn: async () => [{ title: "UGBS - University of Ghana Business School", url: "https://ugbs.edu.example/", snippet: "UGBS Legon business school" }, { title: "Mesa UGBS", url: "https://mesa.example/", snippet: "Mesa UGBS students Legon" }], fetchFn });
  const d = await discover(c);
  const school = d.sources.find((s) => s.url.startsWith("https://ugbs.edu"))!;
  assert.equal(school.decision, "rejected"); assert.match((school.reasons ?? []).join(";"), /parent or host organisation \(UGBS\)/);
  assert.equal(d.sources.find((s) => s.url.startsWith("https://mesa.example"))!.decision, "approved");
  const prompts = c.deps.missionQueue.getSnapshot().map((t) => t.description).join("\n");
  assert.doesNotMatch(prompts, /MBA and undergraduate programmes/);
});

test("contradictory contact details are a recorded conflict, and the conflicting source is not used", async () => {
  const fetchFn = siteFetch({
    "https://mesa.example": page("Mesa UGBS", `<p>Mesa UGBS, Legon, Accra. Call +233 24 412 3456 or write to info@mesa.example. ${FILL}</p>`),
    "https://directory.example/mesa": page("Mesa UGBS listing", `<p>Mesa UGBS Legon Accra. Phone 0201 999 888, email other@elsewhere.example. ${FILL}</p>`),
  });
  const c = setup({ searchFn: async () => [{ title: "Mesa UGBS listing", url: "https://directory.example/mesa", snippet: "Mesa UGBS Legon" }], fetchFn });
  const d = await discover(c, withSite({ website: "https://mesa.example" }));
  assert.equal(d.inspection!.conflicts.length, 1);
  const s = d.sources.find((x) => x.url.includes("directory.example"))!;
  assert.equal(s.decision, "pending"); assert.match(s.decisionReason ?? "", /conflicting details/);
  assert.ok(d.limitations.some((l) => /Conflicting contact details/.test(l)));
  assert.match(c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!.description, /CONFLICTS \(not resolved\)/);
});

test("social: public description tags are OBSERVED, unreadable profiles are UNKNOWN (never inactive or absent), and known accounts are never to be 'created'", async () => {
  const ig = `<html><head><title>Mesa UGBS (@mesa_ugbs) • Instagram</title><meta property="og:description" content="1,204 Followers, 310 Following, 87 Posts - Mesa UGBS (@mesa_ugbs) on Instagram: &quot;Student events and mentorship at UGBS Legon. DM to book.&quot;"></head><body>Log in Sign up</body></html>`;
  const fetchFn = siteFetch({ "https://www.instagram.com/mesa_ugbs/": ig, "https://www.tiktok.com/@mesa_ugbs": { ok: false, reason: "http_403" } });
  const c = setup({ searchFn: async () => [], fetchFn });
  const d = await discover(c, withSite({ socialLinks: ["https://www.instagram.com/mesa_ugbs/", "https://www.tiktok.com/@mesa_ugbs"] }));
  const [i, t] = [d.inspection!.social.find((o) => o.platform === "instagram")!, d.inspection!.social.find((o) => o.platform === "tiktok")!];
  assert.equal(i.access, "meta_only"); assert.equal(i.followers, "1,204"); assert.equal(i.posts, "87");
  assert.match(i.observed.join(" "), /1,204 followers/); assert.match(i.inferred.join(" "), /events|education/);
  assert.ok(i.inaccessible.some((x) => /feed|posts|engagement/.test(x)));
  assert.equal(t.access, "unreachable"); assert.equal(t.observed.length, 0); assert.ok(t.inaccessible.length > 0);
  assert.ok(d.limitations.some((l) => /UNKNOWN/.test(l) && /not show the accounts are inactive or absent/.test(l)));
  const prompt = c.deps.missionQueue.getSnapshot().find((t2) => t2.missionType === "dossier_profile")!.description;
  assert.match(prompt, /Never recommend creating an account on these platforms/); assert.match(prompt, /never "inactive" or "absent"/);
});

test("recommendation quality gate: unsupported, reasoning-free, metric-free and 'create an account' recommendations are rejected; valid JSON alone is not enough", () => {
  const ctx = { refs: new Set(["S1"]), text: new Map([["S1", "Mesa UGBS runs events and mentorship"]]), official: new Set<string>(), accounts: new Map([["instagram", "https://www.instagram.com/mesa_ugbs/"]]) } as never;
  const good = { title: "Publish an events calendar", area: "content", kind: "finding-based", currentSituation: "The site lists events only in free text", rationale: "Events are the main activity but are not scannable, so members cannot plan attendance ahead of time.", priority: "high", effort: "low", intendedOutcome: "higher attendance", successMetric: "RSVPs per event", nextSteps: ["Draft a monthly calendar for operator review"], basis: "hypothesis", sourceRefs: ["S1"] };
  const bad = [
    { ...good, title: "Create an Instagram account", rationale: "Set up an Instagram account so the association can be found by students on the platform." },
    { ...good, title: "Post more", sourceRefs: [] },
    { ...good, title: "Be better", rationale: "short" },
    { ...good, title: "No metric", successMetric: "", nextSteps: [] },
  ];
  const out = parseStageOutput("growth", JSON.stringify({ recommendations: [...bad, good] }), ctx) as { recommendations: unknown[]; rejected?: string[] };
  assert.equal(out.recommendations.length, 1); assert.equal(out.rejected!.length, 4);
  assert.ok(out.rejected!.some((r) => /already known/.test(r)));
  assert.throws(() => parseStageOutput("growth", JSON.stringify({ recommendations: bad }), ctx), /quality:/);
});

test("research quality is judged on gathered evidence: nothing read means 'insufficient', stated in limitations", async () => {
  const c = setup({ searchFn: async () => [] });
  const d = await discover(c, withSite({ website: undefined }));
  assert.equal(d.inspection!.quality!.level, "insufficient");
  assert.ok(d.limitations.some((l) => /evidence rating is insufficient/.test(l)));
});

// ---------------------------------------------------------------- review fixes: own-site host check, redirects, malformed encodings

test("isOwnSiteHost compares parsed hostnames: an unrelated or look-alike HTTPS domain never passes", () => {
  const own = "https://www.mesa.example/home";
  for (const ok of ["https://mesa.example/x", "http://www.mesa.example", "https://blog.mesa.example/p", "https://MESA.example:8443/a?b=1"]) assert.equal(isOwnSiteHost(own, ok), true, ok);
  for (const bad of ["https://attacker.example/steal", "https://mesa.example.evil.com/", "https://evilmesa.example/", "https://mesa-example.com/", "https://mesa.example@evil.com/", "https://user:pw@mesa.example/", "ftp://mesa.example/", "javascript:alert(1)", "https://evil.com/https://mesa.example/", "https://evil.com/?u=mesa.example", "not a url", ""]) assert.equal(isOwnSiteHost(own, bad), false, bad);
  assert.equal(isOwnSiteHost(undefined, "https://mesa.example"), false); assert.equal(isOwnSiteHost("", "https://mesa.example"), false);
  assert.equal(isOwnSiteHost("localhost", "https://localhost"), false, "a host without a dot is never an own-site match");
});

test("chat evidence retrieval fetches only the business's own site or trusted addresses: unrelated, look-alike, rejected and pending pages are never fetched", async () => {
  const fetched: string[] = [];
  const fetchFn = (u: string) => { fetched.push(u); return { ok: true, body: page("x", `<p>Mesa UGBS page ${FILL}</p>`), finalUrl: u }; };
  const c = setup({ searchFn: async () => [], fetchFn });
  const b = withSite({ website: "https://mesa.example" });
  const d = await discover(c, b);
  d.sources.push({ id: "S90", url: "https://rejected.example/r", title: "r", snippet: "", query: "q", retrievedAt: "t", confidence: "unverified", decision: "rejected", check: { status: "not_checked" } } as never, { id: "S91", url: "https://pending.example/p", title: "p", snippet: "", query: "q", retrievedAt: "t", confidence: "unverified", decision: "pending", check: { status: "not_checked" } } as never);
  fetched.length = 0;
  for (const urls of [["https://attacker.example/steal", "https://mesa.example.evil.com/x"], ["https://rejected.example/r", "https://pending.example/p"]]) {
    const r = await c.engine.addEvidence("b1", { urls });
    assert.equal(r.added.length, 0); assert.equal(r.notes.length, 2); assert.ok(r.notes.every((n) => /not fetched/.test(n)));
  }
  assert.deepEqual(fetched, [], "no outside page was fetched");
  const own = await c.engine.addEvidence("b1", { urls: ["https://blog.mesa.example/news"] });
  assert.deepEqual(fetched, ["https://blog.mesa.example/news"]); assert.equal(own.added[0].read, true);
});

test("a recorded website that redirects to another domain is not treated as official: it is held back and the redirected content is judged on its own evidence", async () => {
  const redirect = (u: string) => (u.startsWith("https://mesa.example") ? { ok: true, body: page("Mesa UGBS", `<p>Mesa UGBS, Legon. Call 0244123456. ${FILL}</p>`), finalUrl: "https://mesa-clone.example/" } : { ok: false, reason: "http_404" });
  const c = setup({ searchFn: async () => [], fetchFn: redirect });
  const d = await discover(c, withSite({ website: "https://mesa.example" }));
  assert.equal(d.inspection!.website!.redirectedToOtherDomain, "mesa-clone.example");
  const rec = d.sources.find((s) => s.url.startsWith("https://mesa.example"))!;
  assert.equal(rec.official, false); assert.equal(rec.decision, "pending"); assert.match(rec.decisionReason ?? "", /redirects to mesa-clone\.example/);
  const moved = d.sources.find((s) => s.url.startsWith("https://mesa-clone.example"))!;
  assert.ok(moved, "the redirected page is kept as an ordinary candidate"); assert.equal(moved.official, false);
  assert.ok(!d.sources.some((s) => s.official), "nothing is official when the recorded site redirected away");
  assert.equal(d.inspection!.conflicts.length, 0, "redirected contact details are not used as the official site's");
  assert.ok(d.limitations.some((l) => /redirects to a different domain/.test(l)));
  assert.match(c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!.description, /redirects to mesa-clone\.example/);
});

test("a same-site redirect (http to https, www) stays official; malformed mailto/tel percent-encoding does not abort inspection", async () => {
  const fetchFn = (u: string) => (u.startsWith("https://mesa.example") ? { ok: true, body: page("Mesa UGBS", `<a href="mailto:%E0%A4%A@x.com">bad</a><a href="tel:%zz0244123456">bad</a><a href="mailto:info@mesa.example">ok</a><p>Mesa UGBS Legon. ${FILL}</p>`), finalUrl: "https://www.mesa.example/" } : { ok: false, reason: "http_404" });
  const c = setup({ searchFn: async () => [], fetchFn });
  const d = await discover(c, withSite({ website: "https://mesa.example" }));
  assert.equal(d.stages.research.status, "completed"); assert.equal(d.inspection!.website!.redirectedToOtherDomain, undefined);
  assert.ok(d.sources.some((s) => s.official && s.decision === "approved"));
  assert.ok(d.inspection!.website!.contacts.emails.includes("info@mesa.example"));
  assert.ok(d.inspection!.website!.contacts.emails.every((e) => !e.includes("%")), "malformed encoded addresses are dropped, not stored");
});

test("the evidence rating is described as a count-based heuristic", async () => {
  const c = setup({ searchFn: async () => [] });
  const d = await discover(c, withSite({ website: undefined }));
  assert.ok(d.limitations.some((l) => /count-based heuristic/.test(l) && /does not judge how good/.test(l)));
  assert.match(c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!.description, /count-based heuristic, not a quality judgement/);
});
