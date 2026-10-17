import test from "node:test";
import assert from "node:assert/strict";
import { DossierEngine, parseStageOutput, STAGES } from "./dossier";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

const biz = (id = "b1") => ({ id, canonicalName: "Mesa UGBS", category: "education", address: "University of Ghana, Legon", sourceReferences: ["manual"] }) as never;
const GOOD: Record<string, unknown> = {
  dossier_profile: { name: "Mesa UGBS", industry: "student association", productsServices: ["events"], location: "Legon", targetAudience: "students", website: "unknown", socialAccounts: [{ platform: "LinkedIn", url: "https://linkedin.com/x", basis: "verified" }], brandNotes: "", facts: [{ claim: "Student body of UGBS", basis: "verified", sourceRefs: ["S1"], confidence: "medium" }, { claim: "Has 5k followers", basis: "verified", sourceRefs: ["S99"], confidence: "high" }], unknowns: ["website"] },
  dossier_audit: { summary: "Thin web presence", strengths: [{ text: "Active LinkedIn", basis: "verified", sourceRefs: ["S1"] }], weaknesses: [{ text: "No website", basis: "hypothesis", sourceRefs: [] }], gaps: [], improvementOpportunities: [] },
  dossier_swot: { strengths: [{ text: "Brand tied to UGBS", basis: "verified", sourceRefs: ["S1"] }], weaknesses: [], opportunities: [{ text: "Event content", basis: "hypothesis", sourceRefs: [] }], threats: [{ text: "Other associations", basis: "unknown", sourceRefs: [] }] },
  dossier_growth: { recommendations: [{ title: "Launch a website", area: "visibility", rationale: "none exists", priority: "high", effort: "medium", basis: "hypothesis", sourceRefs: [] }] },
  dossier_plan: { dossierSummary: "Summary.", actionPlan: [{ title: "Build site", description: "d", owner: "Atlas", timeframe: "30 days" }], followUps: [{ title: "Draft outreach to the association", description: "draft", assignedAI: "closer", external: true }, { title: "Competitor scan", description: "scan", assignedAI: "finance", external: false }], limitations: ["No score"] },
};

function setup(opts: { script?: (type: string, call: number) => string | "FAIL"; search?: never; maxConcurrent?: number; cooldown?: number } = {}) {
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
  const search = async (q: string) => [{ title: `R ${q.slice(0, 8)}`, url: `https://example.com/${encodeURIComponent(q)}`, snippet: "snippet" }];
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner, search, maxConcurrent: opts.maxConcurrent, retryCooldownMs: opts.cooldown ?? 0 });
  return { deps, engine, calls };
}
const start = async (ctx: ReturnType<typeof setup>, b = biz()) => { ctx.deps.store.businesses.set((b as { id: string }).id, b); ctx.deps.store.started.add((b as { id: string }).id); ctx.engine.ensure(b); ctx.engine.kick((b as { id: string }).id); await ctx.engine.idle(); return ctx.engine.get((b as { id: string }).id)!; };

test("full chain: research -> profile -> audit -> SWOT -> growth -> plan, structured, sourced, follow-ups need approval", async () => {
  const c = setup();
  const d = await start(c);
  assert.equal(d.status, "completed");
  assert.deepEqual(STAGES.map((s) => d.stages[s.id].status), Array(6).fill("completed"));
  assert.deepEqual(c.calls, ["dossier_profile", "dossier_audit", "dossier_swot", "dossier_growth", "dossier_plan"]);
  assert.ok(d.sources.length >= 1 && d.sources[0].id === "S1" && d.sources[0].confidence === "unverified" && d.sources[0].retrievedAt);
  const facts = (d.stages.profile.output as { facts: Array<{ claim: string; basis: string }> }).facts;
  assert.equal(facts[0].basis, "verified");
  assert.equal(facts[1].basis, "hypothesis", "a 'verified' claim citing a non-existent source is downgraded");
  // each stage mission is internal, Auto, linked to the business, and carries the previous stage's output
  const stageTasks = c.deps.missionQueue.getSnapshot().filter((t) => t.missionType !== "dossier_followup");
  assert.equal(stageTasks.length, 5);
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
  assert.equal(c.calls.length, 5);
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
  d.stages.research = { ...d.stages.research, status: "completed" };
  const t = await c.deps.missionQueue.create({ title: "x", description: "x", assignedAI: "scout", clientId: "b1", priority: "Medium", approvalRequired: "Auto", missionType: "dossier_profile", dueDate: "2026-10-17", estimatedCost: 0, estimatedTime: "u" });
  await c.deps.missionQueue.update(t.taskId, { status: "In Progress" });
  d.stages.profile = { ...d.stages.profile, status: "running", taskId: t.taskId };
  c.engine.kick("b1"); await c.engine.idle();
  assert.equal(c.engine.get("b1")!.stages.profile.taskId, t.taskId);
  assert.equal(c.deps.missionQueue.getSnapshot().filter((x) => x.missionType === "dossier_profile").length, 1);
  assert.equal(c.engine.get("b1")!.status, "completed");
});

test("search failure is recorded as a limitation and the chain continues with eligible work", async () => {
  const c = setup();
  const failing = new DossierEngine({ store: c.deps.store, missionQueue: c.deps.missionQueue, runner: { run: async (id) => { const t = c.deps.missionQueue.getSnapshot().find((x) => x.taskId === id)!; await c.deps.missionQueue.update(id, { status: "Completed" }); c.deps.store.missionOutputs.set(id, { generatedBy: "t", text: JSON.stringify(GOOD[t.missionType!]), isEvidence: false }); return { outcome: "COMPLETED" }; } }, search: async () => { throw Object.assign(new Error("x"), { code: "rate_limited" }); } });
  const b = biz(); c.deps.store.businesses.set("b1", b); c.deps.store.started.add("b1"); failing.ensure(b); failing.kick("b1"); await failing.idle();
  const d = failing.get("b1")!;
  assert.equal(d.status, "completed");
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
  assert.equal(c.engine.get("b2")!.status, "completed");
});

test("parser rejects empty or non-JSON output", () => {
  assert.throws(() => parseStageOutput("swot", "no json here", new Set()));
  assert.throws(() => parseStageOutput("growth", '{"recommendations":[]}', new Set()), /no growth/);
  assert.equal((parseStageOutput("audit", '```json\n{"summary":"s","gaps":[{"text":"g","basis":"verified"}]}\n```', new Set()) as { gaps: Array<{ basis: string }> }).gaps[0].basis, "hypothesis");
});
