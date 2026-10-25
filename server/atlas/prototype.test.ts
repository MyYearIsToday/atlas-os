import test from "node:test";
import assert from "node:assert/strict";
import { DossierEngine } from "./dossier";
import { PrototypeService, parseOutput, validateFiles, fillPlaceholder, inferMissionType, unsupportedSpecifics, LIMITS, type GenerateResult } from "./prototype";
import { routeTask } from "../workforce/router";
import { WorkforceProvider } from "../workforce/workforce-provider";
import { MISSION_TASK_TYPE } from "../../src/orchestrator/autonomous-workforce";
import { MissionRunner } from "../../src/orchestrator/mission-runner";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

const biz = { id: "b1", canonicalName: "Garden's Club", category: "hotel", address: "Osu, Accra", sourceReferences: ["manual"] } as never;
const page = (title: string, body: string, nav = '<a href="index.html">Home</a> <a href="about.html">About</a>') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles.css"></head><body><header><nav>${nav}<button id="menu">Menu</button></nav></header><main><h1>${title}</h1>${body}<p>${'Filler paragraph so the page is long enough to be a real website prototype page. '.repeat(6)}</p></main><script src="script.js"></script></body></html>`;
const OK_OUTPUT = `=== FILE: index.html ===\n${page("Garden's Club", '<p>Welcome to Garden\'s Club in Osu, Accra.</p><p>Call <span data-placeholder="phone">[Phone — to be confirmed]</span></p>')}\n=== FILE: about.html ===\n${page("About", "<p>About us.</p>")}\n=== FILE: styles.css ===\nbody{font-family:sans-serif}@media(max-width:600px){nav{display:block}}\n=== FILE: script.js ===\ndocument.getElementById('menu').addEventListener('click',()=>document.body.classList.toggle('open'));\n=== NOTES ===\n- INCOMPLETE: gallery page\n`;

function setup(gen?: (n: number, prompt: string) => GenerateResult | Promise<GenerateResult>, opts: { noGen?: boolean } = {}) {
  const deps = createPipelineDeps({}); let n = 0; const prompts: string[] = [];
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner: { run: async () => ({ outcome: "FAILED" }) }, retryCooldownMs: 1e9 });
  deps.store.businesses.set("b1", biz); const d = engine.ensure(biz); d.stages.research.status = "completed"; d.status = "active";
  const svc = new PrototypeService({ store: deps.store, missionQueue: deps.missionQueue, now: () => "2026-10-25T10:00:00.000Z",
    generate: opts.noGen ? undefined : async (req) => { n++; prompts.push(req.prompt); return (gen ?? (() => ({ ok: true, text: OK_OUTPUT, provider: "workforce", model: "coder-1", routing: { taskType: "website_prototype", employee: "coding_engineer" } as never, label: "workforce/coder-1 via workforce:coding_engineer" })))(n, req.prompt); } });
  return { deps, engine, d, svc, prompts, calls: () => n };
}
const wait = async (svc: PrototypeService, id: string) => { for (let i = 0; i < 200 && svc.isBusy(id); i++) await new Promise((r) => setTimeout(r, 5)); await new Promise((r) => setTimeout(r, 5)); };
const ok = (text: string): GenerateResult => ({ ok: true, text, provider: "workforce", model: "coder-2", routing: {} as never, label: "workforce/coder-2" });
const taskStatus = (c: ReturnType<typeof setup>, id: string) => c.deps.missionQueue.getSnapshot().find((t) => t.taskId === id)!.status;

test("routing: website_prototype goes to the coding employee, not the research employee; missions are recognised by type or clear title", () => {
  assert.equal(routeTask({ taskType: "website_prototype" }).employee, "coding_engineer");
  assert.equal(routeTask({ taskType: "research" }).employee, "scout");
  assert.equal(MISSION_TASK_TYPE.website_prototype, "website_prototype");
  const wf = WorkforceProvider.create({});
  assert.equal((wf.resolveEmployee({ workerRole: "researcher", taskType: "website_prototype" } as never) as { employee: string }).employee, "coding_engineer");
  assert.equal(inferMissionType({ title: "Prototype website design" }), "website_prototype");
  assert.equal(inferMissionType({ title: "Website prototype — Garden's Club" }), "website_prototype");
  assert.equal(inferMissionType({ title: "Audit the website SEO" }), undefined);
  assert.equal(inferMissionType({ title: "x", missionType: "dossier_followup" }), "dossier_followup");
});

test("end to end: files are generated, stored with business and mission, validated, and the mission waits for approval (never Completed)", async () => {
  const c = setup(); const r = await c.svc.start(biz, c.d, { instructions: "calm garden feel" });
  assert.equal(r.status, 202); const { prototypeId, taskId } = r.body as { prototypeId: string; taskId: string };
  const t0 = c.deps.missionQueue.getSnapshot().find((t) => t.taskId === taskId)!;
  assert.equal(t0.approvalRequired, "Approval Required"); assert.equal(t0.missionType, "website_prototype"); assert.equal(t0.assignedAI, "builder");
  await wait(c.svc, prototypeId);
  const p = c.svc.get(prototypeId)!;
  assert.equal(p.status, "preview_available"); assert.equal(p.businessId, "b1"); assert.equal(p.taskId, taskId);
  assert.deepEqual(c.svc.current(p).map((f) => f.path).sort(), ["about.html", "index.html", "script.js", "styles.css"]);
  assert.equal(taskStatus(c, taskId), "Waiting Approval", "not Completed until the operator approves");
  assert.ok(c.deps.store.prototypes.get(prototypeId), "persisted through the observed store");
  const s = c.svc.summary(p); assert.equal(s.published, false); assert.deepEqual(s.incompletePages, ["gallery page"]); assert.equal(s.placeholders[0].key, "phone");
  assert.match(c.prompts[0], /Garden's Club/); assert.match(c.prompts[0], /calm garden feel/);
  // approval completes the mission; only then
  assert.equal((await c.svc.decide(prototypeId, "approve", "tester")).status, 200);
  assert.equal(taskStatus(c, taskId), "Completed"); assert.equal(c.svc.get(prototypeId)!.status, "approved");
});

test("failures are visible: no model, model error, prose-only output and truncated output never produce a completed or preview-available prototype", async () => {
  const none = setup(undefined, { noGen: true }); assert.equal((await none.svc.start(biz, none.d, {})).status, 503);
  assert.equal(none.deps.missionQueue.getSnapshot().filter((t) => t.missionType === "website_prototype").length, 0, "nothing created when generation is unavailable");
  for (const out of [{ ok: false as const, reason: "PROVIDER_UNAVAILABLE: down" }, ok("Here is a long markdown specification with a sitemap and wireframes but no files at all, just words words words."), ok(OK_OUTPUT.replace("</html>\n=== FILE: about", "\n=== FILE: about"))]) {
    const c = setup(() => out as GenerateResult); const r = await c.svc.start(biz, c.d, {}); const { prototypeId, taskId } = r.body as { prototypeId: string; taskId: string };
    await wait(c.svc, prototypeId); const p = c.svc.get(prototypeId)!;
    assert.equal(p.status, "failed", JSON.stringify(out).slice(0, 60)); assert.ok(p.error); assert.equal(taskStatus(c, taskId), "Failed");
    assert.equal((await c.svc.decide(prototypeId, "approve", "x")).status, 409);
    assert.equal(c.calls(), 2, "exactly one bounded repair attempt");
  }
});

test("a first bad attempt is repaired once, with the concrete problems fed back", async () => {
  const c = setup((n) => (n === 1 ? ok("no files here, only a description of a website with a hero banner and a footer, nothing more at all") : ok(OK_OUTPUT)));
  const r = await c.svc.start(biz, c.d, {}); const id = (r.body as { prototypeId: string }).prototypeId; await wait(c.svc, id);
  assert.equal(c.svc.get(id)!.status, "preview_available"); assert.equal(c.calls(), 2); assert.match(c.prompts[1], /REJECTED FOR THESE REASONS/); assert.match(c.prompts[1], /no files/);
});

test("evidence: invented phone, email, price, rating and statistics block approval (needs_revision); placeholders and evidence-backed values do not", async () => {
  const invented = OK_OUTPUT.replace("<p>Welcome to Garden's Club in Osu, Accra.</p>", "<p>Rooms from GH₵ 450 per night. Rated 4.8 stars by 1,200 guests. Call +233 24 555 1234 or book@gardensclub.com</p>");
  const c = setup(() => ok(invented)); const r = await c.svc.start(biz, c.d, {}); const id = (r.body as { prototypeId: string }).prototypeId; await wait(c.svc, id);
  const p = c.svc.get(id)!; assert.equal(p.status, "needs_revision");
  const msg = c.svc.summary(p).issues.map((i) => i.message).join(" "); for (const w of ["price", "rating", "phone number", "email", "statistic"]) assert.match(msg, new RegExp(w));
  assert.equal((await c.svc.decide(id, "approve", "x")).status, 409); assert.notEqual(taskStatus(c, p.taskId), "Completed");
  assert.deepEqual(unsupportedSpecifics("Open daily. Call [x]. Located in Osu, Accra.", "Osu, Accra"), []);
  assert.deepEqual(unsupportedSpecifics("Call 024 555 1234", "Phone: 0245551234"), [], "a recorded phone is allowed");
  assert.equal(unsupportedSpecifics("Call 024 555 9999", "Phone: 0245551234").length, 1);
});

test("revision changes only the files returned; a failed revision keeps the previous version; versions are bounded", async () => {
  const revised = `=== FILE: about.html ===\n${page("About us", "<p>New about copy that is long enough to pass the length check for sure, repeated: one two three four five six seven eight nine ten.</p>")}\n`;
  const c = setup((n) => ok(n === 1 ? OK_OUTPUT : n === 2 ? revised : "garbage"));
  const id = ((await c.svc.start(biz, c.d, {})).body as { prototypeId: string }).prototypeId; await wait(c.svc, id);
  const v1 = c.svc.current(c.svc.get(id)!);
  assert.equal((await c.svc.revise(biz, c.d, id, "")).status, 400);
  assert.equal((await c.svc.revise(biz, c.d, id, "make the about page warmer")).status, 202); await wait(c.svc, id);
  const p = c.svc.get(id)!; assert.equal(p.current, 2); const v2 = c.svc.current(p);
  assert.deepEqual(p.versions[1].changed, ["about.html"]); assert.equal(v2.find((f) => f.path === "index.html")!.content, v1.find((f) => f.path === "index.html")!.content, "unrelated file untouched");
  assert.match(v2.find((f) => f.path === "about.html")!.content, /About us/); assert.equal(v2.length, 4);
  await c.svc.revise(biz, c.d, id, "break it"); await wait(c.svc, id);
  const q = c.svc.get(id)!; assert.equal(q.current, 2, "failed revision did not replace the version"); assert.equal(q.status, "needs_revision"); assert.ok(q.error);
  assert.equal(c.svc.current(q).length, 4);
});

test("placeholder fill updates files without a model call and escapes the value", async () => {
  const c = setup(); const id = ((await c.svc.start(biz, c.d, {})).body as { prototypeId: string }).prototypeId; await wait(c.svc, id); const before = c.calls();
  assert.equal((await c.svc.fill(id, "phone", "<script>alert(1)</script>")).status, 200);
  const html = c.svc.current(c.svc.get(id)!).find((f) => f.path === "index.html")!.content; assert.ok(!html.includes("<script>alert"), "value escaped"); assert.match(html, /data-confirmed="phone"/);
  assert.equal(c.calls(), before); assert.equal((await c.svc.fill(id, "nope", "x")).status, 404); assert.equal((await c.svc.fill(id, "../x", "x")).status, 400);
  assert.equal(fillPlaceholder([{ path: "a.html", content: "x", bytes: 1 }], "k", "v" ).hasOwnProperty("error"), true);
});

test("file safety: traversal, odd extensions, size and count limits, external scripts, network/storage APIs and iframes are rejected", () => {
  const out = parseOutput(`=== FILE: ../evil.html ===\nx\n=== FILE: /etc/passwd ===\nx\n=== FILE: a/b/c/d/e/f.html ===\nx\n=== FILE: run.exe ===\nx\n=== FILE: ok.html ===\n<html><body>${"a".repeat(700)}</body></html>\n=== FILE: big.css ===\n${"a".repeat(LIMITS.fileBytes + 1)}\n`);
  assert.deepEqual(out.files.map((f) => f.path), ["ok.html"]); assert.equal(out.issues.filter((i) => i.severity === "error").length, 5);
  const bad = (html: string) => validateFiles([{ path: "index.html", content: html, bytes: html.length }], "", []);
  const shell = (inner: string) => `<!doctype html><html><head><title>t</title><meta name="viewport" content="width=device-width"></head><body>${inner}${"x".repeat(700)}</body></html>`;
  for (const inner of ['<iframe src="x"></iframe>', '<script src="https://cdn.example/x.js"></script>', "<script>fetch('/api/x')</script>", "<script>localStorage.setItem('a','b')</script>", "<script>top.location='x'</script>", '<a href="javascript:alert(1)">x</a>', '<meta http-equiv="refresh" content="0;url=x">', '<img src="asset:I9">']) assert.equal(bad(shell(inner)).ok, false, inner);
  assert.equal(bad(shell('<a href="#top">x</a><script>document.body.onclick=()=>1</script>')).ok, true);
  const many = Array.from({ length: LIMITS.files + 3 }, (_, i) => `=== FILE: p${i}.html ===\n<html><body>${"a".repeat(700)}</body></html>`).join("\n");
  assert.ok(parseOutput(many).files.length <= LIMITS.files);
});

test("mission runner: a website mission is never completed by a text answer; the handler is used, and approval is required", async () => {
  const c = setup(); let called = 0; const store = c.deps.store;
  const mk = (title: string, missionType?: string) => c.deps.missionQueue.create({ title, description: "d", assignedAI: "scout", clientId: "b1", priority: "Medium", approvalRequired: "Approval Required", dueDate: "2026-10-25", estimatedCost: 0, estimatedTime: "x", ...(missionType ? { missionType } : {}) });
  const workforce = { executeMission: async () => { throw new Error("must not run as a text mission"); } } as never;
  const runner = (handler?: boolean, enabled = true) => new MissionRunner({ workforce, missionQueue: c.deps.missionQueue, ledger: {} as never, dispatcher: {} as never, store, executionEnabled: enabled,
    implementationTypes: (t) => inferMissionType(t) === "website_prototype", implementationHandler: handler ? async (t) => { called++; return c.svc.startForTask(biz, c.d, t); } : undefined });
  const hand = await mk("Prototype website design");   // the Garden's Club case: untyped, assigned to Scout
  assert.equal((await runner(true).run(hand.taskId, {})).outcome, "BLOCKED", "needs human approval");
  assert.equal((await runner(false).run(hand.taskId, { approvedByHuman: true })).outcome, "BLOCKED", "no handler: blocked, not completed");
  assert.equal(c.deps.missionQueue.getSnapshot().find((t) => t.taskId === hand.taskId)!.status, "Pending");
  const r = await runner(true).run(hand.taskId, { approvedByHuman: true }); assert.equal(r.outcome, "RUNNING"); assert.equal(called, 1);
  const p = c.svc.forBusiness("b1")[0]; await wait(c.svc, p.id); assert.equal(p.taskId, hand.taskId); assert.equal(c.svc.get(p.id)!.status, "preview_available");
  assert.equal(c.deps.missionQueue.getSnapshot().find((t) => t.taskId === hand.taskId)!.status, "Waiting Approval");
});

test("preconditions: unconfirmed sources, unfinished research and other businesses' missions are refused", async () => {
  const c = setup(); c.d.status = "awaiting_sources"; assert.equal((await c.svc.start(biz, c.d, {})).status, 409);
  c.d.status = "active"; c.d.stages.research.status = "pending"; assert.equal((await c.svc.start(biz, c.d, {})).status, 409);
  c.d.stages.research.status = "completed";
  const other = await c.deps.missionQueue.create({ title: "Website prototype", description: "d", assignedAI: "builder", clientId: "other", priority: "Medium", approvalRequired: "Approval Required", dueDate: "2026-10-25", estimatedCost: 0, estimatedTime: "x" });
  assert.equal((await c.svc.start(biz, c.d, { taskId: other.taskId })).status, 404);
  assert.equal((await c.svc.revise(biz, c.d, "proto_0000000000", "x")).status, 404);
});
