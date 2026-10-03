import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { BusinessIntelligence } from "./business-intelligence";
import type { EvidenceRecord } from "./evidence";
import type { CollectorOutcome, EvidenceCollector } from "./acquisition";

/**
 * Website evidence collector. It fetches ONLY the business's own public website and records what it
 * directly observed. Safety model: http/https only, no credentials, ports 80/443 only, every hostname
 * resolved before connecting and ALL resolved addresses must be public, the connection is pinned to a
 * validated address (no second DNS lookup), every redirect is re-validated, and time, redirect, size and
 * content-type are bounded. Failures are returned as outcomes, never thrown, and never become evidence.
 */

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type ResolveFn = (hostname: string) => Promise<ResolvedAddress[]>;
export interface HttpResponseLite { status: number; headers: Record<string, string>; body: string; truncated: boolean }
export type RequestFn = (target: { url: URL; address: string; family: 4 | 6 }, opts: { timeoutMs: number; maxBytes: number }) => Promise<HttpResponseLite>;

// ---------- address / URL policy ----------
function v4Reason(b: number[]): string | null {
  const [a, bb, c] = b;
  if (a === 0) return "unspecified";
  if (a === 10) return "private";
  if (a === 100 && bb >= 64 && bb <= 127) return "carrier-grade-nat";
  if (a === 127) return "loopback";
  if (a === 169 && bb === 254) return "link-local-or-metadata";
  if (a === 172 && bb >= 16 && bb <= 31) return "private";
  if (a === 192 && bb === 0 && (c === 0 || c === 2)) return "reserved";
  if (a === 192 && bb === 88 && c === 99) return "reserved";
  if (a === 192 && bb === 168) return "private";
  if (a === 198 && (bb === 18 || bb === 19)) return "reserved";
  if (a === 198 && bb === 51 && c === 100) return "reserved";
  if (a === 203 && bb === 0 && c === 113) return "reserved";
  if (a >= 224) return "multicast-or-reserved";
  return null;
}

function v6Bytes(ip: string): number[] | null {
  if (ip.includes("%")) return null;
  let text = ip.toLowerCase();
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const p = tail[1].split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return null;
    text = text.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if ((halves.length === 1 && head.length !== 8) || fill < 0 || (halves.length === 2 && fill < 1)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 255);
  }
  return out.length === 16 ? out : null;
}

/** Returns why an IP must not be contacted, or null when it is a public unicast address. */
export function blockedAddressReason(ip: string): string | null {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Reason(ip.split(".").map(Number));
  if (kind !== 6) return "not-an-ip";
  const b = v6Bytes(ip);
  if (!b) return "unparseable-ipv6";
  if (b.every((x) => x === 0)) return "unspecified";
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return "loopback";
  const embedded = b.slice(12, 16);
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return v4Reason(embedded);
  if (b.slice(0, 12).every((x) => x === 0)) return v4Reason(embedded) ?? "reserved";
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return v4Reason(embedded) ?? "nat64";
  if ((b[0] & 0xfe) === 0xfc) return "unique-local";
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return "link-local";
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return "site-local";
  if (b[0] === 0xff) return "multicast";
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return "documentation";
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return "teredo";
  if (b[0] === 0x20 && b[1] === 0x02) return v4Reason(b.slice(2, 6));
  if (b[0] === 0x01 && b[1] === 0 && b.slice(2, 8).every((x) => x === 0)) return "discard";
  return null;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".home.arpa"];

export type TargetCheck = { ok: true; url: URL; hostname: string; literal: boolean } | { ok: false; code: string; message: string };

export function validateTarget(raw: string): TargetCheck {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, code: "invalid_url", message: "not a valid URL" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "unsupported_protocol", message: `protocol ${url.protocol} is not allowed` };
  if (url.username || url.password) return { ok: false, code: "credentials_in_url", message: "URLs with credentials are rejected" };
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return { ok: false, code: "port_not_allowed", message: `port ${url.port} is not allowed` };
  let host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, code: "invalid_url", message: "missing hostname" };
  const literal = net.isIP(host) !== 0;
  if (literal) {
    const reason = blockedAddressReason(host);
    if (reason) return { ok: false, code: "blocked_address", message: `address is ${reason}` };
  } else if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, code: "blocked_hostname", message: "hostname is not a public internet name" };
  }
  return { ok: true, url, hostname: host, literal };
}

export const defaultResolve: ResolveFn = async (hostname) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map((r) => ({ address: r.address, family: (r.family === 6 ? 6 : 4) as 4 | 6 }));

// ---------- pinned request ----------
const USER_AGENT = "AtlasOS-PublicEvidence/1.0";
const connectErrors = new Set(["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN"]);

/** Connects to the already-validated address (the lookup hook returns it; DNS is never consulted again). */
export const defaultRequest: RequestFn = (target, { timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const secure = target.url.protocol === "https:";
    const hostname = target.url.hostname.replace(/^\[|\]$/g, "");
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const req = (secure ? https : http).request({
      protocol: target.url.protocol,
      hostname,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: "GET",
      agent: false,
      servername: secure && net.isIP(hostname) === 0 ? hostname : undefined,
      headers: { Host: target.url.host, "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9", "Accept-Encoding": "identity" },
      lookup: ((_h: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
        options?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)) as never,
    }, (res) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      const type = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return done(() => resolve({ status, headers, body: "", truncated: false })); }
      if (type !== "text/html" && type !== "text/plain") { res.destroy(); return done(() => resolve({ status, headers, body: "", truncated: false })); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
          res.destroy();
          return done(() => resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8"), truncated: true }));
        }
        chunks.push(chunk);
      });
      res.on("end", () => done(() => resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8"), truncated: false })));
      res.on("error", (e) => done(() => reject(e)));
      // A connection that closes before the body is complete must not look like a full page (it would yield false "absent" findings).
      res.on("close", () => done(() => (res.complete ? resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8"), truncated: size > maxBytes }) : reject(Object.assign(new Error("response_aborted"), { code: "ECONNRESET" })))));
    });
    const timer = setTimeout(() => { req.destroy(new Error("request_timeout")); done(() => reject(Object.assign(new Error("request_timeout"), { code: "ETIMEDOUT" }))); }, timeoutMs);
    req.on("error", (e) => done(() => reject(e)));
    req.end();
  });

// ---------- HTML analysis ----------
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, " ").trim();

/** Attribute parser that is quote-aware, so apostrophes inside "..." (and quotes inside '...') are safe. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  for (const m of tag.replace(/^<[a-zA-Z0-9]+/, "").matchAll(re)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
const tagsOf = (html: string, name: string) => html.match(new RegExp(`<${name}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, "gi")) ?? [];
const SOCIAL = ["facebook.com", "instagram.com", "x.com", "twitter.com", "linkedin.com", "tiktok.com", "youtube.com"];

/** Limits fixed by the Objective 1A contract. Callers may tighten them but never exceed the maximums. */
export const LIMITS = { maxRedirects: 4, defaultTimeoutMs: 8000, maxTimeoutMs: 30000, defaultMaxBytes: 1024 * 1024, maxMaxBytes: 2 * 1024 * 1024, pageTextMaxChars: 2000 } as const;
const bounded = (value: number | undefined, fallback: number, max: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback);

export const DOMAIN_OWNERSHIP_NOTE = "Observed on a public web page. Domain ownership has not been independently verified; this page is not confirmed to be the business's official website.";

export interface HtmlFacts {
  title: string | null; primaryHeading: string | null; metaDescription: string | null; viewport: boolean; structuredDataTypes: string[];
  socialPlatforms: string[]; contactLink: boolean; contactForm: boolean;
}

export function analyzeHtml(html: string): HtmlFacts {
  const metas = tagsOf(html, "meta").map(attrs);
  const metaContent = (name: string) => metas.find((m) => m.name?.toLowerCase() === name)?.content;
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const types = new Set<string>();
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const t = (node as Record<string, unknown>)["@type"];
          (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => typeof x === "string" && types.add(x));
          Object.values(node as object).forEach(walk);
        }
      };
      walk(JSON.parse(m[1]));
    } catch { /* malformed JSON-LD is simply not structured data */ }
  }
  const hrefs = tagsOf(html, "a").map((t) => attrs(t).href ?? "");
  const platforms = new Set<string>();
  for (const href of hrefs) {
    try { const h = new URL(href, "https://x.invalid").hostname.replace(/^www\./, ""); SOCIAL.filter((s) => h === s || h.endsWith(`.${s}`)).forEach((s) => platforms.add(s)); } catch { /* ignore */ }
  }
  const title = titleMatch ? decode(titleMatch[1]).slice(0, 200) : "";
  const description = metaContent("description");
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = h1 ? decode(h1[1].replace(/<[^>]*>/g, " ")).slice(0, 200) : "";
  return {
    title: title || null,
    primaryHeading: heading || null,
    metaDescription: description && decode(description) ? decode(description).slice(0, 400) : null,
    viewport: !!metaContent("viewport"),
    structuredDataTypes: [...types].sort(),
    socialPlatforms: [...platforms].sort(),
    contactLink: hrefs.some((h) => /^(tel|mailto):/i.test(h.trim())),
    contactForm: /<form\b/i.test(html),
  };
}

// ---------- collector ----------
export interface WebsiteCollectorOptions {
  resolve?: ResolveFn; request?: RequestFn; nowIso?: () => string;
  perRequestTimeoutMs?: number; overallDeadlineMs?: number; maxRedirects?: number; maxBytes?: number; maxAddresses?: number;
}

class CollectionFailure extends Error { constructor(public code: string, message: string) { super(message); } }

export class WebsiteEvidenceCollector implements EvidenceCollector {
  readonly source = "website";
  private o: Required<WebsiteCollectorOptions>;
  constructor(options: WebsiteCollectorOptions = {}) {
    this.o = {
      resolve: options.resolve ?? defaultResolve, request: options.request ?? defaultRequest,
      nowIso: options.nowIso ?? (() => new Date().toISOString()),
      perRequestTimeoutMs: bounded(options.perRequestTimeoutMs, LIMITS.defaultTimeoutMs, LIMITS.maxTimeoutMs), overallDeadlineMs: options.overallDeadlineMs ?? 20000,
      maxRedirects: Math.min(Math.max(Math.trunc(options.maxRedirects ?? LIMITS.maxRedirects), 0), LIMITS.maxRedirects), maxBytes: bounded(options.maxBytes, LIMITS.defaultMaxBytes, LIMITS.maxMaxBytes), maxAddresses: options.maxAddresses ?? 4,
    };
  }

  async collect(business: BusinessIntelligence): Promise<CollectorOutcome> {
    if (!business.website) return { source: this.source, status: "UNAVAILABLE", records: [], failure: { code: "no_website", message: "no website in the discovery record" } };
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CollectionFailure("deadline_exceeded", "overall collection deadline exceeded")), this.o.overallDeadlineMs); });
      const fetched = await Promise.race([this.fetchPage(business.website, started), deadline]);
      const { response } = fetched;
      const type = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const unavailable = (code: string, message: string): CollectorOutcome => ({ source: this.source, status: "UNAVAILABLE", records: [], failure: { code, message }, hops: fetched.hops });
      if (response.status >= 400) return unavailable(`http_${response.status}`, `the website responded with HTTP ${response.status}`);
      if (response.status >= 300) return unavailable("redirect_without_location", "the website redirected without a usable Location");
      if (type !== "text/html" && type !== "text/plain") return unavailable("unsupported_content_type", `content type "${type || "unknown"}" is not text/html or text/plain`);
      // Request succeeded: COLLECTED even when nothing extractable was found (empty evidence, never fabricated).
      return { source: this.source, status: "COLLECTED", records: this.toRecords(business, fetched, type), hops: fetched.hops };
    } catch (e) {
      const failure = e instanceof CollectionFailure ? { code: e.code, message: e.message } : { code: "fetch_failed", message: e instanceof Error ? e.message : "unknown error" };
      return { source: this.source, status: "FAILED", records: [], failure };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchPage(rawWebsite: string, started: number) {
    let current = /^[a-z][a-z0-9+.-]*:/i.test(rawWebsite.trim()) ? rawWebsite.trim() : `https://${rawWebsite.trim()}`;
    const hops: string[] = [];
    for (let hop = 0; hop <= this.o.maxRedirects; hop++) {
      const check = validateTarget(current);
      if (!check.ok) throw new CollectionFailure(check.code, check.message);
      hops.push(check.url.toString());
      let addresses: ResolvedAddress[];
      try {
        addresses = check.literal ? [{ address: check.hostname, family: (net.isIP(check.hostname) === 6 ? 6 : 4) as 4 | 6 }] : await this.o.resolve(check.hostname);
      } catch (e) {
        throw new CollectionFailure("dns_failure", `DNS lookup failed (${(e as { code?: string })?.code ?? (e as Error)?.message ?? "unknown"})`);
      }
      if (!addresses.length) throw new CollectionFailure("dns_empty", "hostname did not resolve");
      const bad = addresses.map((a) => blockedAddressReason(a.address)).find((r) => r !== null);
      if (bad) throw new CollectionFailure("blocked_address", `hostname resolves to a ${bad} address`);
      let response: HttpResponseLite | undefined;
      let lastError: unknown;
      for (const target of addresses.slice(0, this.o.maxAddresses)) {
        const remaining = this.o.overallDeadlineMs - (Date.now() - started);
        if (remaining <= 0) throw new CollectionFailure("deadline_exceeded", "overall collection deadline exceeded");
        try {
          response = await this.o.request({ url: check.url, address: target.address, family: target.family }, { timeoutMs: Math.min(this.o.perRequestTimeoutMs, remaining), maxBytes: this.o.maxBytes });
          break;
        } catch (e) { lastError = e; }
      }
      if (!response) {
        const code = (lastError as { code?: string })?.code;
        throw new CollectionFailure(code === "ETIMEDOUT" || (lastError as Error)?.message === "request_timeout" ? "request_timeout" : "connect_failed", `could not connect (${code ?? (lastError as Error)?.message ?? "unknown"})`);
      }
      const location = response.headers["location"];
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop === this.o.maxRedirects) throw new CollectionFailure("too_many_redirects", "redirect limit exceeded");
        try { current = new URL(location, check.url).toString(); } catch { throw new CollectionFailure("invalid_redirect", "redirect target is not a valid URL"); }
        continue;
      }
      return { response, finalUrl: check.url, hops };
    }
    throw new CollectionFailure("too_many_redirects", "redirect limit exceeded");
  }

  /** Conservative public-page evidence: only extracted fields, MEDIUM confidence, UNVERIFIED, flagged for human review. */
  private toRecords(business: BusinessIntelligence, fetched: { response: HttpResponseLite; finalUrl: URL }, type: string): EvidenceRecord[] {
    const { response, finalUrl } = fetched;
    const at = this.o.nowIso();
    const url = finalUrl.toString();
    const note = response.truncated ? `${DOMAIN_OWNERSHIP_NOTE} The page was cut off at the response-size limit.` : DOMAIN_OWNERSHIP_NOTE;
    const make = (field: string, value: string): EvidenceRecord => ({
      // Same business + URL + field + value always yields the same ID.
      evidenceId: createHash("sha256").update(JSON.stringify([business.id, url, field, value])).digest("hex"),
      businessId: business.id,
      field,
      value,
      sourceType: "public_business_page",
      sourceUrl: url,
      evidenceType: "direct_observation",
      observedAt: at,
      retrievedAt: at,
      confidence: "MEDIUM",
      verificationStatus: "UNVERIFIED",
      collector: "website_http",
      notes: note,
      humanReviewRequired: true,
      observability: "OBSERVED_PRESENT",
    });
    if (type === "text/plain") {
      const text = response.body.replace(/\s+/g, " ").trim().slice(0, LIMITS.pageTextMaxChars);
      return text ? [make("page_text", text)] : [];
    }
    const facts = analyzeHtml(response.body);
    const records: EvidenceRecord[] = [];
    if (facts.title) records.push(make("title", facts.title));
    if (facts.metaDescription) records.push(make("meta_description", facts.metaDescription));
    if (facts.primaryHeading) records.push(make("primary_heading", facts.primaryHeading));
    return records;
  }
}
