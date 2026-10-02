import { AtlasOrchestrator } from "../../orchestrator/orchestrator";
import { InMemoryBusinessRepository } from "./business-repository";
import { buildManualCandidate, submitManualBusiness, type ManualBusinessInput } from "./manual-entry";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const valid: ManualBusinessInput = { businessName: "  Golden Bean Café ", category: "catering.cafe", address: "12 Oxford St, Osu, Accra" };
const fresh = () => {
  const orchestrator = new AtlasOrchestrator();
  const repository = new InMemoryBusinessRepository();
  return { orchestrator, repository, deps: { repository, dispatch: (t: "BusinessDiscovered", p: any) => orchestrator.dispatch(t, p) } };
};
const discoveredLog = (o: AtlasOrchestrator) => o.log.all().filter((e) => e.event === "BusinessDiscovered");
const errorFields = (r: ReturnType<typeof buildManualCandidate>) => (r.valid ? [] : r.errors.map((e) => e.field));

// --- Validation ---
const ok = buildManualCandidate(valid);
check("valid input builds a manual discovery candidate", ok.valid && ok.candidate.name === "Golden Bean Café" && ok.candidate.source === "manual" && ok.candidate.category === "catering.cafe");
check("missing business name is rejected", errorFields(buildManualCandidate({ ...valid, businessName: "   " })).includes("businessName"));
check("missing category is rejected", errorFields(buildManualCandidate({ ...valid, category: "" })).includes("category"));
check("missing address is rejected", errorFields(buildManualCandidate({ ...valid, address: undefined as unknown as string })).includes("address"));
check("a wholly empty submission reports all three required fields", ["businessName", "category", "address"].every((f) => errorFields(buildManualCandidate({} as ManualBusinessInput)).includes(f as never)));

// --- Optional fields ---
const full = buildManualCandidate({ ...valid, latitude: "5.6037", longitude: -0.187, website: "goldenbean.com", phone: "+233 24 123 4567", source: "Facebook page", notes: "  Met the owner  " });
check("optional fields are normalized (coords, https website, phone, notes, source label)", full.valid && full.candidate.latitude === 5.6037 && full.candidate.longitude === -0.187 && full.candidate.website === "https://goldenbean.com/" && full.candidate.phone === "+233 24 123 4567" && full.candidate.notes === "Met the owner" && full.candidate.sourceMetadata?.name === "Facebook page");
const bare = buildManualCandidate({ ...valid, latitude: "", longitude: null, website: " ", phone: undefined, source: "", notes: "" });
check("blank optional fields are simply omitted", bare.valid && bare.candidate.latitude === undefined && bare.candidate.website === undefined && bare.candidate.phone === undefined && bare.candidate.notes === undefined && bare.candidate.sourceMetadata?.name === "Manual entry");
check("latitude without longitude is rejected", errorFields(buildManualCandidate({ ...valid, latitude: 5.6 })).includes("longitude"));
check("out-of-range or non-numeric coordinates are rejected", errorFields(buildManualCandidate({ ...valid, latitude: 91, longitude: 0 })).includes("latitude") && errorFields(buildManualCandidate({ ...valid, latitude: "abc", longitude: "1" })).includes("latitude"));
check("invalid website and phone are rejected", errorFields(buildManualCandidate({ ...valid, website: "javascript:alert(1)" })).includes("website") && errorFields(buildManualCandidate({ ...valid, phone: "call me" })).includes("phone"));
check("over-length fields are rejected", errorFields(buildManualCandidate({ ...valid, businessName: "x".repeat(201) })).includes("businessName"));

// --- Existing pipeline: normalize -> persist -> BusinessDiscovered ---
{
  const { orchestrator, repository, deps } = fresh();
  const result = await submitManualBusiness({ ...valid, latitude: 5.6, longitude: -0.19, website: "https://goldenbean.com", phone: "0241234567", notes: "n" }, deps);
  const record = result.ok ? repository.get(result.outcome.businessId) : undefined;
  check("manual entry is persisted via the existing repository and normalizer", result.ok && result.outcome.action === "CREATED" && repository.list().length === 1 && record?.canonicalName === "Golden Bean Café" && record.category === "catering.cafe" && record.address === "12 Oxford St, Osu, Accra");
  check("phone, website, notes and coordinates survive normalization", record?.phone === "0241234567" && record.website === "https://goldenbean.com/" && record.notes === "n" && record.latitude === 5.6);
  check("record is keyed to the manual source", record?.sourceReferences.join() === "manual" && repository.findByExternalKey("manual", (buildManualCandidate(valid) as { candidate: { externalId: string } }).candidate.externalId)?.id === record?.id);
  const log = discoveredLog(orchestrator);
  check("BusinessDiscovered is dispatched once and completes with SUCCESS", log.length === 1 && log[0].outcome === "SUCCESS" && result.ok && result.outcome.published);
}

// --- Existing dedupe ---
{
  const { orchestrator, repository, deps } = fresh();
  const first = await submitManualBusiness(valid, deps);
  const again = await submitManualBusiness({ ...valid, businessName: "golden  bean café", phone: "0241234567" }, deps);
  check("resubmitting the same business updates it via the external-key path (no duplicate record)", first.ok && again.ok && again.outcome.action === "UPDATED_EXISTING" && again.outcome.businessId === first.outcome.businessId && repository.list().length === 1);
  check("the update fills previously-missing fields without erasing known ones", repository.list()[0].phone === "0241234567" && repository.list()[0].address === "12 Oxford St, Osu, Accra");
  check("each submission dispatches BusinessDiscovered", discoveredLog(orchestrator).length === 2);
}
{
  // Same name + coordinates, different address wording: existing assessDuplicate scores POSSIBLE_DUPLICATE.
  const { orchestrator, repository, deps } = fresh();
  const base = { businessName: "Golden Bean Cafe", category: "catering.cafe", latitude: 5.6037, longitude: -0.187 };
  const first = await submitManualBusiness({ ...base, address: "12 Oxford St, Osu, Accra" }, deps);
  const possible = await submitManualBusiness({ ...base, address: "Oxford Street, Osu" }, deps);
  check("possible duplicate is created but flagged for review by the existing dedupe", first.ok && possible.ok && possible.outcome.action === "CREATED" && possible.outcome.duplicateStatus === "POSSIBLE_DUPLICATE" && repository.list().length === 2);
  const flagged = discoveredLog(orchestrator);
  check("flagged duplicate still dispatches BusinessDiscovered successfully", flagged.length === 2 && flagged.every((e) => e.outcome === "SUCCESS"));
}
{
  // Name + phone + coordinates: LIKELY_DUPLICATE -> merged into the existing record.
  const { repository, deps } = fresh();
  const base = { businessName: "Golden Bean Cafe", category: "catering.cafe", latitude: 5.6037, longitude: -0.187, phone: "0241234567" };
  const first = await submitManualBusiness({ ...base, address: "12 Oxford St, Osu, Accra" }, deps);
  const likely = await submitManualBusiness({ ...base, address: "Oxford Street, Osu" }, deps);
  check("likely duplicate is merged into the existing business by the existing dedupe", first.ok && likely.ok && likely.outcome.action === "UPDATED_EXISTING" && likely.outcome.businessId === first.outcome.businessId && likely.outcome.duplicateStatus === "HUMAN_REVIEW" && repository.list().length === 1);
}

// --- Rejected input never touches the pipeline ---
{
  const { orchestrator, repository, deps } = fresh();
  const result = await submitManualBusiness({ ...valid, category: "" }, deps);
  check("invalid input is rejected before persistence or dispatch", !result.ok && repository.list().length === 0 && orchestrator.log.all().length === 0);
}

console.log(failures === 0 ? "\nALL MANUAL ENTRY SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
