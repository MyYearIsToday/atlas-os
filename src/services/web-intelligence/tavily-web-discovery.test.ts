import assert from "node:assert/strict";
import test from "node:test";
import { WebDiscoveryError } from "./provider";
import { TavilyWebDiscoveryProvider } from "./tavily-web-discovery-provider";

const TEST_KEY = "tvly-test-only-not-a-real-key";
const sampleResult = {
  title: "Atlas source",
  url: "https://example.org/source",
  content: "A short Tavily discovery snippet.",
  published_date: "2026-10-07",
  score: 0.91,
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function withKey<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.TAVILY_API_KEY;
  if (value === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = value;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = saved;
  }
}

async function expectDiscoveryError(
  run: () => Promise<unknown>,
  code: WebDiscoveryError["code"],
): Promise<WebDiscoveryError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof WebDiscoveryError);
  assert.equal(caught.code, code);
  return caught;
}

test("maps Tavily's official response shape and sends a bounded POST request", async () => {
  await withKey(TEST_KEY, async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return response({ results: [sampleResult] });
      }) as typeof fetch,
    });

    const sources = await provider.discover({ query: "Atlas public sources" });
    assert.equal(requestUrl, "https://api.tavily.com/search");
    assert.equal(requestInit?.method, "POST");
    assert.equal(new Headers(requestInit?.headers).get("authorization"), `Bearer ${TEST_KEY}`);
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      query: "Atlas public sources",
      search_depth: "basic",
      max_results: 5,
      topic: "general",
      include_answer: false,
      include_raw_content: false,
    });
    assert.deepEqual(sources, [{
      provider: "tavily",
      sourceUrl: "https://example.org/source",
      title: "Atlas source",
      snippet: "A short Tavily discovery snippet.",
      publishedAt: "2026-10-07",
      discoveryStatus: "DISCOVERED",
      verificationStatus: "UNVERIFIED",
    }]);
  });
});

test("missing API key fails without making a request", async () => {
  await withKey(undefined, async () => {
    let called = false;
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => {
        called = true;
        return response({ results: [] });
      }) as typeof fetch,
    });
    const error = await expectDiscoveryError(() => provider.discover({ query: "sources" }), "api_key_missing");
    assert.equal(error.message, "TAVILY_API_KEY is not set");
    assert.equal(called, false);
  });
});

test("non-2xx responses are reported without forwarding provider bodies", async () => {
  await withKey(TEST_KEY, async () => {
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => response({ detail: { error: `sensitive ${TEST_KEY}` } }, 500)) as typeof fetch,
    });
    const error = await expectDiscoveryError(() => provider.discover({ query: "sources" }), "upstream_http_error");
    assert.equal(error.message, "Tavily returned HTTP 500");
    assert.equal(error.message.includes(TEST_KEY), false);
  });
});

test("malformed JSON and malformed response shapes fail explicitly", async () => {
  await withKey(TEST_KEY, async () => {
    const invalidJson = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("invalid JSON"); },
      }) as unknown as Response) as typeof fetch,
    });
    const invalidShape = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => response({ results: "not-an-array" })) as typeof fetch,
    });
    assert.equal((await expectDiscoveryError(() => invalidJson.discover({ query: "sources" }), "malformed_response")).message, "Tavily returned an unparseable response");
    assert.equal((await expectDiscoveryError(() => invalidShape.discover({ query: "sources" }), "malformed_response")).message, "Tavily returned a malformed response");
  });
});

test("empty result sets remain an empty discovery list", async () => {
  await withKey(TEST_KEY, async () => {
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => response({ results: [] })) as typeof fetch,
    });
    assert.deepEqual(await provider.discover({ query: "no matching sources" }), []);
  });
});

test("429 rate limits are distinguished from network failures", async () => {
  await withKey(TEST_KEY, async () => {
    const limited = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => response({ detail: { error: "too many requests" } }, 429)) as typeof fetch,
    });
    const network = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => { throw new Error(`fetch error ${TEST_KEY}`); }) as typeof fetch,
    });
    assert.equal((await expectDiscoveryError(() => limited.discover({ query: "sources" }), "rate_limited")).message, "Tavily rate limited the request");
    const networkError = await expectDiscoveryError(() => network.discover({ query: "sources" }), "network_error");
    assert.equal(networkError.message.includes(TEST_KEY), false);
  });
});

test("timeouts abort the request and return a sanitized error", async () => {
  await withKey(TEST_KEY, async () => {
    const provider = new TavilyWebDiscoveryProvider({
      timeoutMs: 5,
      fetchImpl: ((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      })) as typeof fetch,
    });
    assert.equal((await expectDiscoveryError(() => provider.discover({ query: "sources" }), "timeout")).message, "Tavily request timed out");
  });
});

test("result counts and returned fields are bounded", async () => {
  await withKey(TEST_KEY, async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response({ results: Array.from({ length: 15 }, (_, index) => ({ ...sampleResult, title: `Source ${index + 1}` })) });
      }) as typeof fetch,
    });
    const sources = await provider.discover({ query: "sources", maxResults: 100 });
    assert.equal(requestBody?.max_results, 10);
    assert.equal(sources.length, 10);
    assert.ok(sources.every((source) => source.title.length <= 300 && source.sourceUrl.length <= 2_048 && (source.snippet?.length ?? 0) <= 2_000));
  });
});

test("Tavily outputs remain discovery, never verified or collected evidence", async () => {
  await withKey(TEST_KEY, async () => {
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => response({ results: [sampleResult] })) as typeof fetch,
    });
    const source = (await provider.discover({ query: "sources" }))[0];
    assert.equal(source.discoveryStatus, "DISCOVERED");
    assert.equal(source.verificationStatus, "UNVERIFIED");
    assert.equal("evidenceId" in source, false);
    assert.equal("confidence" in source, false);
    assert.equal("score" in source, false);
  });
});

test("provider output never contains the API key", async () => {
  await withKey(TEST_KEY, async () => {
    const provider = new TavilyWebDiscoveryProvider({
      fetchImpl: (async () => response({ results: [sampleResult] })) as typeof fetch,
    });
    const serialized = JSON.stringify(await provider.discover({ query: "sources" }));
    assert.equal(serialized.includes(TEST_KEY), false);
  });
});
