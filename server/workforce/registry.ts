/**
 * Sprint 5F – AI Workforce Registry (new module; layered on Sprint 5E, touches no existing file).
 *
 * Fixed models (verified IDs supplied by the owner):
 *   - CEO / Master Planner ........ NVIDIA_ULTRA
 *   - Vision & Document Specialist  NVIDIA_OMNI
 * Only hard-coded OpenRouter model: "openrouter/free". Everything else is picked at
 * runtime from GET https://openrouter.ai/api/v1/models, keeping strictly zero-priced models.
 *
 * The catalog has no speed/quality/category fields, so "fastest", "strongest" and "coding" are
 * documented HEURISTICS (see comparators below), not measurements. Runtime latency stats in
 * executor.ts refine "fastest" after real traffic.
 */

export const NVIDIA_ULTRA = "nvidia/nemotron-3-ultra-550b-a55b" as const;
export const NVIDIA_OMNI = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" as const;
export const OPENROUTER_FREE_ROUTER = "openrouter/free" as const;
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export const PROVIDER_IDS = ["openrouter", "nvidia"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const EMPLOYEES = [
  "ceo_master_planner",
  "scout",
  "business_analyst",
  "mission_router",
  "fast_worker",
  "coding_engineer",
  "writer",
  "vision_employee",
  "document_analyst",
  "future_falconfx_worker",
] as const;
export type EmployeeId = (typeof EMPLOYEES)[number];

export type Modality = "text" | "image" | "audio" | "video" | "file";
const MODALITIES: readonly Modality[] = ["text", "image", "audio", "video", "file"];

export interface CatalogModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string; [k: string]: unknown };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
}

export interface Candidate {
  id: string;
  contextLength: number;
  inputModalities: Modality[];
  tools: boolean;
  reasoning: boolean;
  codingHint: boolean;
  fastHint: boolean;
  paramsB: number | null;
}

export interface ChainItem {
  providerId: ProviderId;
  model: string;
  inputModalities: Modality[];
}

export interface WorkerEntry {
  employee: EmployeeId;
  providerId: ProviderId;
  model: string | null;
  source: "fixed" | "dynamic" | "static-fallback" | "disabled";
  /** Final escalation model id (last element of chain). */
  fallback: string | null;
  chain: ChainItem[];
  capabilities: { inputModalities: Modality[]; contextLength: number | null; tools: boolean; reasoning: boolean };
  enabled: boolean;
  speedSensitive: boolean;
  note?: string;
}

// ---------- catalog filtering ----------

/** Strict spec: pricing.prompt === "0" AND pricing.completion === "0" (OpenRouter returns strings). */
export function isZeroPriced(m: CatalogModel): boolean {
  return m.pricing?.prompt === "0" && m.pricing?.completion === "0";
}

const EXCLUDE_NAME = /(guard|safety|rerank|embed|moderation)/i;
const CODING = /(\bcod(e|er|ing)\b|\bswe\b|software engineering)/i;
const FAST = /(flash|lightning|nano|mini|lite|small|fast|turbo|instant)/i;

function paramsB(id: string): number | null {
  const active = /a(\d+(?:\.\d+)?)b/i.exec(id); // e.g. "30b-a3b" -> 3 (active params)
  if (active) return Number(active[1]);
  const total = /(\d+(?:\.\d+)?)b(?![a-z])/i.exec(id);
  return total ? Number(total[1]) : null;
}

export function toCandidate(m: CatalogModel): Candidate | null {
  if (!m?.id || !isZeroPriced(m)) return null;
  if (m.id.startsWith("openrouter/")) return null; // routers are handled explicitly, never ranked
  const label = `${m.id} ${m.name ?? ""}`;
  if (EXCLUDE_NAME.test(label)) return null;
  const inputs = (m.architecture?.input_modalities ?? []).filter((x): x is Modality =>
    (MODALITIES as readonly string[]).includes(x),
  );
  const outputs = m.architecture?.output_modalities;
  if (!inputs.includes("text")) return null;
  if (outputs && !outputs.includes("text")) return null;
  const sp = m.supported_parameters ?? [];
  return {
    id: m.id,
    contextLength: typeof m.context_length === "number" ? m.context_length : 0,
    inputModalities: inputs,
    tools: sp.includes("tools"),
    reasoning: sp.includes("reasoning") || sp.includes("include_reasoning"),
    codingHint: CODING.test(`${label} ${m.description ?? ""}`),
    fastHint: FAST.test(label),
    paramsB: paramsB(m.id),
  };
}

const b2n = (x: boolean) => Number(x);
const strongest = (a: Candidate, b: Candidate) =>
  b2n(b.reasoning) - b2n(a.reasoning) || b2n(b.tools) - b2n(a.tools) || b.contextLength - a.contextLength || a.id.localeCompare(b.id);
const longest = (a: Candidate, b: Candidate) =>
  b.contextLength - a.contextLength || b2n(b.reasoning) - b2n(a.reasoning) || a.id.localeCompare(b.id);
const fastest = (a: Candidate, b: Candidate) => {
  const pa = a.paramsB ?? Number.POSITIVE_INFINITY;
  const pb = b.paramsB ?? Number.POSITIVE_INFINITY;
  const byParams = pa === pb ? 0 : pa < pb ? -1 : 1;
  return b2n(b.fastHint) - b2n(a.fastHint) || byParams || b2n(b.tools) - b2n(a.tools) || a.id.localeCompare(b.id);
};

// ---------- registry construction ----------

const ultraItem: ChainItem = { providerId: "nvidia", model: NVIDIA_ULTRA, inputModalities: ["text"] };
const freeRouterItem: ChainItem = { providerId: "openrouter", model: OPENROUTER_FREE_ROUTER, inputModalities: ["text"] };
const omniItem: ChainItem = { providerId: "nvidia", model: NVIDIA_OMNI, inputModalities: ["text", "image", "audio", "video"] };
const item = (c: Candidate): ChainItem => ({ providerId: "openrouter", model: c.id, inputModalities: c.inputModalities });

function dedupe(chain: ChainItem[]): ChainItem[] {
  const seen = new Set<string>();
  return chain.filter((c) => (seen.has(`${c.providerId}:${c.model}`) ? false : (seen.add(`${c.providerId}:${c.model}`), true)));
}

function entry(
  employee: EmployeeId,
  chain: ChainItem[],
  source: WorkerEntry["source"],
  extra: Partial<WorkerEntry> = {},
): WorkerEntry {
  const c = dedupe(chain);
  const head = c[0]!;
  return {
    employee,
    providerId: head.providerId,
    model: head.model,
    source,
    fallback: c[c.length - 1]!.model,
    chain: c,
    capabilities: { inputModalities: head.inputModalities, contextLength: null, tools: false, reasoning: false },
    enabled: true,
    speedSensitive: false,
    ...extra,
  };
}

function fromCandidate(c: Candidate) {
  return { inputModalities: c.inputModalities, contextLength: c.contextLength, tools: c.tools, reasoning: c.reasoning };
}

/** Pure function: catalog snapshot (or null if unreachable) -> full workforce. */
export function buildWorkforce(catalog: CatalogModel[] | null): WorkerEntry[] {
  const pool = (catalog ?? []).map(toCandidate).filter((c): c is Candidate => c !== null);
  const text = pool;
  const multimodal = pool.filter((c) => c.inputModalities.includes("image")).sort(strongest);
  const used = new Set<string>();

  const pickText = (sorted: Candidate[]): { head: Candidate | null; alts: Candidate[] } => {
    const head = sorted.find((c) => !used.has(c.id)) ?? sorted[0] ?? null; // spread rate limits across workers
    if (head) used.add(head.id);
    return { head, alts: sorted.filter((c) => c.id !== head?.id).slice(0, 2) };
  };

  const textWorker = (employee: EmployeeId, sorted: Candidate[], speedSensitive = false): WorkerEntry => {
    const { head, alts } = pickText(sorted);
    if (!head) {
      return entry(employee, [freeRouterItem, ultraItem], "static-fallback", {
        speedSensitive,
        note: "No zero-priced text model in catalog; using openrouter/free then NVIDIA Ultra.",
      });
    }
    return entry(employee, [item(head), ...alts.map(item), freeRouterItem, ultraItem], "dynamic", {
      capabilities: fromCandidate(head),
      speedSensitive,
    });
  };

  const scout = textWorker("scout", [...text].sort(strongest));
  const analyst = textWorker("business_analyst", [...text].sort(strongest));
  const writer = textWorker("writer", [...text].sort(longest));
  const fast = textWorker("fast_worker", [...text].sort(fastest), true);
  const router = textWorker("mission_router", [...text].sort(fastest), true);

  const codingPool = text.filter((c) => c.codingHint).sort(strongest);
  const coder = codingPool.length
    ? (() => {
        const head = codingPool[0]!;
        return entry("coding_engineer", [item(head), ...codingPool.slice(1, 3).map(item), ultraItem], "dynamic", {
          capabilities: fromCandidate(head),
        });
      })()
    : entry("coding_engineer", [ultraItem], "static-fallback", {
        note: "No free coding model detected; falling back to NVIDIA Ultra.",
      });

  const visionFallbacks = multimodal.slice(0, 2).map(item);
  const omniCaps = { inputModalities: ["text", "image", "audio", "video"] as Modality[], contextLength: 256000, tools: true, reasoning: true };
  // contextLength 256000 = OpenRouter listing of the free Omni variant; NVIDIA-side limit not independently verified.
  const vision = entry("vision_employee", [omniItem, ...visionFallbacks], "fixed", { capabilities: omniCaps });
  const docs = entry("document_analyst", [omniItem, ...visionFallbacks], "fixed", { capabilities: omniCaps });

  const ceo = entry(
    "ceo_master_planner",
    [
      { providerId: "nvidia", model: NVIDIA_ULTRA, inputModalities: ["text"] },
      ...[...text].sort(strongest).slice(0, 1).map(item),
      freeRouterItem,
    ],
    "fixed",
    { capabilities: { inputModalities: ["text"], contextLength: 1000000, tools: true, reasoning: true } },
  );
  // contextLength 1,000,000 = OpenRouter listing of the free Ultra variant.

  const falcon: WorkerEntry = {
    employee: "future_falconfx_worker",
    providerId: "openrouter",
    model: null,
    source: "disabled",
    fallback: null,
    chain: [],
    capabilities: { inputModalities: ["text"], contextLength: null, tools: false, reasoning: false },
    enabled: false,
    speedSensitive: false,
    note: "Placeholder. No spec provided; not routable until configured.",
  };

  return [ceo, scout, analyst, router, fast, coder, writer, vision, docs, falcon];
}

// ---------- runtime registry ----------

export interface RegistryDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export class WorkforceRegistry {
  private entries = new Map<EmployeeId, WorkerEntry>();
  catalogStatus: "ok" | "unavailable" | "pending" = "pending";
  catalogSize = 0;
  snapshot: CatalogModel[] | null = null;
  private lastRefreshRequest = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: RegistryDeps = {}) {
    this.apply(null);
  }

  private apply(catalog: CatalogModel[] | null) {
    this.snapshot = catalog;
    this.catalogSize = catalog?.length ?? 0;
    this.entries = new Map(buildWorkforce(catalog).map((e) => [e.employee, e]));
  }

  /** Never throws: on failure keeps/creates the static registry so the server still boots. */
  async refresh(): Promise<void> {
    const f = this.deps.fetchImpl ?? fetch;
    try {
      const res = await f(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(this.deps.timeoutMs ?? 10000) });
      if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
      const body = (await res.json()) as { data?: CatalogModel[] };
      if (!Array.isArray(body.data)) throw new Error("catalog shape");
      this.apply(body.data);
      this.catalogStatus = "ok";
    } catch {
      if (this.catalogStatus !== "ok") this.catalogStatus = "unavailable"; // keep last good registry otherwise
    }
  }

  /** Debounced (60s) refresh, used when a model disappears (404). */
  requestRefresh(): void {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.lastRefreshRequest < 60000) return;
    this.lastRefreshRequest = now;
    void this.refresh();
  }

  startAutoRefresh(everyMs = 6 * 60 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), everyMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  get(employee: string): WorkerEntry | undefined {
    return this.entries.get(employee as EmployeeId);
  }
  list(): WorkerEntry[] {
    return EMPLOYEES.map((e) => this.entries.get(e)!).filter(Boolean);
  }
  static async create(deps: RegistryDeps = {}): Promise<WorkforceRegistry> {
    const r = new WorkforceRegistry(deps);
    await r.refresh();
    return r;
  }
}

// ---------- validation ----------

export interface Check { name: string; pass: boolean; detail?: string }

export function verifyRegistry(reg: WorkforceRegistry): Check[] {
  const checks: Check[] = [];
  const list = reg.list();
  const byId = new Map((reg.snapshot ?? []).map((m) => [m.id, m]));
  const fixed = (e: EmployeeId) => reg.get(e);

  checks.push({ name: "CEO model is exact verified NVIDIA Ultra ID", pass: fixed("ceo_master_planner")?.model === "nvidia/nemotron-3-ultra-550b-a55b" });
  checks.push({ name: "Vision model is exact verified NVIDIA Omni ID", pass: fixed("vision_employee")?.model === "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" });
  checks.push({ name: "Document analyst uses NVIDIA Omni", pass: fixed("document_analyst")?.model === NVIDIA_OMNI });
  checks.push({ name: "All 10 employees present", pass: list.length === EMPLOYEES.length });
  checks.push({ name: "All providerIds valid", pass: list.every((e) => (PROVIDER_IDS as readonly string[]).includes(e.providerId) && e.chain.every((c) => (PROVIDER_IDS as readonly string[]).includes(c.providerId))) });

  const dyn = list.flatMap((e) => e.chain.filter((c) => c.providerId === "openrouter" && c.model !== OPENROUTER_FREE_ROUTER).map((c) => ({ e: e.employee, c })));
  const bad = dyn.filter(({ c }) => {
    const m = byId.get(c.model);
    return !m || m.pricing?.prompt !== "0" || m.pricing?.completion !== "0";
  });
  checks.push({
    name: `Every dynamic OpenRouter model (${dyn.length} chain slots) is in the catalog with prompt=0 and completion=0`,
    pass: bad.length === 0,
    detail: bad.map((b) => `${b.e}:${b.c.model}`).join(", ") || undefined,
  });
  checks.push({ name: "Only openrouter/free is hard-coded on OpenRouter", pass: list.every((e) => e.chain.filter((c) => c.providerId === "openrouter" && !byId.has(c.model)).every((c) => c.model === OPENROUTER_FREE_ROUTER)) });
  return checks;
}
