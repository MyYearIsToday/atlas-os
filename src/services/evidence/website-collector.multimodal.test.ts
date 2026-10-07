import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessIntelligence } from "./business-intelligence";
import { WebsiteEvidenceCollector, type HttpResponseLite, type RequestFn } from "./website-collector";

const business: BusinessIntelligence = {
  id: "test-business", canonicalName: "Example Café", aliases: [], categories: ["cafe"], status: "ACTIVE",
  website: "https://business.example/", socialLinks: [], services: [], products: [], sourceReferences: ["test"],
  evidenceReferences: [], createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z",
};

test("optional image collection selects relevant public images through the existing guarded request path", async () => {
  const requested: string[] = [];
  const html = `<html><head><title>Example Café</title></head><body>
    <img alt="Example Café storefront logo" src="/logo.png">
    <img alt="private storefront photo" src="http://127.0.0.1/private.png">
    <img alt="business logo" src="https://cdn.example/logo.png?token=do-not-retain">
  </body></html>`;
  const request: RequestFn = async ({ url }, options): Promise<HttpResponseLite> => {
    requested.push(url.toString());
    assert.ok(options.acceptedContentTypes?.includes("text/html") || options.acceptedContentTypes?.includes("image/png"));
    if (url.pathname === "/") return { status: 200, headers: { "content-type": "text/html" }, body: html, truncated: false };
    if (url.pathname === "/logo.png") return { status: 200, headers: { "content-type": "image/png" }, body: "", binaryBody: new Uint8Array([137, 80, 78, 71]), truncated: false };
    throw new Error("unexpected network target");
  };
  const collector = new WebsiteEvidenceCollector({
    collectImages: true,
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request,
    nowIso: () => "2026-10-07T10:00:00.000Z",
  });

  const result = await collector.collect(business);
  assert.equal(result.status, "COLLECTED");
  assert.equal(result.records.some((record) => record.field === "title"), true);
  assert.equal(result.media?.length, 1);
  assert.equal(result.media?.[0].sourceType, "image");
  assert.equal(result.media?.[0].sourceReference, "https://business.example/logo.png");
  assert.equal(result.media?.[0].mimeType, "image/png");
  assert.equal(result.media?.[0].dataUrl.startsWith("data:image/png;base64,"), true);
  assert.equal(requested.some((url) => url.includes("127.0.0.1")), false);
  assert.equal(requested.some((url) => url.includes("token=")), false);
  assert.equal(result.records.some((record) => String(record.value).includes("menu.png")), false);
});

test("image acquisition stays disabled by default and text records remain unchanged", async () => {
  let imageRequests = 0;
  const request: RequestFn = async ({ url }) => {
    if (url.pathname !== "/") { imageRequests++; return { status: 200, headers: { "content-type": "image/png" }, body: "", binaryBody: new Uint8Array([1]), truncated: false }; }
    return { status: 200, headers: { "content-type": "text/html" }, body: "<html><head><title>Example Café</title></head><body><img alt='business logo' src='/logo.png'></body></html>", truncated: false };
  };
  const collector = new WebsiteEvidenceCollector({ resolve: async () => [{ address: "93.184.216.34", family: 4 }], request });
  const result = await collector.collect(business);
  assert.equal(result.status, "COLLECTED");
  assert.equal(result.media, undefined);
  assert.equal(imageRequests, 0);
  assert.deepEqual(result.records.map((record) => record.field), ["title"]);
});
