import assert from "node:assert/strict";
import test from "node:test";
import { buildManualCandidate, submitManualBusiness } from "./manual-entry";
import { normalizeSocial } from "./social-profiles";
import { InMemoryBusinessRepository } from "./business-repository";
import { assessDuplicate, websiteKey } from "../evidence/business-deduplication";
import { normalizeCandidate } from "./discovery-normalize";

const ok = (r: ReturnType<typeof normalizeSocial>) => { assert.ok(r.ok, JSON.stringify(r)); return (r as { ok: true; profile: { url: string } }).profile.url; };

test("social: URLs canonicalise, bare handles need an explicit platform, nothing is invented", () => {
  assert.equal(ok(normalizeSocial("https://instagram.com/mesa_ugbs?igsh=abc")), "https://www.instagram.com/mesa_ugbs/");
  assert.equal(ok(normalizeSocial("@mesa", "tiktok")), "https://www.tiktok.com/@mesa");
  assert.equal(ok(normalizeSocial("twitter.com/mesa")), "https://x.com/mesa");
  assert.equal(ok(normalizeSocial("https://www.linkedin.com/company/mesa-ugbs")), "https://www.linkedin.com/company/mesa-ugbs/");
  assert.equal(normalizeSocial("@mesa").ok, false, "bare handle without platform is rejected");
  assert.equal(normalizeSocial("mesa", "linkedin").ok, false, "bare LinkedIn handle is ambiguous");
  assert.equal(normalizeSocial("https://evil.example/mesa").ok, false);
  assert.equal(normalizeSocial("https://instagram.com/p/abc123").ok, false, "post URLs are not profiles");
  assert.equal(normalizeSocial("javascript:alert(1)").ok, false);
});

test("intake: only name and category are required; address is optional; bad email/goals are rejected", () => {
  const good = buildManualCandidate({ businessName: "Mesa UGBS", category: "restaurant" });
  assert.ok(good.valid);
  const empty = buildManualCandidate({} as never);
  assert.ok(!empty.valid && empty.errors.map((e) => e.field).sort().join() === "businessName,category");
  const bad = buildManualCandidate({ businessName: "A", category: "b", email: "nope", goals: ["world_domination"], social: "@x" });
  assert.ok(!bad.valid);
  if (!bad.valid) assert.deepEqual(bad.errors.map((e) => e.field).sort(), ["email", "goals", "social"]);
  const full = buildManualCandidate({ businessName: "Mesa", category: "cafe", city: "Legon", country: "Ghana", social: "mesa_ugbs", socialPlatform: "instagram", goals: ["pr", "pr", "lead_generation"], relationship: "prospect", contactName: "Ama", email: "ama@mesa.com" });
  assert.ok(full.valid);
  if (full.valid) { assert.deepEqual(full.candidate.socialLinks, ["https://www.instagram.com/mesa_ugbs/"]); assert.deepEqual(full.candidate.goals, ["pr", "lead_generation"]); assert.equal(full.candidate.address, undefined); }
});

test("dedupe: website variants and shared social profiles are recognised; shared hosts are not treated as a business website", () => {
  assert.equal(websiteKey("https://www.Mesa.com/"), websiteKey("mesa.com"));
  assert.equal(websiteKey("https://facebook.com/mesa"), null);
  const mk = (name: string, website?: string, socialLinks: string[] = []) => normalizeCandidate({ externalId: name, name, website, socialLinks, source: "manual" }, name, "t");
  assert.equal(assessDuplicate(mk("Mesa UGBS", "https://www.mesa.com/"), mk("Mesa UGBS", "mesa.com")).status, "LIKELY_DUPLICATE");
  assert.equal(assessDuplicate(mk("A", undefined, ["https://www.instagram.com/mesa/"]), mk("B", undefined, ["https://instagram.com/Mesa"])).status, "LIKELY_DUPLICATE");
  assert.equal(assessDuplicate(mk("A", "https://facebook.com/x"), mk("B", "https://facebook.com/x")).status, "NO_MATCH");
});

test("intake end-to-end: resubmitting with a website variant or the same profile merges instead of duplicating, keeping prior data", async () => {
  const repository = new InMemoryBusinessRepository();
  const dispatched: unknown[] = [];
  const deps = { repository, dispatch: async (_t: string, p: unknown) => { dispatched.push(p); } } as never;
  const first = await submitManualBusiness({ businessName: "Mesa UGBS", category: "restaurant", website: "https://www.mesa.com/", notes: "first note", goals: ["pr"] }, deps);
  assert.ok(first.ok && first.outcome.action === "CREATED");
  const second = await submitManualBusiness({ businessName: "Mesa UGBS", category: "restaurant", website: "mesa.com", social: "https://instagram.com/mesa_ugbs", notes: "second note", goals: ["lead_generation"], email: "a@mesa.com", city: "Legon" }, deps);
  assert.ok(second.ok && second.outcome.action === "UPDATED_EXISTING" && second.outcome.businessId === (first as { outcome: { businessId: string } }).outcome.businessId);
  assert.equal(repository.list().length, 1);
  const r = repository.list()[0];
  assert.deepEqual(r.socialLinks, ["https://www.instagram.com/mesa_ugbs/"]);
  assert.deepEqual(r.goals, ["pr", "lead_generation"]);
  assert.ok(r.notes?.includes("first note") && r.notes.includes("second note"));
  assert.equal(r.email, "a@mesa.com");
  const third = await submitManualBusiness({ businessName: "Totally Different Name", category: "cafe", social: "instagram.com/mesa_ugbs" }, deps);
  assert.ok(third.ok && third.outcome.action === "UPDATED_EXISTING", "same profile = same business");
  assert.equal(repository.list().length, 1);
});
