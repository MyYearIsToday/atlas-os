import {
  PROVIDER_IDS,
  type ChainItem,
  type Modality,
  type ProviderId,
  type WorkerEntry,
} from "./registry";
import { detectMedia, type ChatMessage } from "./router";

export type ErrorKind = "rate_limit" | "auth" | "not_found" | "bad_request" | "server" | "network" | "timeout";

export class ProviderError extends Error {
  constructor(
    public kind: ErrorKind,
    public status: number | null,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type CallModel = (
  providerId: ProviderId,
  model: string,
  body: { messages: ChatMessage[]; max_tokens?: number; temperature?: number },
  timeoutMs: number,
  context?: unknown,
) => Promise<unknown>;

export interface AttemptTrace {
  providerId: ProviderId;
  model: string;
  outcome: string;
  status?: number;
  ms: number;
}

export type WorkforceErrorCode =
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_DISABLED"
  | "INVALID_PROVIDER"
  | "NO_CAPABLE_MODEL"
  | "BAD_REQUEST"
  | "ALL_MODELS_UNAVAILABLE";

export class WorkforceError extends Error {
  constructor(
    public code: WorkforceErrorCode,
    public httpStatus: number,
    message: string,
    public attempts: AttemptTrace[] = [],
  ) {
    super(message);
  }
  toJSON() {
    return { failed: true, code: this.code, reason: this.message, attempts: this.attempts };
  }
}

export interface ExecuteInput {
  employee: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Opaque caller context forwarded to callModel (e.g. the original AIJobRequest). */
  context?: unknown;
}

export interface ExecuteResult {
  ok: true;
  employee: string;
  providerId: ProviderId;
  model: string;
  usedFallback: boolean;
  attempts: AttemptTrace[];
  data: unknown;
}

export interface RegistryLike {
  get(employee: string): WorkerEntry | undefined;
  requestRefresh(): void;
}

export interface ExecutorDeps {
  callModel?: CallModel;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  requestTimeoutMs?: number;
  totalBudgetMs?: number;
  maxRateLimitWaitMs?: number;
}

const MODALITY_ERR = /(modalit|context|too long|not support|image|audio|video)/i;

export class WorkforceExecutor {
  private cooldown = new Map<string, number>();
  private latency = new Map<string, { ewma: number; n: number }>();
  private d: Required<ExecutorDeps>;

  constructor(private registry: RegistryLike, deps: ExecutorDeps = {}) {
    this.d = {
      callModel: deps.callModel ?? defaultCallModel,
      sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      now: deps.now ?? Date.now,
      random: deps.random ?? Math.random,
      requestTimeoutMs: deps.requestTimeoutMs ?? 30000,
      totalBudgetMs: deps.totalBudgetMs ?? 60000,
      maxRateLimitWaitMs: deps.maxRateLimitWaitMs ?? 8000,
    };
  }

  private key = (c: ChainItem) => `${c.providerId}:${c.model}`;
  private cooling = (c: ChainItem) => (this.cooldown.get(this.key(c)) ?? 0) > this.d.now();
  private setCooldown(c: ChainItem, ms: number) {
    this.cooldown.set(this.key(c), this.d.now() + ms);
  }
  private backoff(attempt: number) {
    return Math.round(1000 * 2 ** attempt * (0.75 + this.d.random() * 0.5));
  }
  private record(c: ChainItem, ms: number) {
    const k = this.key(c);
    const cur = this.latency.get(k);
    this.latency.set(k, cur ? { ewma: cur.ewma * 0.7 + ms * 0.3, n: cur.n + 1 } : { ewma: ms, n: 1 });
  }

  /** Order: primary stays first; for speed-sensitive workers, measured-fast alternates move up (>=3 samples). */
  private order(entry: WorkerEntry, chain: ChainItem[]): ChainItem[] {
    let list = chain;
    if (entry.speedSensitive) {
      const [head, ...rest] = chain;
      const measured = (c: ChainItem) => (this.latency.get(this.key(c))?.n ?? 0) >= 3;
      const lat = (c: ChainItem) => this.latency.get(this.key(c))!.ewma;
      const sorted = [head!, ...rest].sort((a, b) => (measured(a) && measured(b) ? lat(a) - lat(b) : 0));
      list = sorted;
    }
    // Cooling-down models go last (still tried if nothing else works, bounded by the budget).
    return [...list.filter((c) => !this.cooling(c)), ...list.filter((c) => this.cooling(c))];
  }

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    const entry = this.registry.get(input.employee);
    if (!entry) throw new WorkforceError("EMPLOYEE_NOT_FOUND", 404, `Unknown employee "${input.employee}"`);
    if (!entry.enabled) throw new WorkforceError("EMPLOYEE_DISABLED", 409, `Employee "${input.employee}" is not configured`);
    for (const c of entry.chain) {
      if (!(PROVIDER_IDS as readonly string[]).includes(c.providerId)) {
        throw new WorkforceError("INVALID_PROVIDER", 500, `Invalid providerId "${c.providerId}" in registry`);
      }
    }

    const attempts: AttemptTrace[] = [];
    const required = detectMedia(input.messages) as Modality[];
    const capable = entry.chain.filter((c) => required.every((m) => c.inputModalities.includes(m)));
    for (const c of entry.chain) {
      if (!capable.includes(c)) attempts.push({ providerId: c.providerId, model: c.model, outcome: "skipped_capability", ms: 0 });
    }
    if (capable.length === 0) {
      throw new WorkforceError("NO_CAPABLE_MODEL", 422, `No model configured for "${input.employee}" accepts: ${required.join(", ")}`, attempts);
    }

    const deadline = this.d.now() + this.d.totalBudgetMs;
    const authFailed = new Set<ProviderId>();
    const body = { messages: input.messages, max_tokens: input.maxTokens, temperature: input.temperature };

    for (const c of this.order(entry, capable)) {
      if (authFailed.has(c.providerId)) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (this.d.now() >= deadline) break;
        const t0 = this.d.now();
        try {
          const data = await this.d.callModel(c.providerId, c.model, body, this.d.requestTimeoutMs, input.context);
          const ms = this.d.now() - t0;
          this.record(c, ms);
          this.cooldown.delete(this.key(c));
          attempts.push({ providerId: c.providerId, model: c.model, outcome: "ok", ms });
          return { ok: true, employee: input.employee, providerId: c.providerId, model: c.model, usedFallback: c !== capable[0], attempts, data };
        } catch (err) {
          const e = err instanceof ProviderError ? err : new ProviderError("network", null, "unclassified provider failure");
          const ms = this.d.now() - t0;
          attempts.push({ providerId: c.providerId, model: c.model, outcome: e.kind, status: e.status ?? undefined, ms });

          if (e.kind === "rate_limit") {
            const wait = e.retryAfterMs ?? this.backoff(attempt);
            if (wait > this.d.maxRateLimitWaitMs || attempt === 2) {
              this.setCooldown(c, Math.max(wait, 30000)); // don't hammer a limited free model; escalate
              break;
            }
            await this.d.sleep(wait);
            continue;
          }
          if (e.kind === "server" || e.kind === "network" || e.kind === "timeout") {
            if (attempt === 0) {
              await this.d.sleep(this.backoff(attempt));
              continue;
            }
            this.setCooldown(c, 15000);
            break;
          }
          if (e.kind === "not_found") {
            this.setCooldown(c, 60 * 60 * 1000); // model likely retired: sideline it and re-read the catalog
            this.registry.requestRefresh();
            break;
          }
          if (e.kind === "auth") {
            authFailed.add(c.providerId); // same key would fail for every model on this provider
            break;
          }
          if (e.kind === "bad_request") {
            if (MODALITY_ERR.test(e.message)) break; // model-specific limitation: try the next model
            throw new WorkforceError("BAD_REQUEST", 400, "Provider rejected the request as invalid", attempts);
          }
        }
      }
    }
    throw new WorkforceError("ALL_MODELS_UNAVAILABLE", 503, `All models for "${input.employee}" are unavailable or rate limited`, attempts);
  }
}

// ---------- default provider caller (keys read from env here only; never logged or returned) ----------

const ENDPOINTS: Record<ProviderId, { url: string; keyEnv: string }> = {
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", keyEnv: "OPENROUTER_API_KEY" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions", keyEnv: "NVIDIA_API_KEY" },
};

export function classify(status: number): ErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 402 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
}

export const defaultCallModel: CallModel = async (providerId, model, body, timeoutMs) => {
  const ep = ENDPOINTS[providerId];
  if (!ep) throw new ProviderError("bad_request", null, "invalid providerId");
  const key = process.env[ep.keyEnv];
  if (!key) throw new ProviderError("auth", null, "PROVIDER_KEY_MISSING");
  let res: Response;
  try {
    res = await fetch(ep.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ProviderError(timedOut ? "timeout" : "network", null, timedOut ? "request timed out" : "network error");
  }
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    const text = (await res.text().catch(() => "")).slice(0, 300).split(key).join("[redacted]");
    throw new ProviderError(classify(res.status), res.status, text || `HTTP ${res.status}`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  return res.json();
};
