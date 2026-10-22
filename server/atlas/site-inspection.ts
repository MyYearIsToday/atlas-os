import type { InspectedPage, PageRole, WebsiteInspection } from "../../src/orchestrator/dossier-types";
import { normalizeSocial } from "../../src/services/scout/social-profiles";
import { htmlMeta, htmlTitle, htmlToText, type FetchDoc, type FetchedDoc } from "./source-tools";

/**
 * Bounded inspection of a business's own website. Follows only links that really appear on the page and stay on the same
 * host, reads at most MAX_PAGES pages through the existing SSRF-safe fetcher, and records what was and was NOT inspected.
 * It never guesses URLs, never submits forms and never executes scripts: a JavaScript-rendered page is reported as such.
 */


const MAX_PAGES = 6; // homepage + up to 5 internal pages
const ROLE_RULES: Array<[PageRole, RegExp]> = [
  ["about", /\b(about|who-we-are|our-story|story|company|mission|history)\b/i],
  ["services", /\b(services?|products?|menu|shop|store|programmes?|programs?|courses?|offer|solutions|what-we-do|catalogue|catalog)\b/i],
  ["contact", /\b(contact|reach-us|find-us|location|visit|book|booking)\b/i],
  ["team", /\b(team|people|leadership|executives?|staff|members?)\b/i],
  ["portfolio", /\b(portfolio|gallery|work|projects|case-studies|clients)\b/i],
  ["pricing", /\b(pricing|prices|packages|rates|plans)\b/i],
  ["events", /\b(events?|news|announcements?)\b/i],
  ["blog", /\b(blog|articles?|press|insights)\b/i],
];
const PRIORITY: PageRole[] = ["about", "services", "contact", "team", "portfolio", "pricing", "events", "blog"];
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml)(\?|$)/i;
const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, "");

function normalizeStart(raw: string): URL | null {
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u : null; } catch { return null; }
}

export function extractLinks(html: string, base: URL): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1]?.replace(/&amp;/g, "&");
    if (!href || /^(#|mailto:|tel:|javascript:|data:|sms:|whatsapp:)/i.test(href)) continue;
    try { const u = new URL(href, base); u.hash = ""; if (/^https?:$/.test(u.protocol)) out.push({ url: u.toString(), text: htmlToText(m[2]).slice(0, 80) }); } catch { /* ignore */ }
  }
  return out;
}

export function pickInternalPages(links: Array<{ url: string; text: string }>, base: URL, max = MAX_PAGES - 1): Array<{ url: string; role: PageRole }> {
  const seen = new Set<string>([base.pathname.replace(/\/+$/, "") || "/"]);
  const byRole = new Map<PageRole, string>(); const rest: Array<{ url: string; role: PageRole }> = [];
  for (const l of links) {
    let u: URL; try { u = new URL(l.url); } catch { continue; }
    if (hostKey(u.hostname) !== hostKey(base.hostname) || SKIP_EXT.test(u.pathname) || u.search.length > 40) continue;
    const key = u.pathname.replace(/\/+$/, "") || "/"; if (seen.has(key)) continue; seen.add(key);
    const hay = `${u.pathname} ${l.text}`;
    const role = ROLE_RULES.find(([, re]) => re.test(hay))?.[0];
    if (!role) continue;
    if (!byRole.has(role)) byRole.set(role, u.toString()); else rest.push({ url: u.toString(), role });
  }
  const picked = PRIORITY.filter((r) => byRole.has(r)).map((r) => ({ url: byRole.get(r)!, role: r }));
  return [...picked, ...rest].slice(0, max);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?233|0)[\s().-]?\d{2}[\s().-]?\d{3}[\s().-]?\d{4}/g;
const uniq = (a: string[]) => [...new Set(a)];

export function extractContacts(html: string, text: string): { emails: string[]; phones: string[] } {
  const mail = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase());
  const tel = [...html.matchAll(/tel:([^"'\s>]+)/gi)].map((m) => decodeURIComponent(m[1]).replace(/[^\d+]/g, ""));
  const emails = uniq([...mail, ...(text.match(EMAIL) ?? []).map((e) => e.toLowerCase())]).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/(example|sentry|wixpress|domain)\./.test(e)).slice(0, 6);
  const phones = uniq([...tel, ...(text.match(PHONE) ?? []).map((p) => p.replace(/[^\d+]/g, ""))]).filter((p) => p.replace(/\D/g, "").length >= 9).slice(0, 6);
  return { emails, phones };
}

function headingsOf(html: string): string[] {
  return [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => htmlToText(m[2]).slice(0, 120)).filter(Boolean).slice(0, 12);
}

/** A page whose static HTML carries almost no readable text but loads scripts / an app root is rendered by JavaScript. */
export function looksJsRendered(html: string, text: string): boolean {
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return text.length < 300 && (scripts >= 3 || /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html) || /enable javascript|requires javascript/i.test(html));
}

function describe(role: PageRole, req: string, doc: FetchedDoc, at: string): InspectedPage {
  if (!doc.ok || !doc.body) return { url: req, role, at, status: "failed", reason: doc.reason ?? "unreadable", httpStatus: doc.status, headings: [], textChars: 0, excerpt: "", emails: [], phones: [], socialLinks: [], rendering: "static" };
  const text = htmlToText(doc.body);
  const base = (() => { try { return new URL(doc.finalUrl ?? req); } catch { return null; } })();
  const social = base ? uniq(extractLinks(doc.body, base).map((l) => { const r = normalizeSocial(l.url); return r.ok ? r.profile.url : ""; }).filter(Boolean)).slice(0, 8) : [];
  const { emails, phones } = extractContacts(doc.body, text);
  return {
    url: req, finalUrl: doc.finalUrl, role, at, status: "read", httpStatus: doc.status, title: htmlTitle(doc.body) || undefined, description: htmlMeta(doc.body).slice(0, 400) || undefined,
    headings: headingsOf(doc.body), textChars: text.length, excerpt: text.slice(0, 500), emails, phones, socialLinks: social,
    rendering: looksJsRendered(doc.body, text) ? "js_required" : "static",
  };
}

export async function inspectWebsite(
  website: string, fetchDoc: FetchDoc, now: () => string = () => new Date().toISOString(),
  onPage?: (page: InspectedPage, doc: FetchedDoc) => void,
): Promise<WebsiteInspection> {
  const startedAt = now();
  const out: WebsiteInspection = { site: website, startedAt, finishedAt: startedAt, pages: [], contacts: { emails: [], phones: [] }, socialLinks: [], limits: [] };
  const start = normalizeStart(website);
  if (!start) { out.limits.push("The recorded website address is not a valid http(s) URL, so no site pages were inspected."); out.finishedAt = now(); return out; }

  const home = await fetchDoc(start.toString());
  const homePage = describe("home", start.toString(), home, now());
  out.pages.push(homePage);
  if (!home.ok || !home.body) {
    const why: Record<string, string> = { timeout: "timed out", host_not_allowed: "points to a host Atlas is not allowed to contact", invalid_url: "is not a valid URL", unsupported_url: "uses an unsupported URL form", too_many_redirects: "redirected too many times", network_error: "could not be reached" };
    out.limits.push(`The website ${why[home.reason ?? ""] ?? `could not be read (${home.reason ?? "unknown"})`}. Nothing on the site could be inspected, and this does not show the site is down or absent.`);
    out.finishedAt = now(); return out;
  }
  onPage?.(homePage, home);
  const finalUrl = (() => { try { return new URL(home.finalUrl ?? start.toString()); } catch { return start; } })();
  if (hostKey(finalUrl.hostname) !== hostKey(start.hostname)) {
    out.redirectedToOtherDomain = hostKey(finalUrl.hostname);
    out.limits.push(`The supplied website redirects to a different domain (${hostKey(finalUrl.hostname)}). Confirm this is the business's own site before relying on it.`);
  }

  const targets = pickInternalPages(extractLinks(home.body, finalUrl), finalUrl);
  const results = await Promise.all(targets.map(async (t) => ({ t, doc: await fetchDoc(t.url) })));
  for (const { t, doc } of results) {
    const page = describe(t.role, t.url, doc, now());
    out.pages.push(page);
    if (page.status === "read") onPage?.(page, doc);
  }
  const js = out.pages.filter((p) => p.status === "read" && p.rendering === "js_required");
  if (js.length) out.limits.push(`${js.length} page(s) (${js.map((p) => p.role).join(", ")}) appear to be rendered by JavaScript; only the static shell was readable, so their real content is unknown.`);
  const failed = out.pages.filter((p) => p.status === "failed" && p.role !== "home");
  if (failed.length) out.limits.push(`${failed.length} internal page(s) could not be read (${uniq(failed.map((p) => p.reason ?? "unreadable")).join(", ")}).`);
  if (targets.length === 0) out.limits.push("No About, Services, Contact or similar internal links were found on the homepage, so only the homepage was inspected.");
  const read = out.pages.filter((p) => p.status === "read");
  out.contacts = { emails: uniq(read.flatMap((p) => p.emails)).slice(0, 8), phones: uniq(read.flatMap((p) => p.phones)).slice(0, 8) };
  out.socialLinks = uniq(read.flatMap((p) => p.socialLinks)).slice(0, 10);
  out.finishedAt = now();
  return out;
}
