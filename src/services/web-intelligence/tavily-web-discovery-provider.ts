import {
  WebDiscoveryError,
  type DiscoveredWebSource,
  type WebDiscoveryProvider,
  type WebDiscoveryQuery,
} from "./provider";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2_048;
const MAX_SNIPPET_LENGTH = 2_000;

interface TavilyWebDiscoveryProviderOptions {
  /** Dependency injection for tests; the API key is never injectable. */
  fetchImpl?: typeof fetch;
  /** Dependency injection for tests; production defaults to a bounded timeout. */
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeResults(payload: unknown, limit: number): DiscoveredWebSource[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new WebDiscoveryError("malformed_response", "Tavily returned a malformed response");
  }

  const sources: DiscoveredWebSource[] = [];
  for (const item of payload.results.slice(0, limit)) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim().slice(0, MAX_TITLE_LENGTH) : "";
    const sourceUrl = normalizeSourceUrl(item.url);
    if (!title || !sourceUrl) continue;

    const snippet = typeof item.content === "string" ? item.content.trim().slice(0, MAX_SNIPPET_LENGTH) : "";
    const publishedAt = typeof item.published_date === "string" ? item.published_date.trim().slice(0, 100) : "";
    sources.push({
      provider: "tavily",
      sourceUrl,
      title,
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      discoveryStatus: "DISCOVERED",
      verificationStatus: "UNVERIFIED",
    });
  }
  return sources;
}

/**
 * Tavily is an on-demand discovery source. It does not write Scout businesses
 * or create evidence records; its returned URLs are candidates for separate
 * Atlas verification.
 */
export class TavilyWebDiscoveryProvider implements WebDiscoveryProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TavilyWebDiscoveryProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(requestedTimeout)))
      : DEFAULT_TIMEOUT_MS;
  }

  async discover(input: WebDiscoveryQuery): Promise<DiscoveredWebSource[]> {
    const query = typeof input?.query === "string" ? input.query.trim() : "";
    if (!query || query.length > MAX_QUERY_LENGTH) {
      throw new WebDiscoveryError("invalid_query", `query must contain 1–${MAX_QUERY_LENGTH} characters`);
    }

    const requestedLimit = input.maxResults ?? DEFAULT_MAX_RESULTS;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new WebDiscoveryError("invalid_query", "maxResults must be a positive integer");
    }
    const limit = Math.min(requestedLimit, MAX_RESULTS);

    // This is the only environment variable read by the provider.
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      throw new WebDiscoveryError("api_key_missing", "TAVILY_API_KEY is not set");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: limit,
          topic: "general",
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new WebDiscoveryError("rate_limited", "Tavily rate limited the request");
        }
        throw new WebDiscoveryError("upstream_http_error", `Tavily returned HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new WebDiscoveryError("malformed_response", "Tavily returned an unparseable response");
      }
      return normalizeResults(payload, limit);
    } catch (error) {
      if (error instanceof WebDiscoveryError) throw error;
      const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
      if (timedOut || controller.signal.aborted || name === "AbortError") {
        throw new WebDiscoveryError("timeout", "Tavily request timed out");
      }
      // Do not forward upstream/network error text; it may contain request details.
      throw new WebDiscoveryError("network_error", "Tavily request failed");
    } finally {
      clearTimeout(timer);
    }
  }
}
