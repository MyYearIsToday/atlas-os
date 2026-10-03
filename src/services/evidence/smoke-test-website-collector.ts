import { createHash } from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import { LIMITS, analyzeHtml, blockedAddressReason, defaultRequest, validateTarget, WebsiteEvidenceCollector, type HttpResponseLite, type RequestFn, type ResolveFn } from "./website-collector";
import { acquireEvidence } from "./acquisition";
import { MIN_PEERS, PeerBenchmarkCollector } from "./peer-collector";
import type { BusinessIntelligence } from "./business-intelligence";
import { buildOpportunityInput, applyScoringGate, buildProvenanceEvidence } from "../../orchestrator/atlas-pipeline";
import { calculateOpportunityScore } from "../scoring/opportunity-score";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}`); if (!cond) failures++; };

const biz = (over: Partial<BusinessIntelligence> = {}) => ({ id: "biz-test-1", canonicalName: "Joe's Café", category: "catering.cafe", address: "Accra", latitude: 5.6, longitude: -0.19, sourceReferences: ["manual"], website: "https://joescafe.example", ...over }) as unknown as BusinessIntelligence;
const PUBLIC: ResolveFn = async () => [{ address: "93.184.216.34", family: 4 }];
const html = (body: string, status = 200, extra: Record<string, string> = {}): HttpResponseLite => ({ status, headers: { "content-type": "text/html; charset=utf-8", ...extra }, body, truncated: false });
const GOOD = `<html><head><title>Joe&#39;s Café — Accra</title><meta name="description" content="Joe's best coffee, it's fresh"><meta name='viewport' content='width=device-width'><script type="application/ld+json">{"@type":"CafeOrCoffeeShop"}</script></head><body><h1>Joe's <b>Café</b> &amp; Co</h1><a href="https://facebook.com/joes">fb</a><a href="tel:+233201234567">call</a><form></form></body></html>`;
const reqReturning = (r: HttpResponseLite | ((n: number) => HttpResponseLite | Promise<HttpResponseLite>)): RequestFn & { calls: Array<{ url: string; address: string; timeoutMs: number; maxBytes: number }> } => {
  const calls: Array<{ url: string; address: string; timeoutMs: number; maxBytes: number }> = [];
  const fn = (async (t: { url: URL; address: string }, o: { timeoutMs: number; maxBytes: number }) => { calls.push({ url: t.url.toString(), address: t.address, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes }); return typeof r === "function" ? r(calls.length) : r; }) as unknown as RequestFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};
const collect = (request: RequestFn, over: Partial<ConstructorParameters<typeof WebsiteEvidenceCollector>[0]> = {}, b = biz()) =>
  new WebsiteEvidenceCollector({ resolve: PUBLIC, request, nowIso: () => "2026-10-02T00:00:00.000Z", ...over }).collect(b);
const failedWith = async (o: ReturnType<typeof collect>, code: string) => { const r = await o; return r.status === "FAILED" && r.failure?.code === code && r.records.length === 0; };

// --- address + URL policy ---
const blocked = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "192.0.2.1", "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2001:db8::1", "ff02::1", "2002:7f00:1::"];
check("loopback/private/link-local/metadata/CGNAT/reserved/multicast addresses are all blocked (v4, v6, mapped, NAT64, 6to4)", blocked.every((ip) => blockedAddressReason(ip) !== null));
check("ordinary public addresses are allowed", ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"].every((ip) => blockedAddressReason(ip) === null));
const bad = (u: string, code: string) => { const r = validateTarget(u); return !r.ok && r.code === code; };
check("invalid URL rejected", bad("not a url", "invalid_url"));
check("non-http(s) schemes rejected", bad("ftp://example.com/", "unsupported_protocol") && bad("file:///etc/passwd", "unsupported_protocol") && bad("javascript:alert(1)", "unsupported_protocol"));
check("credentials in URL rejected", bad("https://user:pw@example.com/", "credentials_in_url"));
check("only ports 80/443 allowed", bad("https://example.com:8443/", "port_not_allowed") && bad("http://example.com:22/", "port_not_allowed") && validateTarget("https://example.com:443/").ok && validateTarget("http://example.com/").ok);
check("localhost, .local, .internal and single-label hosts rejected", bad("http://localhost/", "blocked_hostname") && bad("http://printer.local/", "blocked_hostname") && bad("http://metadata.google.internal/", "blocked_hostname") && bad("http://intranet/", "blocked_hostname"));
check("IP-literal targets (incl. decimal/hex encodings that normalize to loopback/metadata) rejected", bad("http://127.0.0.1/", "blocked_address") && bad("http://2130706433/", "blocked_address") && bad("http://0x7f.1/", "blocked_address") && bad("http://169.254.169.254/latest/meta-data/", "blocked_address") && bad("http://[::1]/", "blocked_address") && bad("http://10.0.0.5/", "blocked_address"));

// --- collection: success, provenance, determinism ---
{
  const request = reqReturning(html(GOOD));
  const out = await collect(request);
  const byField = Object.fromEntries(out.records.map((r) => [r.field, r])) as Record<string, any>;
  check("public HTML page: COLLECTED with exactly title, meta_description, primary_heading", out.status === "COLLECTED" && out.records.map((r) => r.field).sort().join() === "meta_description,primary_heading,title");
  check("apostrophes, entities and nested tags are handled (title, double-quoted meta, h1 containing <b>)", byField.title.value === "Joe's Café — Accra" && byField.meta_description.value === "Joe's best coffee, it's fresh" && byField.primary_heading.value === "Joe's Café & Co");
  const t = byField.title;
  check("conservative semantics: public_business_page, direct_observation, MEDIUM, UNVERIFIED, website_http, humanReviewRequired", t.sourceType === "public_business_page" && t.evidenceType === "direct_observation" && t.confidence === "MEDIUM" && t.verificationStatus === "UNVERIFIED" && t.collector === "website_http" && t.humanReviewRequired === true && t.observability === "OBSERVED_PRESENT");
  check("every record states domain ownership is not independently verified, with source URL and observation time", out.records.every((r) => /Domain ownership has not been independently verified/.test(r.notes ?? "") && r.sourceUrl === "https://joescafe.example/" && r.observedAt === "2026-10-02T00:00:00.000Z"));
  const expected = createHash("sha256").update(JSON.stringify(["biz-test-1", "https://joescafe.example/", "title", "Joe's Café — Accra"])).digest("hex");
  const again = await collect(reqReturning(html(GOOD)));
  check("evidence IDs are SHA-256 of business ID + URL + field + value, stable across runs", t.evidenceId === expected && /^[0-9a-f]{64}$/.test(t.evidenceId) && again.records.map((r) => r.evidenceId).join() === out.records.map((r) => r.evidenceId).join());
  const changed = await collect(reqReturning(html(GOOD.replace("Accra</title>", "Kumasi</title>"))));
  check("a different extracted value changes the ID", changed.records.find((r) => r.field === "title")!.evidenceId !== t.evidenceId);
  check("the connection is pinned to the validated DNS address", request.calls[0].address === "93.184.216.34");
  const empty = await collect(reqReturning(html("<html><head></head><body>hello</body></html>")));
  check("request succeeded but nothing extractable: COLLECTED with empty evidence (nothing fabricated)", empty.status === "COLLECTED" && empty.records.length === 0);
  const part = await collect(reqReturning({ ...html("<html><head><title>T</title>"), truncated: true }));
  check("a truncated page keeps what was extracted and says it was cut off", part.records.length === 1 && /cut off/.test(part.records[0].notes ?? ""));
  const plain = await collect(reqReturning({ status: 200, headers: { "content-type": "text/plain" }, body: "  Hello\n\n  world  ", truncated: false }));
  check("plain text yields page_text (whitespace-normalized) and no HTML fields", plain.status === "COLLECTED" && plain.records.length === 1 && plain.records[0].field === "page_text" && plain.records[0].value === "Hello world");
  const big = await collect(reqReturning({ status: 200, headers: { "content-type": "text/plain" }, body: "x".repeat(5000), truncated: false }));
  check("page_text is capped", (big.records[0].value as string).length === LIMITS.pageTextMaxChars);
  // contract limits: 4 redirects, 8s default / 30s max timeout, 1 MB default / 2 MB max size
  const d = reqReturning(html(GOOD)); await collect(d);
  const hi = reqReturning(html(GOOD)); await collect(hi, { perRequestTimeoutMs: 99_999, maxBytes: 9_000_000, overallDeadlineMs: 120_000 });
  const bad = reqReturning(html(GOOD)); await collect(bad, { perRequestTimeoutMs: -1, maxBytes: Number.NaN });
  check("limits: default 8s timeout and 1 MB size; maximums 30s and 2 MB; invalid values fall back to defaults", d.calls[0].timeoutMs === 8000 && d.calls[0].maxBytes === 1024 * 1024 && hi.calls[0].timeoutMs === 30_000 && hi.calls[0].maxBytes === 2 * 1024 * 1024 && bad.calls[0].timeoutMs === 8000 && bad.calls[0].maxBytes === 1024 * 1024);
  const loop = reqReturning(html("", 302, { location: "https://joescafe.example/loop" }));
  const looped = await collect(loop, { maxRedirects: 10 });
  check("redirects are capped at 4 even if a caller asks for more (5 requests, then too_many_redirects)", looped.status === "FAILED" && looped.failure?.code === "too_many_redirects" && loop.calls.length === 5);
}

// --- failures never fabricate evidence or throw ---
check("no website in the record: UNAVAILABLE with no records", await (async () => { const o = await collect(reqReturning(html(GOOD)), {}, biz({ website: undefined })); return o.status === "UNAVAILABLE" && o.failure?.code === "no_website" && o.records.length === 0; })());
check("HTTP 404 is UNAVAILABLE with no evidence invented", await (async () => { const o = await collect(reqReturning(html("nope", 404))); return o.status === "UNAVAILABLE" && o.failure?.code === "http_404" && o.records.length === 0; })());
check("unsupported content types are UNAVAILABLE and never read", await (async () => { const o = await collect(reqReturning({ status: 200, headers: { "content-type": "application/pdf" }, body: "", truncated: false })); return o.status === "UNAVAILABLE" && o.failure?.code === "unsupported_content_type" && o.records.length === 0; })());
check("a technical/policy failure is FAILED, distinct from UNAVAILABLE", await (async () => { const o = await collect(reqReturning(html(GOOD)), { resolve: async () => [{ address: "10.0.0.1", family: 4 }] }); return o.status === "FAILED" && o.failure?.code === "blocked_address"; })());
check("DNS failure is a recorded failure, not evidence", await failedWith(collect(reqReturning(html(GOOD)), { resolve: async () => { throw new Error("ENOTFOUND"); } }), "dns_failure"));
check("hostname resolving to a private address is blocked before any connection", await (async () => { const rq = reqReturning(html(GOOD)); const ok = await failedWith(collect(rq, { resolve: async () => [{ address: "10.0.0.7", family: 4 }] }), "blocked_address"); return ok && rq.calls.length === 0; })());
check("a single private address among several public answers blocks the host (rebinding-style mix)", await failedWith(collect(reqReturning(html(GOOD)), { resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }] }), "blocked_address"));
check("redirect to a private/metadata target is blocked on the second hop", await (async () => { const rq = reqReturning((n) => html("", 302, { location: "http://169.254.169.254/latest/meta-data/" })); const ok = await failedWith(collect(rq), "blocked_address"); return ok && rq.calls.length === 1; })());
check("redirect to localhost / credentialed / odd-port targets is blocked", (await Promise.all([ "http://localhost/admin", "https://u:p@evil.example/", "https://evil.example:8443/" ].map((loc) => collect(reqReturning(html("", 301, { location: loc })))))).every((o) => o.status === "FAILED" && o.records.length === 0));
check("a redirect whose hostname resolves privately is blocked (DNS revalidated per hop)", await (async () => { const resolve: ResolveFn = async (h) => [{ address: h === "joescafe.example" ? "93.184.216.34" : "192.168.0.9", family: 4 }]; return failedWith(collect(reqReturning(html("", 302, { location: "https://rebind.example/" })), { resolve }), "blocked_address"); })());
check("legitimate redirects are followed and every hop is recorded", await (async () => { const o = await collect(reqReturning((n) => (n === 1 ? html("", 301, { location: "/home" }) : html(GOOD)))); return o.status === "COLLECTED" && (o.hops?.length ?? 0) === 2 && o.records.length > 0; })());
check("a custom lower redirect cap is honored", await failedWith(collect(reqReturning(html("", 302, { location: "https://joescafe.example/loop" })), { maxRedirects: 2 }), "too_many_redirects"));
check("per-request timeout is reported as request_timeout", await failedWith(collect(reqReturning(async () => { throw Object.assign(new Error("request_timeout"), { code: "ETIMEDOUT" }); })), "request_timeout"));
check("overall deadline stops a hung collection", await (async () => { const t = Date.now(); const o = await collect((() => new Promise(() => undefined)) as RequestFn, { overallDeadlineMs: 80 }); return o.failure?.code === "deadline_exceeded" && Date.now() - t < 1500; })());
check("multiple addresses: a connect failure falls through to the next validated address", await (async () => { const rq = reqReturning((n) => { if (n === 1) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); return html(GOOD); }); const o = await collect(rq, { resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }] }); return o.status === "COLLECTED" && rq.calls.map((c) => c.address).join() === "93.184.216.34,2606:2800:220:1::1"; })());
check("all addresses failing yields connect_failed", await failedWith(collect(reqReturning(async () => { throw Object.assign(new Error("x"), { code: "ECONNREFUSED" }); })), "connect_failed"));
check("acquireEvidence isolates a throwing collector and keeps the other sources", await (async () => { const r = await acquireEvidence(biz(), [{ source: "boom", collect: async () => { throw new Error("kaboom"); } }, new WebsiteEvidenceCollector({ resolve: PUBLIC, request: reqReturning(html(GOOD)) })]); return r.outcomes[0].status === "FAILED" && r.outcomes[1].status === "COLLECTED" && r.records.length > 0; })());
check("HTML helper handles quotes containing > and unquoted attributes", analyzeHtml(`<meta name=description content="a > b, it's ok"><title> T </title>`).metaDescription === "a > b, it's ok");

// --- real defaultRequest against a local server (validation is separate; this proves pinning, caps and timeouts) ---
const server = http.createServer((req, res) => {
  if (req.url === "/page") { res.setHeader("content-type", "text/html"); res.end(`<title>${req.headers.host}</title>`); }
  else if (req.url === "/ua") { res.setHeader("content-type", "text/plain"); res.end(String(req.headers["user-agent"])); }
  else if (req.url === "/big") { res.setHeader("content-type", "text/html"); res.end("x".repeat(5000)); }
  else if (req.url === "/img") { res.setHeader("content-type", "image/png"); res.end("PNG"); }
  else if (req.url === "/redir") { res.statusCode = 302; res.setHeader("location", "http://169.254.169.254/"); res.end(); }
  else if (req.url === "/hang") { res.setHeader("content-type", "text/html"); res.write("<title>"); }
  else if (req.url === "/abort") { res.setHeader("content-type", "text/html"); res.setHeader("content-length", "100"); res.write("<ti"); setTimeout(() => res.socket?.destroy(), 20); }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
const pinned = (path: string) => ({ url: new URL(`http://pinned-host.example:${port}${path}`), address: "127.0.0.1", family: 4 as const });
{
  const ok = await defaultRequest(pinned("/page"), { timeoutMs: 2000, maxBytes: 10000 });
  check("defaultRequest connects to the pinned IP (hostname does not resolve anywhere) and sends the original Host header", ok.status === 200 && ok.body.includes(`pinned-host.example:${port}`));
  const ua = await defaultRequest(pinned("/ua"), { timeoutMs: 2000, maxBytes: 10000 });
  check("the User-Agent is AtlasOS-PublicEvidence/1.0", ua.body === "AtlasOS-PublicEvidence/1.0");
  const big = await defaultRequest(pinned("/big"), { timeoutMs: 2000, maxBytes: 1000 });
  check("response-size cap truncates the body at maxBytes and flags it", big.truncated === true && big.body.length === 1000);
  const img = await defaultRequest(pinned("/img"), { timeoutMs: 2000, maxBytes: 1000 });
  check("non-text content types are not read", img.status === 200 && img.body === "");
  const redir = await defaultRequest(pinned("/redir"), { timeoutMs: 2000, maxBytes: 1000 });
  check("redirects are returned, never followed, by the transport", redir.status === 302 && redir.headers["location"] === "http://169.254.169.254/");
  check("a server that never finishes is cut off by the per-request timeout", await defaultRequest(pinned("/hang"), { timeoutMs: 150, maxBytes: 1000 }).then(() => false, (e: any) => e.code === "ETIMEDOUT"));
  check("a connection dropped mid-body is an error, not a complete page", await defaultRequest(pinned("/abort"), { timeoutMs: 2000, maxBytes: 1000 }).then(() => false, () => true));
  const refused = await defaultRequest({ url: new URL("http://pinned-host.example:1/"), address: "127.0.0.1", family: 4 }, { timeoutMs: 1000, maxBytes: 10 }).then(() => "ok", (e: any) => e.code);
  check("connect errors surface their code", refused === "ECONNREFUSED");
}
server.close();

// --- peer benchmark + scoring gate ---
const peers = (n: number, withSite: number) => ({ discover: async () => Array.from({ length: n }, (_, i) => ({ externalId: `p${i}`, name: `Peer ${i}`, source: "geoapify", website: i < withSite ? `https://p${i}.example` : undefined })) });
{
  const few = await new PeerBenchmarkCollector({ provider: peers(MIN_PEERS - 1, 3) as never, sourceUrl: "https://api.geoapify.com/v2/places" }).collect(biz());
  check("too few peers records nothing rather than guessing", few.status === "UNAVAILABLE" && few.records.length === 0);
  const noCoords = await new PeerBenchmarkCollector({ provider: peers(8, 4) as never, sourceUrl: "x" }).collect(biz({ latitude: undefined } as never));
  check("peer benchmark needs coordinates", noCoords.status === "UNAVAILABLE");
  const ok = await new PeerBenchmarkCollector({ provider: peers(8, 6) as never, sourceUrl: "https://api.geoapify.com/v2/places", nowIso: () => "2026-10-02T00:00:00.000Z" }).collect(biz());
  check("peer benchmark records the observed rate with MEDIUM confidence and a lower-bound note", ok.records.length === 1 && (ok.records[0] as any).value.websiteRate === 0.75 && (ok.records[0] as any).confidence === "MEDIUM");
}
{
  const b = biz();
  const prov = buildProvenanceEvidence(b);
  const site = (await collect(reqReturning(html(GOOD)))).records;
  const peerRec = (await new PeerBenchmarkCollector({ provider: peers(8, 6) as never, sourceUrl: "x" }).collect(b)).records;
  const gate = (obs: typeof site) => applyScoringGate(calculateOpportunityScore(buildOpportunityInput(b, prov, obs)));
  const none = gate([]);
  check("no external evidence: score withheld (10% observable) exactly as before", !none.scorable && none.observedWeight === 10 && none.score.overallScore === null);
  const siteOnly = gate(site);
  check("website evidence alone adds visibility (30% observable total) and stays below the unchanged 50% threshold, so no numeric score", !siteOnly.scorable && siteOnly.observedWeight === 30 && siteOnly.score.overallScore === null);
  const both = gate([...site, ...peerRec]);
  check("website + peer evidence reaches the 50% gate and yields a numeric score from stated ratios", both.scorable && both.observedWeight === 50 && typeof both.score.overallScore === "number" && both.score.overallScore > 0);
  check("each observed component cites real evidence IDs", both.score.components.filter((c) => c.observability !== "NOT_OBSERVABLE").every((c) => c.evidenceRefs.length > 0));
  const broken = gate(await collect(reqReturning(html("down", 503))).then((o) => o.records));
  check("a listed website that served nothing usable leaves visibility NOT_OBSERVABLE (no invented weakness)", broken.score.components.find((c) => c.key === "visibilityWeakness")?.observability === "NOT_OBSERVABLE" && broken.observedWeight === 10);
  const failed = gate([]);
  check("a failed collection leaves the dimensions NOT_OBSERVABLE rather than inventing a value", failed.score.components.find((c) => c.key === "visibilityWeakness")?.observability === "NOT_OBSERVABLE");
}

console.log(failures === 0 ? "\nALL WEBSITE/EVIDENCE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
