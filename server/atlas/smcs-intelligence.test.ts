import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDirections, handleSmcsIntelligenceRequest, parseBrief, principlesFromModel, retrieveReferences, type ModelResult } from "./smcs-intelligence";
import type { CampaignReference } from "./smcs-library";
import type { AtlasPersistence, Collection } from "../../src/services/persistence/atlas-persistence";

function fakePersistence() {
  const docs = new Map<string, unknown>();
  const p = {
    put(c: Collection, id: string, doc: unknown) { docs.set(`${c}/${id}`, JSON.parse(JSON.stringify(doc))); },
    remove() {},
    async loadAll(c: Collection) { return [...docs.entries()].filter(([k]) => k.startsWith(`${c}/`)).map(([k, doc]) => ({ id: k.split("/").slice(1).join("/"), doc })); },
    async flush() {},
    health() { return { ok: true, failedWrites: 0, lastError: null, pendingWrites: 0 }; },
  } as unknown as AtlasPersistence;
  return { p, docs };
}
const ref = (extra: Partial<CampaignReference>): CampaignReference => ({
  id: "cr_1", version: 1, title: "Campus launch", brand: "Other", reviewStatus: "approved", licenseStatus: "unknown",
  tags: [], duplicateIndicators: [], createdAt: "", updatedAt: "", industry: "education", platform: "instagram",
  objective: "enrolment", audience: "students", hook: "A different school's line", concept: "Open day story", ...extra,
});
const briefInput = { brandName: "Mesa UGBS", objective: "enrolment", audience: "students in Accra", platform: "instagram", desiredAction: "book an open day", positioning: "practical business school", evidence: ["Open day is on 2 May"] };

test("brief keeps supplied facts, fills only blanks from a brand snapshot, and lists what is missing", () => {
  const bare = parseBrief({ brandName: "Mesa", objective: "awareness" }, "2026-10-23T00:00:00Z");
  assert.ok(bare.missingInformation.includes("no evidence was supplied"));
  assert.equal(bare.brandSource, "brief_only");
  const filled = parseBrief({ brandName: "Mesa", objective: "awareness", positioning: "ours", brand: { notes: "theirs", category: "education", country: "Ghana" } }, "2026-10-23T00:00:00Z");
  assert.equal(filled.positioning, "ours");
  assert.equal(filled.industry, "education");
  assert.equal(filled.country, "Ghana");
  assert.equal(filled.brandSource, "supplied_brand");
});

test("retrieval uses approved references only and ignores performance", () => {
  const rows = [
    ref({ id: "match", title: "Open day film", hook: "Show the classroom" }),
    ref({ id: "roi", title: "Unrelated stunt", industry: "finance", platform: "tiktok", objective: "app installs", audience: "traders", hook: "Rates moved", concept: "Market tick", performance: { roi: { value: 99, source: "ad", verification: "source_stated" } } }),
    ref({ id: "draft", title: "Open day film", reviewStatus: "candidate", hook: "Show the classroom", concept: "Open day story", objective: "enrolment" }),
    ref({ id: "dup", title: "Open day film", sourceUrl: "https://example.com/a", hook: "Show the classroom" }),
    ref({ id: "same-brand-3", brand: "Other", title: "Third enrolment post", hook: "Another class" }),
  ];
  rows[0].sourceUrl = "https://example.com/a";
  const brief = parseBrief({ ...briefInput, industry: "education" }, "t");
  const result = retrieveReferences(rows, brief, 5);
  assert.ok(result.references.every((r) => r.id !== "draft" && r.id !== "roi"));
  assert.ok(result.references.some((r) => r.id === "match" || r.id === "dup"));
  assert.ok(result.references.some((r) => r.reasons.includes("industry_match")));
  assert.ok(result.collapsed.some((c) => c.id === "dup" || c.id === "match"));
  assert.equal(result.references.filter((r) => r.brand === "Other").length <= 2, true);
});

test("principles must cite an allowed source; copied source lines are dropped", () => {
  const parsed = principlesFromModel(`note {"principles":[
    {"statement":"Show the ordinary day, not the logo","kind":"demonstrated","sourceIds":["cr_1","nope"],"attribution":"the concept describes an open day"},
    {"statement":"Guess a conversion rate","kind":"hypothesis","sourceIds":["missing"]}
  ]}`, ["cr_1"]);
  assert.equal(parsed.principles.length, 1);
  assert.deepEqual(parsed.principles[0].sourceIds, ["cr_1"]);
  assert.equal(parsed.discarded, 1);
  assert.throws(() => principlesFromModel("not json", ["cr_1"]), /JSON|object/);
});

test("feedback is stored for later analysis and concepts stay unpublished drafts", async () => {
  const { p, docs } = fakePersistence();
  docs.set("smcs_campaign_reference/match", ref({ id: "match" }));
  const model = async (prompt: string): Promise<ModelResult> => {
    if (prompt.includes("transferable creative principles")) return { ok: true, provider: "openrouter", model: "test", text: JSON.stringify({ principles: [{ statement: "Show a real school day", kind: "demonstrated", sourceIds: ["match"], attribution: "concept" }] }) };
    return { ok: true, provider: "openrouter", model: "test", text: JSON.stringify({ directions: [
      { strategicIdea: "Mesa open-day diary", rationale: "fits enrolment", audienceInsight: "students want to see the room", message: "Come see a class", hook: "Spend a morning at Mesa", narrative: "One student walks through a Wednesday", formats: ["reel"], platformAdaptations: ["instagram"], cta: "Book the day", intendedAction: "book an open day", principleIds: ["pr_1"], assumptions: ["open day date is real"], limitations: ["no proof this format will enrol anyone"], claimsRequiringVerification: ["Open day is on 2 May"] },
      { strategicIdea: "Alumni workplace visit", rationale: "a second route to enrolment", audienceInsight: "students ask where the degree leads", message: "See the work", hook: "Follow a graduate into Tuesday", narrative: "A different story from the diary", formats: ["carousel"], platformAdaptations: ["instagram"], cta: "Ask for a visit", intendedAction: "request a visit", principleIds: ["pr_1"], assumptions: [], limitations: [], claimsRequiringVerification: [] },
    ] }) };
  };
  const created = await handleSmcsIntelligenceRequest("POST", "/api/smcs/concepts", new URLSearchParams(), async () => ({ brief: briefInput }), { persistence: p, secretConfigured: true, model });
  assert.equal(created.status, 201);
  const body = created.body as { id: string; published: boolean; directions: Array<{ sourceIds: string[] }>; evaluation: Array<{ advisory: boolean; notAMeasurement: boolean }> };
  assert.equal(body.published, false);
  assert.deepEqual(body.directions[0].sourceIds, ["match"]);
  assert.equal(body.evaluation[0].advisory, true);
  assert.equal(body.evaluation[0].notAMeasurement, true);
  const saved = await handleSmcsIntelligenceRequest("POST", "/api/smcs/feedback", new URLSearchParams(), async () => ({ action: "rejected", reason: "too close to a campus tour", generationId: body.id, conceptId: "dir_1", actor: "Kofi" }), { persistence: p, secretConfigured: true, model });
  assert.equal(saved.status, 201);
  assert.equal((saved.body as { published: boolean }).published, false);
  const listed = await handleSmcsIntelligenceRequest("GET", "/api/smcs/feedback", new URLSearchParams("briefId="), async () => ({}), { persistence: p, secretConfigured: true, model });
  assert.equal((listed.body as { items: unknown[]; learningClaim: string }).items.length >= 1, true);
  assert.match((listed.body as { learningClaim: string }).learningClaim, /not a predictive model/);
  const closed = await handleSmcsIntelligenceRequest("POST", "/api/smcs/concepts", new URLSearchParams(), async () => ({ brief: briefInput }), { persistence: null, secretConfigured: true, model });
  assert.equal(closed.status, 503);
});

test("evaluation is advisory and flags a missing audience", () => {
  const brief = parseBrief({ brandName: "Mesa", objective: "enrolment" }, "t");
  const [ev] = evaluateDirections(brief, [{ id: "dir_1", strategicIdea: "Mesa diary", rationale: "", audienceInsight: "", message: "enrolment", hook: "Come in", narrative: "", formats: ["reel"], platformAdaptations: [], cta: "Book", intendedAction: "", principleIds: [], sourceIds: [], assumptions: [], limitations: [], claimsRequiringVerification: [] }], []);
  assert.equal(ev.advisory, true);
  assert.equal(ev.checks.audienceRelevance.score, 2);
  assert.equal(ev.similarityRisk, "high");
});
