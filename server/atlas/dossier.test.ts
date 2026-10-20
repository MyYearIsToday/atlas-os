import test from "node:test";
import assert from "node:assert/strict";
import { DossierEngine, parseStageOutput, STAGES } from "./dossier";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

const biz = (id = "b1") => ({ id, canonicalName: "Mesa UGBS", category: "education", address: "University of Ghana, Legon", sourceReferences: ["manual"] }) as never;
const GOOD: Record<string, unknown> = {
  dossier_profile: { name: "Mesa UGBS", industry: "student association", productsServices: ["events"], location: "Legon", targetAudience: "students", website: "unknown", socialAccounts: [{ platform: "LinkedIn", url: "https://linkedin.com/x", basis: "verified" }], brandNotes: "", facts: [{ claim: "Student body of UGBS", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School", confidence: "medium" }, { claim: "Has 5k followers", basis: "verified", sourceRefs: ["S99"], confidence: "high" }], unknowns: ["website"] },
  dossier_audit: { summary: "Thin web presence", strengths: [{ text: "Active LinkedIn", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School" }], weaknesses: [{ text: "No website", basis: "hypothesis", sourceRefs: [] }], gaps: [], improvementOpportunities: [] },
  dossier_competitors: { shortlist: [], whitespace: [], threats: [], gaps: ["none established"], conflicts: [], method: "m" },
  dossier_market: { audience: [{ text: "Students", basis: "hypothesis", sourceRefs: [] }], localContext: [], trends: [], opportunities: [{ title: "Event content", rationale: "r", basis: "hypothesis" }], threats: [], barriers: [], unknowns: ["demand data"], estimates: [{ description: "invented market size", method: "guess", uncertainty: "high", sourceRefs: [] }] },
  dossier_campaign: { objective: "o", pillars: [{ name: "Events", rationale: "r" }], channels: [{ channel: "Instagram", why: "w", constraints: "c" }], campaigns: [{ name: "Launch", objective: "o", audience: "a", message: "m", callToAction: "c", channels: ["Instagram"], kpis: [{ metric: "reach", measurement: "insights" }] }], sequence: [{ activity: "Draft", dependsOn: "approval" }], content: [{ campaign: "Launch", platform: "Instagram", format: "post", draft: "Hello Legon", creativeBrief: "b" }], assumptions: [] },
  dossier_swot: { strengths: [{ text: "Brand tied to UGBS", basis: "verified", sourceRefs: ["S1"], quote: "official student association of the University of Ghana Business School" }], weaknesses: [], opportunities: [{ text: "Event content", basis: "hypothesis", sourceRefs: [] }], threats: [{ text: "Other associations", basis: "unknown", sourceRefs: [] }] },
  dossier_growth: { recommendations: [{ title: "Launch a website", area: "visibility", rationale: "none exists", priority: "high", effort: "medium", basis: "hypothesis", sourceRefs: [] }] },
  dossier_plan: { dossierSummary: "Summary.", actionPlan: [{ title: "Build site", description: "d", owner: "Atlas", timeframe: "30 days" }], followUps: [{ title: "Draft outreach to the association", description: "draft", assignedAI: "closer", external: true }, { title: "Competitor scan", description: "scan", assignedAI: "finance", external: false }], limitations: ["No score"] },
};

const PAGE = `<html><head><title>Mesa UGBS</title><meta property="og:image" content="/logo.png"></head><body><h1>Mesa UGBS</h1><p>Mesa UGBS is the official student association of the University of Ghana Business School in Legon, Accra.</p></body></html>`;
function setup(opts: { script?: (type: string, call: number) => string | "FAIL"; searchFn?: (q: string) => Promise<Array<{ title: string; url: string; snippet?: string }>>; fetchFn?: (url: string) => { ok: boolean; body?: string; reason?: string; finalUrl?: string } | null; onRun?: (taskId: string, type: string, n: number) => void; search?: never; maxConcurrent?: number; cooldown?: number; analyze?: (id: string, img: { url: string; mimeType: string; dataUrl: string }) => Promise<{ status: string; observations: Array<{ observation: string; category: string; confidence: string }> }> } = {}) {
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
  const fetchDoc = async (url: string, o?: { binary?: boolean }) => { const ov = o?.binary ? null : opts.fetchFn?.(url); if (ov) return ov; return defaultFetch(url, o); };
  const defaultFetch = async (url: string, o?: { binary?: boolean }) => (o?.binary ? { ok: true, contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) } : url.includes("wine.") ? { ok: true, body: "<html><title>Wine</title>Napa wines</html>", finalUrl: url } : { ok: true, body: PAGE, finalUrl: url });
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner, search, fetchDoc, analyzeImage: opts.analyze, maxConcurrent: opts.maxConcurrent, retryCooldownMs: opts.cooldown ?? 0 });
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
