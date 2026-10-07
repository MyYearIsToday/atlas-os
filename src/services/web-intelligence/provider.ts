export interface WebDiscoveryQuery {
  query: string;
  maxResults?: number;
}

/**
 * A public source returned by discovery, not Atlas evidence. Downstream
 * verification must independently inspect the source before treating it as
 * authoritative or collected.
 */
export interface DiscoveredWebSource {
  provider: "tavily";
  sourceUrl: string;
  title: string;
  snippet?: string;
  publishedAt?: string;
  discoveryStatus: "DISCOVERED";
  verificationStatus: "UNVERIFIED";
}

export interface WebDiscoveryProvider {
  discover(input: WebDiscoveryQuery): Promise<DiscoveredWebSource[]>;
}

export type WebDiscoveryErrorCode =
  | "invalid_query"
  | "api_key_missing"
  | "rate_limited"
  | "upstream_http_error"
  | "malformed_response"
  | "timeout"
  | "network_error";

export class WebDiscoveryError extends Error {
  constructor(readonly code: WebDiscoveryErrorCode, message: string) {
    super(message);
    this.name = "WebDiscoveryError";
  }
}
