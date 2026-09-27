import { confidenceForSource, confidenceRank } from "../src/services/evidence/confidence";
import { fieldState, requiresHumanReview } from "../src/services/evidence/conflicts";
import { assessDuplicate } from "../src/services/evidence/business-deduplication";
import { freshnessOf, defaultFreshnessConfig } from "../src/services/evidence/freshness";
import type { BusinessIntelligence } from "../src/services/evidence/business-intelligence";
import type { EvidenceRecord } from "../src/services/evidence/evidence";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

// 1. Confidence mapping (incl. the fix for "unverified third-party" -> LOW)
check("client_provided -> VERIFIED", confidenceForSource("client_provided") === "VERIFIED");
check("other_permitted_source -> LOW", confidenceForSource("other_permitted_source") === "LOW");
check("confidenceRank orders VERIFIED above LOW", confidenceRank("VERIFIED") > confidenceRank("LOW"));

// 2. Observability states: not-observable vs conflicting vs present
const now = new Date().toISOString();
const ev = (value: unknown, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  evidenceId: `e-${Math.random()}`, businessId: "b1", field: "phone", value,
  sourceType: "official_website", observedAt: now, retrievedAt: now,
  evidenceType: "direct_observation", confidence: "HIGH", verificationStatus: "UNVERIFIED",
  collector: "human_scout", humanReviewRequired: false, observability: "OBSERVED_PRESENT",
  ...overrides,
});

check("no records -> NOT_OBSERVABLE", fieldState([]) === "NOT_OBSERVABLE");
check("single present value -> OBSERVED_PRESENT", fieldState([ev("024111")]) === "OBSERVED_PRESENT");
check("empty value -> OBSERVED_ABSENT", fieldState([ev("")]) === "OBSERVED_ABSENT");
check(
  "two conflicting phone numbers -> CONFLICTING",
  fieldState([ev("024111", { sourceType: "official_website" }), ev("055222", { sourceType: "directory" })]) === "CONFLICTING",
);
check(
  "conflicting field requires human review",
  requiresHumanReview([ev("024111"), ev("055222")]) === true,
);

// 3. Deduplication: same phone -> likely duplicate, human review required; unrelated -> no match
const base: BusinessIntelligence = {
  id: "biz-1", canonicalName: "Cedar & Salt Kitchen", aliases: [], categories: ["restaurant"],
  status: "ACTIVE", socialLinks: [], services: [], products: [], sourceReferences: [],
  evidenceReferences: [], createdAt: now, updatedAt: now, phone: "024-111-2222",
};
const dupeCandidate: BusinessIntelligence = { ...base, id: "biz-2", canonicalName: "Cedar and Salt" };
const unrelated: BusinessIntelligence = { ...base, id: "biz-3", canonicalName: "Volta Works", phone: "055-999-0000" };

const dupeResult = assessDuplicate(base, dupeCandidate);
check(
  "matching phone alone -> POSSIBLE_DUPLICATE, not an auto-merge (per 'do not merge on one weak signal')",
  dupeResult.status === "POSSIBLE_DUPLICATE",
);
check("duplicate assessment flags human review", dupeResult.humanReviewRequired === true);
check("unrelated businesses -> NO_MATCH", assessDuplicate(base, unrelated).status === "NO_MATCH");

const strongDupe: BusinessIntelligence = { ...base, id: "biz-4", canonicalName: "Cedar and Salt", website: "cedarandsalt.example" };
const baseWithWebsite: BusinessIntelligence = { ...base, website: "cedarandsalt.example" };
check(
  "phone + website match -> LIKELY_DUPLICATE",
  assessDuplicate(baseWithWebsite, strongDupe).status === "LIKELY_DUPLICATE",
);

// 4. Freshness: documented defaults exist and behave; unknown field stays "unknown" (no invented default)
const freshPhone = ev("024111", { field: "phone", observedAt: new Date().toISOString() });
check("recent phone evidence with default config -> fresh", freshnessOf(freshPhone) === "fresh");

const oldReview = ev("4.5 stars", { field: "reviews", observedAt: new Date(Date.now() - 90 * 86400000).toISOString() });
check("90-day-old review evidence -> stale (30-day default)", freshnessOf(oldReview) === "stale");

const unknownField = ev("x", { field: "totally_uncatalogued_field" });
check("field with no documented default -> unknown (not invented)", freshnessOf(unknownField) === "unknown");
check("defaultFreshnessConfig documents phone/reviews/website distinctly", defaultFreshnessConfig.phone !== defaultFreshnessConfig.reviews);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
