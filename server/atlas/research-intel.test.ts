import test from "node:test";
import assert from "node:assert/strict";
import { classifySource, extractImages, normalizeUrl, quoteSupported, safeFetch, scoreRelevance } from "./source-tools";
import { withWorkforceRouting, WorkforceProvider } from "../workforce/workforce-provider";
import { MISSION_TASK_TYPE } from "../../src/orchestrator/autonomous-workforce";
import { defaultWorkforceConfig } from "../../src/workforce/workforce-config";
import { selectProvider } from "../../src/workforce/model-router";
import { ProviderRegistry } from "../../src/workforce/provider-registry";
import { createPipelineDeps } from "../../src/orchestrator/atlas-pipeline";
import { readMissionResult } from "./scout-actions";

const volta = { name: "Volta Residencies", address: "Dzigbe Street, Ho, Ghana", website: "https://voltaresidencies.com", phone: "+233 24 111 2222" };

test("relevance separates the business from namesakes, parents and unrelated results (no hardcoded business)", () => {
  assert.equal(scoreRelevance(volta, { url: "https://voltaresidencies.com/rooms", title: "Rooms" }).relevance, "match", "own domain");
  assert.equal(scoreRelevance(volta, { url: "https://x.com/a", title: "Volta Residencies, Ho", snippet: "Guest house on Dzigbe Street, Ho" }).relevance, "match", "name + location");
  const nameOnly = scoreRelevance(volta, { url: "https://x.com/b", title: "Volta Residencies", snippet: "student housing" });
  assert.equal(nameOnly.relevance, "possible");
  assert.match(nameOnly.reasons.join(" "), /parent organisation|similarly named/);
  assert.equal(scoreRelevance(volta, { url: "https://news.com/volta-river-authority", title: "Volta River Authority tariffs", snippet: "electricity" }).relevance, "unrelated");
  assert.equal(scoreRelevance({ name: "MESA-UGBS", address: "Legon" }, { url: "https://a.com", title: "Mesa Verde National Park" }).relevance, "unrelated", "one shared word is not a match");
  assert.equal(scoreRelevance(volta, { url: "https://y.com", title: "Contact", pageText: "Call us on 024 111 2222" }).relevance, "match", "phone on page");
});

test("classification, URL normalisation and quote checks", () => {
  assert.equal(classifySource("https://www.facebook.com/x"), "social");
  assert.equal(classifySource("https://voltaresidencies.com/a", "https://www.voltaresidencies.com"), "official_site");
  assert.equal(classifySource("https://www.eventbrite.com/e/1"), "event");
  assert.equal(normalizeUrl("https://www.Site.com/a/?utm_source=x&b=1#top"), normalizeUrl("http://site.com/a?b=1"));
  assert.equal(quoteSupported("guest house in the heart of ho", "A Guest House in the heart of Ho, Ghana"), true);
  assert.equal(quoteSupported("short", "short quote here"), false);
  assert.equal(quoteSupported("guest house in the heart of ho", undefined), false);
});

test("image candidates come from the page itself (og/icon/logo), resolved to absolute URLs, no svg/data/ico", () => {
  const html = '<meta property="og:image" content="/img/og.jpg"><link rel="apple-touch-icon" href="touch.png"><link rel="icon" href="/f.ico"><img src="data:image/png;base64,AA" class="logo"><img class="site-logo" src="https://cdn.x.com/l.png"><img src="/p.svg" alt="logo">';
  const out = extractImages(html, "https://a.com/page/");
  assert.deepEqual(out.map((i) => i.url), ["https://a.com/img/og.jpg", "https://a.com/page/touch.png", "https://cdn.x.com/l.png"]);
});

test("safeFetch refuses local/private targets and non-http schemes", async () => {
  for (const u of ["http://127.0.0.1/", "http://localhost:8080/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "file:///etc/passwd", "http://user:pw@example.com/"]) assert.equal((await safeFetch(u)).ok, false, u);
});

test("model routing: Workforce goes first for every role except finance; fallbacks kept; strongest employee for synthesis stages", () => {
  const cfg = withWorkforceRouting(defaultWorkforceConfig, true);
  assert.deepEqual(cfg.workerProviderMap.analyst, ["workforce", "openrouter", "nvidia"]);
  assert.deepEqual(cfg.workerProviderMap.finance, ["openrouter"]);
  assert.equal(withWorkforceRouting(defaultWorkforceConfig, false), defaultWorkforceConfig, "unchanged when the Workforce is not available");
  const reg = new ProviderRegistry();
  for (const id of ["workforce", "openrouter", "nvidia"]) reg.registerProvider({ id } as never);
  assert.equal(selectProvider({ workerRole: "planner" } as never, reg, cfg)?.providerId, "workforce");
  assert.equal(selectProvider({ workerRole: "planner" } as never, reg, defaultWorkforceConfig)?.providerId, "openrouter", "previous behaviour: plain openrouter + llama default");
  assert.equal(selectProvider({ workerRole: "planner" } as never, reg, cfg, 1)?.providerId, "openrouter", "fallback tier preserved");
  const wf = WorkforceProvider.create({});
  const employee = (missionType: string, workerRole: string) => (wf.resolveEmployee({ workerRole, taskType: MISSION_TASK_TYPE[missionType] } as never) as { employee: string }).employee;
  assert.equal(employee("dossier_profile", "researcher"), "scout");
  assert.equal(employee("dossier_audit", "analyst"), "business_analyst");
  for (const t of ["dossier_swot", "dossier_growth", "dossier_plan"]) assert.equal(employee(t, "planner"), "ceo_master_planner");
});

test("mission result: honest outcome for completed, empty, failed, pending; separates results from approval", async () => {
  const deps = createPipelineDeps({});
  const mk = (title: string, status: string, approvalRequired = "Auto") => deps.missionQueue.create({ title, description: "Scope: look at X", assignedAI: "scout", clientId: "b1", priority: "Medium", approvalRequired: approvalRequired as never, missionType: "dossier_followup", dueDate: "2026-10-17", estimatedCost: 0, estimatedTime: "u" }).then(async (t) => { await deps.missionQueue.update(t.taskId, { status: status as never }); return t.taskId; });
  const done = await mk("done", "Completed"); deps.store.missionOutputs.set(done, { generatedBy: "nvidia/x via workforce:scout", text: "Findings...", isEvidence: false });
  const empty = await mk("empty", "Completed"); const failed = await mk("failed", "Failed"); const pending = await mk("pending", "Pending", "Approval Required");
  const r = (id: string) => readMissionResult(deps as never, id)!;
  assert.equal(r(done).outcome, "result"); assert.equal(r(done).output?.generatedBy, "nvidia/x via workforce:scout"); assert.equal(r(done).output?.isEvidence, false);
  assert.equal(r(empty).outcome, "completed_without_output"); assert.equal(r(empty).output, null);
  assert.equal(r(failed).outcome, "failed");
  assert.equal(r(pending).outcome, "not_run"); assert.match(r(pending).scope, /Scope: look at X/);
  assert.equal(readMissionResult(deps as never, "nope"), null);
});
