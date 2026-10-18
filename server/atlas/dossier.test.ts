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
function setup(opts: { script?: (type: string, call: number) => string | "FAIL"; search?: never; maxConcurrent?: number; cooldown?: number; analyze?: (id: string, img: { url: string; mimeType: string; dataUrl: string }) => Promise<{ status: string; observations: Array<{ observation: string; category: string; confidence: string }> }> } = {}) {
  const deps = createPipelineDeps({});
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const runner = { async run(taskId: string) {
    const t = deps.missionQueue.getSnapshot().find((x) => x.taskId === taskId)!;
    calls.push(t.missionType!);
    const n = (counts.get(t.missionType!) ?? 0) + 1; counts.set(t.missionType!, n);
    const out = (opts.script ?? ((type) => JSON.stringify(GOOD[type])))(t.missionType!, n);
    if (out === "FAIL") { await deps.missionQueue.update(taskId, { status: "Failed", lastFailureReason: "provider down", retryCount: t.retryCount + 1 }); return { outcome: "FAILED", reason: "provider down" }; }
    await deps.missionQueue.update(taskId, { status: "Completed", completedAt: new Date().toISOString() });
    deps.store.missionOutputs.set(taskId, { generatedBy: "test/model", text: out, isEvidence: false });
    return { outcome: "COMPLETED" };
  } };
  const search = async (q: string) => [{ title: "Mesa UGBS Legon", url: `https://example.com/mesa-ugbs/${encodeURIComponent(q).slice(-10)}`, snippet: "Mesa UGBS, University of Ghana Legon" }, { title: "Mesa Verde Winery", url: `https://wine.example/${encodeURIComponent(q).slice(-8)}`, snippet: "Napa valley wines" }];
  const fetchDoc = async (url: string, o?: { binary?: boolean }) => (o?.binary ? { ok: true, contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) } : url.includes("wine.") ? { ok: true, body: "<html><title>Wine</title>Napa wines</html>", finalUrl: url } : { ok: true, body: PAGE, finalUrl: url });
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner, search, fetchDoc, analyzeImage: opts.analyze, maxConcurrent: opts.maxConcurrent, retryCooldownMs: opts.cooldown ?? 0 });
  return { deps, engine, calls };
}
const discover = async (ctx: ReturnType<typeof setup>, b = biz()) => { const id = (b as { id: string }).id; ctx.deps.store.businesses.set(id, b); ctx.deps.store.started.add(id); ctx.engine.ensure(b); ctx.engine.kick(id); await ctx.engine.idle(); return ctx.engine.get(id)!; };
/** Discovery, then the operator approves every source the engine did not reject, then the staged work runs. */
const start = async (ctx: ReturnType<typeof setup>, b = biz()) => { const d = await discover(ctx, b); const id = d.businessId; for (const src of d.sources.filter((u) => u.decision === "pending")) await ctx.engine.applyAction(id, { action: "decide", sourceId: src.id, decision: "approved" }); await ctx.engine.applyAction(id, { action: "approve" }); await ctx.engine.idle(); await ctx.engine.applyAction(id, { action: "approve_competitors" }); await ctx.engine.idle(); const mid = ctx.engine.get(id)!; if (mid.competitorApproval?.status === "awaiting") { for (const src of mid.sources.filter((u) => u.role === "competitor" && u.decision === "pending")) await ctx.engine.applyAction(id, { action: "decide", sourceId: src.id, decision: "approved" }); await ctx.engine.applyAction(id, { action: "approve_competitors" }); await ctx.engine.idle(); } return ctx.engine.get(id)!; };

test("full chain: research -> profile -> audit -> SWOT -> growth -> plan, structured, sourced, follow-ups need approval", async () => {
  const c = setup();
  const d = await start(c);
  assert.equal(d.status, "completed");
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

test("unusable model output is retried once with a fresh mission, then escalated as blocked; operator retry gets a fresh attempt", async () => {
  let bad = true;
  const c = setup({ script: (type) => (type === "dossier_audit" && bad ? "I think the business is fine." : JSON.stringify(GOOD[type])) });
  const d = await start(c);
  assert.equal(d.stages.audit.status, "blocked");
  assert.equal(d.status, "blocked");
  assert.equal(c.calls.filter((t) => t === "dossier_audit").length, 2);
  assert.equal(d.stages.swot.status, "pending", "later stages do not run behind a blocked stage");
  assert.match(d.stages.audit.error ?? "", /invalid_output/);
  bad = false;
  assert.equal(c.engine.resume("b1").ok, true);
  c.engine.kick("b1"); await c.engine.idle();
  await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  assert.equal(c.engine.get("b1")!.status, "completed");
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

test("search failure is recorded as a limitation and the chain continues with eligible work", async () => {
  const c = setup();
  const failing = new DossierEngine({ store: c.deps.store, missionQueue: c.deps.missionQueue, runner: { run: async (id) => { const t = c.deps.missionQueue.getSnapshot().find((x) => x.taskId === id)!; await c.deps.missionQueue.update(id, { status: "Completed" }); c.deps.store.missionOutputs.set(id, { generatedBy: "t", text: JSON.stringify(GOOD[t.missionType!]), isEvidence: false }); return { outcome: "COMPLETED" }; } }, search: async () => { throw Object.assign(new Error("x"), { code: "rate_limited" }); } });
  const b = biz(); c.deps.store.businesses.set("b1", b); c.deps.store.started.add("b1"); failing.ensure(b); failing.kick("b1"); await failing.idle();
  assert.equal(failing.get("b1")!.status, "awaiting_sources");
  await failing.applyAction("b1", { action: "approve" }); await failing.idle(); await failing.applyAction("b1", { action: "approve_competitors" }); await failing.idle();
  const d = failing.get("b1")!;
  assert.equal(d.status, "completed");
  assert.ok((d.stages.profile.output as { facts: Array<{ basis: string }> }).facts.every((f) => f.basis !== "verified"), "nothing can be verified without approved sources");
  assert.equal(d.sources.length, 0);
  assert.match(d.limitations.join(" "), /Web search failed \(rate_limited\)/);
});

test("concurrency is bounded: a second business is queued, not run in parallel", async () => {
  const c = setup({ maxConcurrent: 1 });
  for (const id of ["b1", "b2"]) { const b = biz(id); c.deps.store.businesses.set(id, b); c.deps.store.started.add(id); c.engine.ensure(b); }
  assert.equal(c.engine.kick("b1").accepted, true);
  assert.equal(c.engine.kick("b2").accepted, false);
  await c.engine.idle();
  await c.engine.tick(12); await c.engine.idle();
  for (const id of ["b1", "b2"]) { await c.engine.applyAction(id, { action: "decide", sourceId: "S1", decision: "approved" }); await c.engine.applyAction(id, { action: "approve" }); await c.engine.idle(); await c.engine.applyAction(id, { action: "approve_competitors" }); await c.engine.idle(); }
  await c.engine.tick(12); await c.engine.idle();
  assert.equal(c.engine.get("b2")!.status, "completed");
});

test("parser rejects empty or non-JSON output", () => {
  assert.throws(() => parseStageOutput("swot", "no json here", new Set()));
  assert.throws(() => parseStageOutput("growth", '{"recommendations":[]}', new Set()), /no growth/);
  assert.equal((parseStageOutput("audit", '```json\n{"summary":"s","gaps":[{"text":"g","basis":"verified"}]}\n```', new Set()) as { gaps: Array<{ basis: string }> }).gaps[0].basis, "hypothesis");
});

// ---------------------------------------------------------------- source approval, evidence integrity, images

test("research only discovers: unrelated results are excluded, dedupe holds, nothing downstream runs until the operator approves", async () => {
  const c = setup();
  const d = await discover(c);
  assert.equal(d.status, "awaiting_sources");
  assert.equal(d.sourceApproval?.status, "awaiting");
  assert.deepEqual(c.calls, [], "no AI stage runs before approval");
  const winery = d.sources.filter((s) => s.url.includes("wine.example"));
  assert.ok(winery.length >= 1 && winery.every((s) => s.relevance === "unrelated" && s.decision === "rejected"), "a similarly named business is excluded");
  assert.ok(d.sources.filter((s) => s.relevance !== "unrelated").every((s) => s.decision === "pending" && s.check?.status === "fetched" && s.pageText));
  assert.equal(new Set(d.sources.map((s) => s.url)).size, d.sources.length);
  assert.ok((d.images ?? []).length >= 1 && d.images!.every((i) => i.decision === "pending" && i.pageUrl && i.sourceId));
  await c.engine.tick(); await c.engine.idle();
  assert.deepEqual(c.calls, [], "the scheduler does not bypass the checkpoint either");
  const ok = d.sources.find((s) => s.relevance !== "unrelated")!;
  assert.equal((await c.engine.applyAction("b1", { action: "decide", sourceId: ok.id, decision: "approved" })).status, 200);
  await c.engine.applyAction("b1", { action: "approve" }); await c.engine.idle(); await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  assert.equal(c.engine.get("b1")!.status, "completed");
  const prompt = c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!.description;
  assert.match(prompt, new RegExp(ok.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(prompt, /wine\.example|Napa/, "rejected sources never reach the prompt");
});

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

test("operator can add, de-duplicate, mark official and reject sources; every action is validated", async () => {
  const c = setup();
  await discover(c);
  const add = await c.engine.applyAction("b1", { action: "add", url: "https://www.mesa-ugbs.org/about?utm_source=x", title: "Official site", official: true });
  assert.equal(add.status, 200);
  const d = c.engine.get("b1")!;
  const added = d.sources.find((s) => s.origin === "operator")!;
  assert.ok(added.official && added.decision === "approved" && added.check?.status === "fetched");
  assert.equal((await c.engine.applyAction("b1", { action: "add", url: "https://mesa-ugbs.org/about" })).status, 409, "same page after normalisation is a duplicate");
  assert.equal((await c.engine.applyAction("b1", { action: "add", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await c.engine.applyAction("b1", { action: "decide", sourceId: "nope", decision: "approved" })).status, 404);
  assert.equal((await c.engine.applyAction("b1", { action: "decide", sourceId: added.id, decision: "maybe" })).status, 400);
  await c.engine.applyAction("b1", { action: "official", sourceId: added.id, official: false });
  assert.equal(c.engine.get("b1")!.sources.find((s) => s.id === added.id)!.official, false);
  assert.equal((await c.engine.applyAction("b1", { action: "approve", actor: "human:test" })).status, 200);
  assert.equal(c.engine.get("b1")!.sourceApproval?.approvedBy, "human:test");
  await c.engine.idle();
});

test("approval with no matching source is allowed but nothing can be verified, and the limitation is recorded", async () => {
  const c = setup();
  const d = await discover(c);
  for (const s of d.sources) await c.engine.applyAction("b1", { action: "decide", sourceId: s.id, decision: "rejected" });
  await c.engine.applyAction("b1", { action: "approve" }); await c.engine.idle(); await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  const done = c.engine.get("b1")!;
  assert.match(done.limitations.join(" "), /without approving any source/);
  assert.ok((done.stages.profile.output as { facts: Array<{ basis: string }> }).facts.every((f) => f.basis === "hypothesis"));
});

test("images are candidates until confirmed; confirmed ones are analysed (or honestly reported as not analysed) and reach the audit prompt", async () => {
  const seen: string[] = [];
  const c = setup({ analyze: async (_id, img) => { seen.push(img.url); return { status: "ANALYZED", observations: [{ observation: "Blue wordmark on white", category: "branding", confidence: "MEDIUM" }] }; } });
  const d = await discover(c);
  const img = d.images![0];
  await c.engine.applyAction("b1", { action: "image", imageId: img.id, decision: "confirmed" });
  for (const s of d.sources.filter((u) => u.decision === "pending")) await c.engine.applyAction("b1", { action: "decide", sourceId: s.id, decision: "approved" });
  await c.engine.applyAction("b1", { action: "approve" }); await c.engine.idle(); await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  assert.deepEqual(seen, [img.url], "only the confirmed image was analysed");
  assert.equal(c.engine.get("b1")!.images![0].analysis?.status, "analyzed");
  assert.match(c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_audit")!.description, /Blue wordmark on white/);

  const none = setup();
  const d2 = await discover(none);
  await none.engine.applyAction("b1", { action: "image", imageId: d2.images![0].id, decision: "confirmed" });
  await none.engine.applyAction("b1", { action: "approve" }); await none.engine.idle(); await none.engine.applyAction("b1", { action: "approve_competitors" }); await none.engine.idle();
  assert.match(none.engine.get("b1")!.images![0].analysis?.reason ?? "", /not enabled/);
});

test("competitor discovery is a separate checkpoint; only approved competitors are analysed; invented competitors and unsupported estimates are dropped", async () => {
  let cid = "";
  const c = setup({ script: (type) => JSON.stringify(type === "dossier_competitors" ? { shortlist: [
    { name: "Verde Winery", url: "https://wine.example", type: "indirect", whySelected: "serves the same social need", sourceRefs: [cid], positioning: { text: "Premium wines", basis: "verified", quote: "Napa wines" }, offerings: ["wine"], strengths: [], weaknesses: [] },
    { name: "Invented Rival Ltd", sourceRefs: ["S99"], positioning: { text: "x" } }], whitespace: [], threats: [], gaps: ["pricing not found in approved sources"], conflicts: [], method: "m" }
    : GOOD[type]) });
  const d0 = await discover(c);
  for (const s of d0.sources.filter((u) => u.decision === "pending")) await c.engine.applyAction("b1", { action: "decide", sourceId: s.id, decision: "approved" });
  await c.engine.applyAction("b1", { action: "approve" }); await c.engine.idle();
  const mid = c.engine.get("b1")!;
  assert.equal(mid.status, "awaiting_sources"); assert.equal(mid.competitorApproval?.status, "awaiting");
  assert.equal(mid.stages.competitor_discovery.status, "completed"); assert.equal(mid.stages.competitors.status, "pending");
  const cands = mid.sources.filter((u) => u.role === "competitor");
  assert.ok(cands.length >= 1 && cands.every((u) => u.decision === "pending" && u.pageText), "candidates are read but wait for approval");
  assert.ok(!cands.some((u) => u.url.includes("example.com/mesa-ugbs")), "the business's own pages are not competitors");
  cid = cands.find((u) => u.url.includes("wine.example"))!.id;
  await c.engine.tick(); await c.engine.idle();
  assert.equal(c.engine.get("b1")!.stages.competitors.status, "pending", "scheduler cannot bypass the competitor checkpoint");
  await c.engine.applyAction("b1", { action: "decide", sourceId: cid, decision: "approved" });
  await c.engine.applyAction("b1", { action: "approve_competitors" }); await c.engine.idle();
  const done = c.engine.get("b1")!;
  assert.equal(done.status, "completed");
  const out = done.stages.competitors.output as { shortlist: Array<{ name: string; positioning: { basis: string } }> };
  assert.deepEqual(out.shortlist.map((x) => x.name), ["Verde Winery"], "a competitor with no approved source is dropped, never invented");
  assert.equal(out.shortlist[0].positioning.basis, "hypothesis", "a quote under 20 chars cannot earn VERIFIED");
  const mkt = done.stages.market.output as { estimates: unknown[] };
  assert.equal(mkt.estimates.length, 0, "an estimate without an approved source is dropped");
  assert.doesNotMatch(c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_profile")!.description, /COMPETITOR/);
  assert.match(c.deps.missionQueue.getSnapshot().find((t) => t.missionType === "dossier_competitors")!.description, /APPROVED COMPETITOR SOURCES/);
});
