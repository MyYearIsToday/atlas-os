import { lookup } from "node:dns/promises";
import { websiteKey } from "../../src/services/evidence/business-deduplication";
import { isIP } from "node:net";

/**
 * Source discovery helpers for the dossier: classification, entity-relevance matching, URL dedupe, bounded safe page
 * fetching, image-candidate extraction and quote checking. Nothing here contacts the business or posts anything; it only
 * reads public pages the operator can also open. Relevance is a heuristic that only SUGGESTS; the operator decides.
 */

export type SourceKind = "official_site" | "social" | "directory" | "article" | "event" | "review" | "other";
export type Relevance = "match" | "possible" | "unrelated";

const SOCIAL = ["facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com", "threads.net", "whatsapp.com", "wa.me", "t.me"];
const DIRECTORY = ["yellowpages", "ghanayello", "ghanabusinesses", "cylex", "yelp.com", "foursquare.com", "tripadvisor", "google.com/maps", "maps.google", "bing.com/maps", "mapquest", "dnb.com", "opencorporates", "africabizinfo", "businesslist", "hotfrog", "pages.ghana"];
const REVIEW = ["trustpilot", "reviews", "glassdoor", "tripadvisor", "yelp.com"];
const EVENT = ["eventbrite", "meetup.com", "allevents", "tickets", "ticketing"];
const NEWS = ["news", "blog", "article", "press", "times", "post", "daily", "graphic.com.gh", "myjoyonline", "citinewsroom", "medium.com", "wikipedia.org"];

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igshid|ref$|mc_)/i.test(k)) u.searchParams.delete(k);
    const path = u.pathname.replace(/\/+$/, "") || "";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${u.search}`;
  } catch { return url.trim().toLowerCase(); }
}

export function classifySource(url: string, businessWebsite?: string | null): SourceKind {
  const host = hostOf(url); const full = `${host}${(() => { try { return new URL(url).pathname; } catch { return ""; } })()}`.toLowerCase();
  const own = businessWebsite ? hostOf(businessWebsite) : "";
  if (own && host === own) return "official_site";
  if (SOCIAL.some((d) => host === d || host.endsWith(`.${d}`))) return "social";
  if (EVENT.some((d) => full.includes(d))) return "event";
  if (REVIEW.some((d) => full.includes(d))) return "review";
  if (DIRECTORY.some((d) => full.includes(d))) return "directory";
  if (NEWS.some((d) => full.includes(d))) return "article";
  return "other";
}

const STOP = new Set(["the", "and", "of", "ltd", "limited", "llc", "inc", "co", "company", "ghana", "gh", "&", "for", "in", "at"]);
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const nameTokens = (name: string) => norm(name).split(" ").filter((t) => t.length > 1 && !STOP.has(t));

export interface BusinessFacts { name: string; address?: string | null; website?: string | null; phone?: string | null; category?: string | null }
export interface SourceText { url: string; title?: string; snippet?: string; pageText?: string }

const GENERIC_PLACE = new Set(["ghana", "accra", "greater", "region", "road", "street", "close", "avenue", "near", "opposite", "east", "west", "north", "south", "off", "box", "p.o", "po"]);
const placeTokens = (address?: string | null) => norm(address ?? "").split(" ").filter((t) => t.length > 3 && !GENERIC_PLACE.has(t) && !/^\d+$/.test(t));

export function scoreRelevance(b: BusinessFacts, s: SourceText): { relevance: Relevance; reasons: string[] } {
  const reasons: string[] = [];
  const haystack = norm(`${s.title ?? ""} ${s.snippet ?? ""} ${s.url} ${(s.pageText ?? "").slice(0, 6000)}`);
  const padded = ` ${haystack} `;
  const tokens = nameTokens(b.name);
  const phrase = norm(b.name);
  const phraseHit = phrase.length > 2 && padded.includes(` ${phrase} `);
  const tokenHits = tokens.filter((t) => padded.includes(` ${t} `) || padded.includes(t)).length;
  const allTokens = tokens.length > 0 && tokenHits === tokens.length;
  const ownHost = b.website ? hostOf(b.website) : "";
  const domainMatch = !!ownHost && hostOf(s.url) === ownHost;
  const digits = (b.phone ?? "").replace(/\D/g, "").slice(-9);
  const phoneHit = digits.length >= 9 && (s.pageText ?? `${s.snippet ?? ""}`).replace(/\D/g, "").includes(digits);
  const places = placeTokens(b.address).filter((p) => !tokens.includes(p)); // a place word that is also part of the name proves nothing
  const placeHit = places.some((p) => padded.includes(` ${p} `));

  if (domainMatch) reasons.push("same domain as the business's recorded website");
  if (phoneHit) reasons.push("shows the business's phone number");
  if (phraseHit) reasons.push("contains the full business name");
  else if (allTokens) reasons.push("contains every word of the business name (not as one phrase)");
  else if (tokenHits) reasons.push(`contains only ${tokenHits} of ${tokens.length} name words`);
  if (placeHit) reasons.push("mentions the business's location");

  if (domainMatch || phoneHit) return { relevance: "match", reasons };
  // A parent or host institution (an acronym in the name, e.g. UGBS) is not this entity: text about it alone proves nothing.
  const acr = b.name.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter((w) => w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (acr.length && acr.length < b.name.split(/\s+/).filter(Boolean).length) {
    const distinct = tokens.filter((t) => !acr.some((a) => a.toLowerCase() === t));
    const mentionsParent = acr.some((a) => padded.includes(` ${a.toLowerCase()} `));
    if (mentionsParent && distinct.length && !distinct.some((t) => padded.includes(` ${t} `))) { reasons.push(`about the parent or host organisation (${acr.join(", ")}), not this entity`); return { relevance: "unrelated", reasons }; }
  }
  if (!tokens.length || !tokenHits) { reasons.push("does not mention the business name: likely a different organisation"); return { relevance: "unrelated", reasons }; }
  if ((phraseHit || allTokens) && placeHit) return { relevance: "match", reasons };
  if (phraseHit || allTokens) { reasons.push("name matches but nothing confirms the location, domain or contact: it may be a parent organisation, department or similarly named business"); return { relevance: "possible", reasons }; }
  if (tokenHits >= 2 && tokenHits / tokens.length >= 0.6) { reasons.push("partial name match only"); return { relevance: "possible", reasons }; }
  reasons.push("weak name match");
  return { relevance: "unrelated", reasons };
}

// ---------------------------------------------------------------- bounded, SSRF-safe fetching

export interface FetchedDoc { ok: boolean; status?: number; contentType?: string; body?: string; bytes?: Uint8Array; finalUrl?: string; reason?: string }
export type FetchDoc = (url: string, opts?: { binary?: boolean; maxBytes?: number }) => Promise<FetchedDoc>;

function privateAddress(addr: string): boolean {
  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = addr.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
}

async function hostAllowed(host: string): Promise<boolean> {
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isIP(host)) return !privateAddress(host);
  try { const all = await lookup(host, { all: true }); return all.length > 0 && all.every((a) => !privateAddress(a.address)); } catch { return false; }
}

/** GET only, http(s) only, public hosts only (re-checked on each redirect), 8 s timeout, size capped. Never sends cookies/credentials. */
export const safeFetch: FetchDoc = async (url, opts = {}) => {
  const maxBytes = opts.maxBytes ?? (opts.binary ? 1_500_000 : 400_000);
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { return { ok: false, reason: "invalid_url" }; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false, reason: "unsupported_url" };
    if (!(await hostAllowed(u.hostname))) return { ok: false, reason: "host_not_allowed" };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8_000);
    try {
      const res = await fetch(u, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "AtlasOS-research/1.0 (+read-only)", accept: opts.binary ? "image/*" : "text/html,text/plain;q=0.9" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location")!, u).toString(); continue; }
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!res.ok) return { ok: false, status: res.status, reason: `http_${res.status}` };
      if (opts.binary ? !/^image\/(jpeg|png|webp)/.test(contentType) : !/(text\/html|text\/plain|application\/xhtml)/.test(contentType)) return { ok: false, status: res.status, contentType, reason: "unsupported_content_type" };
      const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) { void reader.cancel(); if (opts.binary) return { ok: false, status: res.status, contentType, reason: "too_large" }; break; } chunks.push(value); }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return opts.binary ? { ok: true, status: res.status, contentType, bytes: new Uint8Array(buf), finalUrl: u.toString() } : { ok: true, status: res.status, contentType, body: buf.toString("utf8"), finalUrl: u.toString() };
    } catch (e) { return { ok: false, reason: (e as Error).name === "AbortError" ? "timeout" : "network_error" }; }
    finally { clearTimeout(timer); }
  }
  return { ok: false, reason: "too_many_redirects" };
};

// ---------------------------------------------------------------- HTML helpers

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&apos;": "'" };
export function htmlToText(html: string): string {
  return html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (m) => ENT[m] ?? " ").replace(/\s+/g, " ").trim();
}
/** Public description meta tags (og:title, og:description, description, twitter:description). Social profiles often expose a bio here even behind a login wall. */
export function htmlMeta(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !["og:title", "og:description", "description", "twitter:title", "twitter:description"].includes(key)) continue;
    const content = /content\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /content\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    if (!content) continue;
    const text = content.replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (e) => ENT[e] ?? " ").replace(/\s+/g, " ").trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out.join(" | ");
}
export const htmlTitle = (html: string) => (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

export interface ImageCandidate { url: string; role: "og_image" | "icon" | "logo" | "page_image" }
export function extractImages(html: string, baseUrl: string, max = 6): ImageCandidate[] {
  const out: ImageCandidate[] = []; const seen = new Set<string>();
  const add = (raw: string | undefined, role: ImageCandidate["role"]) => {
    if (!raw || out.length >= max) return;
    try {
      const u = new URL(raw.replace(/&amp;/g, "&"), baseUrl);
      if (!/^https?:$/.test(u.protocol) || /\.(svg|ico|gif)(\?|$)/i.test(u.pathname) || /^data:/i.test(raw)) return;
      const key = normalizeUrl(u.toString()); if (seen.has(key)) return; seen.add(key);
      out.push({ url: u.toString(), role });
    } catch { /* ignore malformed */ }
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi)) add(/content=["']([^"']+)["']/i.exec(m[0])?.[1], "og_image");
  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*>/gi)) add(/href=["']([^"']+)["']/i.exec(m[0])?.[1], "icon");
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(tag)?.[1];
  const best = (tag: string) => { const ss = attr(tag, "srcset") ?? attr(tag, "data-srcset"); const pick = ss ? ss.split(",").map((p) => p.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseInt(w ?? "0", 10) || 0 })).sort((a, b) => b.w - a.w)[0]?.u : undefined; return pick ?? attr(tag, "data-src") ?? attr(tag, "data-lazy-src") ?? attr(tag, "src"); };
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) { if (/logo|brand/i.test(m[0])) add(best(m[0]), "logo"); }
  // Other page images that look like storefront / product / menu / promotion material. Tiny images, sprites and tracking pixels are skipped.
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]; if (/logo|brand/i.test(tag)) continue;
    const w = Number(attr(tag, "width")), h = Number(attr(tag, "height"));
    if ((w && w < 120) || (h && h < 120) || /sprite|pixel|tracking|spacer|avatar|emoji|icon|arrow|loader|blank/i.test(tag)) continue;
    if (/menu|product|shop|store|storefront|gallery|promo|banner|offer|hero|dish|food|service|about|team|outlet|branch/i.test(tag)) add(best(tag), "page_image");
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A claim may be VERIFIED only if its quoted evidence really appears in fetched page text. Short quotes never count. */
export function quoteSupported(quote: string | undefined, pageText: string | undefined): boolean {
  if (!quote || !pageText) return false;
  const q = squash(quote);
  return q.length >= 20 && squash(pageText).includes(q);
}

/** True only when the URL's parsed hostname is the business website's hostname (ignoring a leading www) or a subdomain of it. http(s) only. */
export function isOwnSiteHost(website: string | null | undefined, candidate: string | URL): boolean {
  try {
    if (!website) return false;
    const own = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`);
    const u = candidate instanceof URL ? candidate : new URL(candidate);
    if (!/^https?:$/.test(u.protocol) || !/^https?:$/.test(own.protocol) || u.username || u.password) return false;
    const a = own.hostname.toLowerCase().replace(/^www\./, ""), c = u.hostname.toLowerCase().replace(/^www\./, "");
    if (websiteKey(website) === null) return false; // a social, link-in-bio or other shared host is not the business's own domain: no host-wide trust
    return !!a && a.includes(".") && (c === a || c.endsWith(`.${a}`));
  } catch { return false; }
}

