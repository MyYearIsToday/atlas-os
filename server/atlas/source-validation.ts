import type { SourceRef } from "../../src/orchestrator/dossier-types";
import { hostOf, nameTokens, type BusinessFacts } from "./source-tools";
import { extractContacts } from "./site-inspection";

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

const CC_SLD = new Set(["com", "co", "org", "net", "gov", "edu", "ac"]);
const sld = (host: string) => { const p = host.split("."); const labels = p.length >= 3 && CC_SLD.has(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(0, -2) : p.slice(0, -1); return (labels[labels.length - 1] ?? "").replace(/[^a-z0-9]/g, ""); };
const edit = (a: string, b: string) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };

/**
 * A domain that resembles the business's recorded website (same name on another TLD, one letter different, hyphenated) but is NOT
 * that website or one of its subdomains. Returns the candidate's host, or null. Such a page may belong to someone else entirely.
 */
export function lookalikeDomain(ownWebsite: string | null | undefined, candidateUrl: string): string | null {
  const own = ownWebsite ? hostOf(ownWebsite) : "", cand = hostOf(candidateUrl);
  if (!own || !cand || cand === own || cand.endsWith(`.${own}`) || own.endsWith(`.${cand}`)) return null;
  const a = sld(own), b = sld(cand);
  if (a.length < 5 || b.length < 5) return null;
  return a === b || edit(a, b) <= (a.length >= 9 ? 2 : 1) ? cand : null;
}

/** Acronym-style words (UGBS) in a name usually name a parent or host institution; the remaining words name this entity. */
export function parentGuard(name: string): { parents: string[]; distinct: string[] } {
  const words = name.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  const parents = words.filter((w) => w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (!parents.length || parents.length >= words.length) return { parents: [], distinct: [] };
  const lower = parents.map((p) => p.toLowerCase());
  return { parents, distinct: nameTokens(name).filter((t) => !lower.includes(t)) };
}

export interface ContactConflict { sourceId: string; detail: string }
/** Official-site contact details that no other full-name source shares are a conflict, not a corroboration. */
export function findContactConflicts(official: { phones: string[]; emails: string[] }, sources: SourceRef[]): ContactConflict[] {
  const digits = (p: string) => p.replace(/\D/g, "").slice(-9);
  const ownPhones = new Set(official.phones.map(digits)); const ownEmails = new Set(official.emails.map((e) => e.toLowerCase()));
  const out: ContactConflict[] = [];
  for (const s of sources) {
    if (s.role === "competitor" || s.official || s.decidedBy === "operator" || !s.pageText || !(s.reasons ?? []).some((r) => r.includes("full business name"))) continue;
    const c = extractContacts("", s.pageText);
    const phoneClash = ownPhones.size > 0 && c.phones.length > 0 && !c.phones.some((p) => ownPhones.has(digits(p)));
    const mailClash = ownEmails.size > 0 && c.emails.length > 0 && !c.emails.some((e) => ownEmails.has(e));
    if (phoneClash || mailClash) out.push({ sourceId: s.id, detail: `${phoneClash ? `phone ${c.phones[0]}` : `email ${c.emails[0]}`} differs from the official site's ${phoneClash ? `phone ${official.phones[0]}` : `email ${official.emails[0]}`}` });
  }
  return out;
}

export function decideBusinessSource(b: BusinessFacts, src: SourceRef): Verdict {
  const reasons = src.reasons ?? [];
  const lk = !src.official && src.kind !== "social" ? lookalikeDomain(b.website, src.url) : null;
  if (lk) return { decision: "pending", reason: `look-alike domain: ${lk} resembles the recorded website but is a different domain; not used until the operator confirms it is the same business` };
  if (src.relevance === "unrelated") return { decision: "rejected", reason: reasons.join("; ") || "does not appear to be about this business" };
  if (src.relevance !== "match") return { decision: "pending", reason: `not used until confirmed: ${reasons[reasons.length - 1] ?? "identity not established"}` };
  const strong = has(reasons, "same domain") || has(reasons, "phone number") || has(reasons, "linked from the official website");
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
