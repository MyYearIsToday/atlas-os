import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createAiProxyServer } from "./ai-proxy-server";
import { TavilyWebDiscoveryProvider } from "../src/services/web-intelligence/tavily-web-discovery-provider";

const TEST_KEY = "tvly-test-only-not-a-real-key";

test("bounded web-intelligence route validates input and never returns or logs the API key", async () => {
  const savedKey = process.env.TAVILY_API_KEY;
  const savedSecret = process.env.ATLAS_PROXY_SHARED_SECRET;
  process.env.TAVILY_API_KEY = TEST_KEY;
  delete process.env.ATLAS_PROXY_SHARED_SECRET;

  let capturedInit: RequestInit | undefined;
  let fetchCalls = 0;
  const provider = new TavilyWebDiscoveryProvider({
    fetchImpl: (async (_input, init) => {
      fetchCalls++;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            title: "Public source",
            url: "https://example.org/public-source",
            content: "Discovery snippet only.",
          }],
        }),
      } as Response;
    }) as typeof fetch,
  });
  const server = createAiProxyServer({} as never, provider);
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
  console.warn = (...args: unknown[]) => { logs.push(args.join(" ")); };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/web-intelligence/search`;

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "   " }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(fetchCalls, 0);

    const malformed = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal(fetchCalls, 0);

    const unrestricted = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "public sources", url: "https://other.example" }),
    });
    assert.equal(unrestricted.status, 400);
    assert.equal(fetchCalls, 0);

    const result = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "public sources", maxResults: 100 }),
    });
    assert.equal(result.status, 200);
    const payload = await result.json() as Record<string, unknown>;
    assert.equal(payload.discoveryStatus, "DISCOVERED");
    assert.equal(payload.verificationStatus, "UNVERIFIED");
    assert.equal((payload.sources as Array<Record<string, unknown>>)[0]?.sourceUrl, "https://example.org/public-source");
    assert.equal(JSON.stringify(payload).includes(TEST_KEY), false);
    assert.equal(new Headers(capturedInit?.headers).get("authorization"), `Bearer ${TEST_KEY}`);
    assert.equal(JSON.parse(String(capturedInit?.body)).max_results, 10);
    assert.equal(logs.join("\n").includes(TEST_KEY), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (savedKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = savedKey;
    if (savedSecret === undefined) delete process.env.ATLAS_PROXY_SHARED_SECRET;
    else process.env.ATLAS_PROXY_SHARED_SECRET = savedSecret;
  }
});
