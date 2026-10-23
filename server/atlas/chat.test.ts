import assert from "node:assert/strict";
import test from "node:test";
import { DossierEngine } from "./dossier";
import { ChatService, parseChatReply, type ChatModel } from "./chat";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";

const TEXT_A = "Mesa UGBS is the official student association of the University of Ghana Business School. It runs a mentorship programme every semester and publishes its events on Instagram.";
const TEXT_B = "ZtouchStudio is a photography and video studio in Osu, Accra offering wedding photography and portrait sessions.";
const bizA = { id: "a1", canonicalName: "Mesa UGBS", category: "student association", address: "Legon, Accra", website: "https://mesa.example", sourceReferences: ["manual"] } as never;
const bizB = { id: "b1", canonicalName: "ZtouchStudio", category: "photography", address: "Osu, Accra", website: "https://ztouchstudio.example", sourceReferences: ["manual"] } as never;

function harness(opts: { reply?: (n: number, system: string, content: string) => string | { fail: true }; fetchDoc?: (u: string) => { ok: boolean; body?: string; reason?: string; finalUrl?: string } } = {}) {
  const deps = createPipelineDeps({});
  const engine = new DossierEngine({ store: deps.store, missionQueue: deps.missionQueue, runner: { async run() { return { outcome: "FAILED", reason: "n/a" }; } } as never, retryCooldownMs: 0,
    fetchDoc: (async (u: string) => opts.fetchDoc?.(u) ?? { ok: false, reason: "http_404" }) as never, search: async () => [] });
  const seed = (b: never, id: string, text: string, url: string) => {
    deps.store.businesses.set(id, b); deps.store.started.add(id); const d = engine.ensure(b);
    d.sources.push({ id: "S1", url, title: "official page", snippet: "", query: "q", retrievedAt: "t", confidence: "checked", kind: "official_site", relevance: "match", decision: "approved", decidedBy: "auto", official: true, check: { status: "fetched" }, pageText: text });
    d.sourceApproval = { status: "approved", mode: "auto" }; return d;
  };
  seed(bizA, "a1", TEXT_A, "https://mesa.example/about"); seed(bizB, "b1", TEXT_B, "https://ztouchstudio.example/");
  const calls: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
  const model: ChatModel = async (req) => {
    calls.push({ system: req.system, messages: req.messages });
    const r = opts.reply?.(calls.length, req.system, req.messages.at(-1)!.content) ?? JSON.stringify({ answer: "ok", citations: [] });
    return typeof r === "object" ? { ok: false, reason: "PROVIDER_UNAVAILABLE" } : { ok: true, text: r, provider: "test", model: "m1" };
  };
  const puts: Array<[string, string, unknown]> = [];
  const persistence = { put: (c: string, id: string, doc: unknown) => { puts.push([c, id, JSON.parse(JSON.stringify(doc))]); }, flush: async () => undefined, loadAll: async () => [...new Map(puts.filter((p) => p[0] === "conversation").map((p) => [p[1], { id: p[1], doc: p[2] }])).values()] } as never;
  const chat = new ChatService({ store: deps.store, engine, model, persistence });
  return { deps, engine, chat, calls, puts, persistence };
}
const ask = async (h: ReturnType<typeof harness>, id: string, q: string) => { const r = await h.chat.ask(id, q); await h.chat.idle(id); return r; };
const last = (h: ReturnType<typeof harness>, id: string) => h.chat.history(id)!.messages.at(-1)!;

test("chat answers are scoped to the selected business and grounded: a verified quote is marked verified, invented sources and links are removed", async () => {
  const h = harness({ reply: () => JSON.stringify({ answer: "It runs mentorship [S1] and see https://evil.example/x and [S9].", citations: [{ sourceId: "S1", quote: "It runs a mentorship programme every semester" }, { sourceId: "S9", quote: "invented" }, { sourceId: "S1" }], confidence: "high" }) });
  const r = await ask(h, "a1", "What does Mesa do for students?");
  assert.equal(r.status, 202);
  const m = last(h, "a1");
  assert.equal(m.role, "assistant"); assert.equal(m.grounding, "cited");
  assert.equal(m.citations!.length, 1); assert.equal(m.citations![0].verified, true); assert.equal(m.citations![0].sourceId, "S1");
  assert.match(m.content, /\[link removed: not a known source\]/); assert.match(m.content, /\[source not found\]/);
  const sent = h.calls[0].messages.at(-1)!.content + h.calls[0].system;
  assert.match(sent, /Mesa UGBS/); assert.doesNotMatch(sent, /ZtouchStudio|wedding photography/, "another business's evidence never reaches the prompt");
  assert.match(h.calls[0].system, /ONE business: Mesa UGBS/);
  assert.equal(h.chat.history("b1")!.messages.length, 0, "the other business's conversation is untouched");
});

test("an unsupported quote is not marked verified, and an answer citing nothing is flagged uncited", () => {
  const d = harness().engine.get("a1")!;
  const bad = parseChatReply(JSON.stringify({ answer: "x", citations: [{ sourceId: "S1", quote: "it won a national award in 2024 ceremony" }] }), d);
  assert.equal(bad.citations![0].verified, false);
  assert.equal(parseChatReply(JSON.stringify({ answer: "just my view", citations: [] }), d).grounding, "uncited");
  assert.equal(parseChatReply("plain prose, not JSON", d).grounding, "unstructured");
});

test("follow-up questions keep the conversation context and the history is persisted and restored", async () => {
  const h = harness({ reply: (n) => JSON.stringify({ answer: `answer ${n}`, citations: [] }) });
  await ask(h, "a1", "First question about mentorship?");
  await ask(h, "a1", "And how would you compare that with a events-led plan?");
  const second = h.calls[1].messages;
  assert.ok(second.some((m) => m.role === "user" && /First question about mentorship/.test(m.content)));
  assert.ok(second.some((m) => m.role === "assistant" && /answer 1/.test(m.content)), "the previous answer is part of the context");
  const restored = new ChatService({ store: h.deps.store, engine: h.engine, model: undefined, persistence: h.persistence });
  assert.equal(await restored.hydrate(), 1);
  assert.equal(restored.history("a1")!.messages.length, 4);
  assert.equal(restored.history("b1")!.messages.length, 0);
});

test("when evidence is missing the model can request ONE bounded retrieval; only the business's own pages are fetched; new evidence is validated and used", async () => {
  const fetched: string[] = [];
  const h = harness({
    fetchDoc: (u) => { fetched.push(u); return u === "https://mesa.example/events" ? { ok: true, body: `<html><title>Mesa events</title><body>Mesa UGBS hosts an annual business summit for students at Legon, Accra. ${"Join the Mesa UGBS community. ".repeat(10)}</body></html>`, finalUrl: u } : { ok: false, reason: "http_404" }; },
    reply: (n, _s, content) => n === 1 ? JSON.stringify({ answer: "I cannot tell yet.", needsEvidence: { urls: ["https://mesa.example/events", "https://attacker.example/steal"], query: "" }, missing: ["events page"] })
      : JSON.stringify({ answer: "It hosts an annual business summit [S2].", citations: [{ sourceId: "S2", quote: "hosts an annual business summit for students" }], confidence: "medium" }),
  });
  await ask(h, "a1", "Does Mesa run an annual event?");
  assert.deepEqual(fetched, ["https://mesa.example/events"], "a URL outside the business's own site is never fetched");
  assert.equal(h.calls.length, 2, "exactly one retrieval round");
  assert.match(h.calls[1].messages.at(-1)!.content, /EVIDENCE JUST RETRIEVED/);
  const m = last(h, "a1");
  assert.equal(m.retrieved![0].read, true); assert.equal(m.retrieved![0].decision, "approved");
  assert.ok(m.retrievalNotes!.some((n) => /attacker\.example.*not fetched/.test(n)));
  assert.equal(m.citations![0].sourceId, "S2"); assert.equal(m.citations![0].verified, true);
});

test("insufficient evidence is stated, not papered over: retrieval that fails leaves the gaps listed", async () => {
  const h = harness({ reply: () => JSON.stringify({ answer: "The sources do not say.", needsEvidence: { urls: ["https://mesa.example/team"], query: "" }, missing: ["leadership names"] }) });
  await ask(h, "a1", "Who leads Mesa?");
  const m = last(h, "a1");
  assert.equal(m.status, "done"); assert.ok(m.missing!.some((x) => /leadership names/.test(x)));
  assert.ok(m.missing!.some((x) => /could not be read/.test(x)));
  assert.equal(h.calls.length, 1, "no second model call when nothing new was read");
});

test("proposals never act on their own: accepting creates an Approval Required mission, nothing runs, and external work stays flagged", async () => {
  const h = harness({ reply: () => JSON.stringify({ answer: "Here is a plan.", citations: [], proposals: [{ kind: "mission", title: "Contact the Dean's office about a partnership", description: "Draft an outreach email", assignedAI: "closer", external: true }, { kind: "plan", title: "Revised content calendar", description: "internal", assignedAI: "builder", external: false }] }) });
  await ask(h, "a1", "Prepare a plan and start outreach");
  const msg = last(h, "a1");
  assert.equal(msg.proposals!.length, 2); assert.ok(msg.proposals!.every((p) => p.status === "proposed"));
  assert.equal(h.deps.missionQueue.getSnapshot().length, 0, "asking and proposing created no mission");
  const r = await h.chat.decideProposal("a1", msg.id, msg.proposals![0].id, "accept");
  assert.equal(r.status, 200);
  const task = h.deps.missionQueue.getSnapshot()[0];
  assert.equal(task.approvalRequired, "Approval Required"); assert.match(task.description, /EXTERNAL ACTION[\s\S]*without the operator's explicit approval/);
  assert.notEqual(task.status, "Completed"); assert.equal(task.clientId, "a1");
  assert.equal((await h.chat.decideProposal("a1", msg.id, msg.proposals![0].id, "accept")).status, 409);
  assert.equal((await h.chat.decideProposal("a1", msg.id, msg.proposals![1].id, "decline")).status, 200);
  assert.equal(h.deps.missionQueue.getSnapshot().length, 1);
  assert.equal((await h.chat.decideProposal("b1", msg.id, msg.proposals![1].id, "accept")).status, 404, "a proposal cannot be accepted through another business");
});

test("input and availability errors are explicit and safe", async () => {
  const h = harness({ reply: () => ({ fail: true }) });
  assert.equal((await h.chat.ask("a1", "  ")).status, 400);
  assert.equal((await h.chat.ask("a1", "x".repeat(2001))).status, 400);
  assert.equal((await h.chat.ask("nope", "hi")).status, 404);
  assert.equal((await h.chat.ask("../etc", "hi")).status, 400);
  await ask(h, "a1", "Will this fail safely?");
  const m = last(h, "a1");
  assert.equal(m.status, "failed"); assert.doesNotMatch(JSON.stringify(m), /PROVIDER_UNAVAILABLE|stack|at /);
  const off = new ChatService({ store: h.deps.store, engine: h.engine, model: undefined });
  assert.equal((await off.ask("a1", "hi")).status, 503);
  const fresh = harness(); fresh.deps.store.businesses.set("c1", { id: "c1", canonicalName: "No Dossier" } as never);
  assert.equal((await fresh.chat.ask("c1", "hi")).status, 409);
});
