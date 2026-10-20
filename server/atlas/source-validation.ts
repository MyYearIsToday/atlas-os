import type { SourceRef } from "../../src/orchestrator/dossier-types";
import { hostOf, nameTokens, type BusinessFacts } from "./source-tools";

/**
 * Automatic, explainable validation of candidate sources, replacing the blocking operator approval step.
 *
 * "approved" here means ONLY: Atlas judged the source to be about this business (or this competitor) and may cite it in INTERNAL
 * work. It does not make anything verified. A claim is VERIFIED only through the evidence rule in dossier.ts (an approved source
 * whose FETCHED text contains the quoted passage). Every decision records who made it and why, so the operator can audit or override.
 */

export interface Verdict { decision: "approved" | "rejected" | "pending"; reason: string }

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const has = (reasons: string[] | undefined, needle: string) => (reasons ?? []).some((r) => r.includes(needle));

/** How much real text Atlas holds for a source. Social pages often yield only public meta tags or nothing. */
export type EvidenceLevel = "full_page" | "meta_only" | "snippet_only" | "none";
export function evidenceLevel(src: SourceRef): EvidenceLevel {
  if (src.check?.status === "fetched" && src.pageText) return src.check.reason?.startsWith("meta_only") ? "meta_only" : "full_page";
  return src.snippet ? "snippet_only" : "none";
}

export function decideBusinessSource(b: BusinessFacts, src: SourceRef): Verdict {
  const reasons = src.reasons ?? [];
  if (src.relevance === "unrelated") return { decision: "rejected", reason: reasons.join("; ") || "does not appear to be about this business" };
  if (src.relevance !== "match") return { decision: "pending", reason: `not used until confirmed: ${reasons[reasons.length - 1] ?? "identity not established"}` };
  const strong = has(reasons, "same domain") || has(reasons, "phone number");
  if (src.kind === "social" && !strong) {
    // A social profile must look like THIS business: its handle resembles the name, or its title/snippet carries the full name.
    const handle = norm((() => { try { return new URL(src.url).pathname.split("/").filter(Boolean)[0] ?? ""; } catch { return ""; } })()).replace(/ /g, "");
    const handleHit = nameTokens(b.name).some((t) => t.length >= 3 && handle.includes(t.replace(/ /g, "")));
    if (!handleHit && !has(reasons, "contains the full business name")) return { decision: "pending", reason: "social profile: the handle does not resemble the business name and nothing else confirms it is theirs" };
  }
  if (src.official) return { decision: "approved", reason: "same domain as the business's recorded website" };
  if (src.check?.status === "fetched") return { decision: "approved", reason: `page was read and matches the business (${reasons.slice(0, 3).join("; ")})` };
  return { decision: "approved", reason: `matched from the search result only (${reasons.slice(0, 2).join("; ")}); the page could not be read, so it is an unverified lead and nothing can be VERIFIED from it` };
}

// ------------------------------------------------------------------ identity ambiguity

const REGIONS: Record<string, string[]> = {
  "Greater Accra": ["accra", "tema", "legon", "east legon", "madina", "osu", "labadi", "spintex", "dansoman", "achimota", "kaneshie", "lapaz", "weija", "teshie", "nungua", "adenta", "cantonments", "dzorwulu", "airport"],
  Ashanti: ["kumasi", "obuasi", "ejisu", "konongo", "suame"],
  Western: ["takoradi", "sekondi", "tarkwa", "axim"],
  Northern: ["tamale", "yendi"],
  Central: ["cape coast", "elmina", "winneba", "kasoa"],
  Eastern: ["koforidua", "nsawam", "akosombo"],
  Bono: ["sunyani", "techiman", "berekum"],
  "Upper East": ["bolgatanga", "bawku"],
  Volta: ["hohoe", "keta", "aflao"],
};
const placesIn = (text: string) => { const p = ` ${norm(text)} `; const out = new Map<string, string>(); for (const [region, cities] of Object.entries(REGIONS)) for (const c of cities) if (p.includes(` ${c} `)) out.set(c, region); return out; };

export interface Ambiguity { ambiguous: boolean; detail?: string; here: string[]; elsewhere: string[] }

/**
 * Identity is ambiguous only when sources carrying the business's full name point to DIFFERENT places: at least one that fits the
 * recorded location and at least one that places the same name in another region, with no source anchored by the recorded
 * website or phone. A business simply having few or no sources is NOT ambiguity (research continues from the record).
 */
export function detectIdentityAmbiguity(b: BusinessFacts, sources: SourceRef[]): Ambiguity {
  const none: Ambiguity = { ambiguous: false, here: [], elsewhere: [] };
  const own = placesIn(b.address ?? "");
  if (!own.size) return none; // no recognisable recorded location: cannot tell, so do not pause
  const ownRegions = new Set(own.values());
  const named = sources.filter((s) => s.role !== "competitor" && s.relevance !== "unrelated" && s.kind !== "directory" && has(s.reasons, "contains the full business name"));
  if (sources.some((s) => s.role !== "competitor" && (has(s.reasons, "same domain") || has(s.reasons, "phone number")))) return none; // anchored by the operator's own record
  const here: string[] = []; const elsewhere: string[] = []; const elsewherePlaces = new Set<string>();
  for (const s of named) {
    const text = `${s.title} ${s.snippet} ${(s.pageText ?? "").slice(0, 3000)}`;
    const found = placesIn(text);
    const mentionsOwn = has(s.reasons, "mentions the business's location") || [...found.values()].some((r) => ownRegions.has(r));
    const other = [...found].filter(([, r]) => !ownRegions.has(r));
    if (mentionsOwn) here.push(s.id);
    else if (other.length) { elsewhere.push(s.id); other.forEach(([c]) => elsewherePlaces.add(c)); }
  }
  if (here.length && elsewhere.length) {
    const ownPlace = [...own.keys()][0];
    return { ambiguous: true, here, elsewhere, detail: `Sources with this business's name point to different places: ${here.join(", ")} fit ${ownPlace}, but ${elsewhere.join(", ")} place the same name in ${[...elsewherePlaces].join(", ")}. Confirm which one is yours (approve those that are, reject the rest), or add its official website or profile.` };
  }
  return { ...none, here, elsewhere };
}

// ------------------------------------------------------------------ competitors

const TOKEN_STOP = new Set(["services", "service", "company", "business", "ghana", "best", "shop", "store", "limited", "ltd"]);
export const industryTokens = (...labels: Array<string | null | undefined>) => [...new Set(labels.flatMap((l) => norm(l ?? "").split(" ")).filter((t) => t.length > 3 && !TOKEN_STOP.has(t)))];

export function decideCompetitorSource(tokens: string[], placeTokens: string[], src: SourceRef): Verdict {
  if (["directory", "article", "event", "review"].includes(src.kind ?? "")) return { decision: "rejected", reason: "an aggregator, listing or article, not a competitor's own page" };
  if (!tokens.length) return { decision: "rejected", reason: "the business's industry is unknown, so fit as a competitor cannot be judged" };
  const read = src.check?.status === "fetched";
  const text = ` ${norm(`${src.title} ${src.snippet} ${read ? src.pageText ?? "" : ""}`)} `;
  const hit = tokens.find((t) => text.includes(` ${t} `) || text.includes(` ${t}s `));
  if (!hit) return { decision: "rejected", reason: "no sign that it offers the same kind of service" };
  if (read) return { decision: "approved", reason: `page was read and it offers the same kind of service ("${hit}")` };
  const inPlace = placeTokens.some((p) => text.includes(` ${p} `)) || text.includes(" ghana ");
  return inPlace
    ? { decision: "approved", reason: `search result indicates the same kind of service ("${hit}") in the same area; the page could not be read, so everything about it stays an unverified lead` }
    : { decision: "rejected", reason: "the page could not be read and the search result does not place it in the same area" };
}

export const ownHostOf = (url?: string | null) => (url ? hostOf(url) : "");
