import type { AIProvider } from "../../src/workforce/provider-interface";
import type { AIJobRequest, AIProviderFailure, AIProviderResult, AIProviderSuccess, ProviderHealth } from "../../src/workforce/provider-types";
import type { WorkerRole } from "../../src/orchestrator/orchestration-types";
import { EMPLOYEES, WorkforceRegistry, type EmployeeId, type ProviderId } from "./registry";
import { detectMedia, routeTask, type ChatMessage } from "./router";
import { ProviderError, WorkforceError, WorkforceExecutor, classify, type AttemptTrace, type CallModel } from "./executor";

/**
 * Sprint 5F integration. Registered on the proxy as providerId "workforce" — the existing
 * AIProvider seam — so Sprint 5A-5E code paths ("openrouter"/"nvidia") are untouched.
 * Real HTTP still happens only inside the unchanged OpenRouterProvider/NvidiaProvider.
 */

/** Orchestrator worker role -> Atlas employee (used when no explicit employee/taskType/media is given). */
export const ROLE_TO_EMPLOYEE: Partial<Record<WorkerRole, EmployeeId>> = {
  researcher: "scout", // BusinessDiscovered
  analyst: "business_analyst", // EvidenceUpdated, ScoreCalculated
  planner: "ceo_master_planner", // AuditGenerated
  reviewer: "ceo_master_planner",
  writer: "writer",
  // finance intentionally absent: Finance data is never sent to free-tier workers.
};

export interface WorkforceMeta {
  employee: string;
  routedBy: string;
  usedFallback: boolean;
  attempts: AttemptTrace[];
}
export type WorkforceSuccess = AIProviderSuccess & { workforce: WorkforceMeta };
export type WorkforceFailure = AIProviderFailure & { workforce?: Partial<WorkforceMeta> };

const FAIL = (code: AIProviderFailure["code"], reason: string, workforce?: Partial<WorkforceMeta>): WorkforceFailure => ({
  failed: true,
  provider: "workforce",
  code,
  reason,
  ...(workforce ? { workforce } : {}),
});

/** Adapts existing providers (which never throw, and put HTTP status in `reason`) to the executor's CallModel. */
export function providerCallModel(providers: Record<string, AIProvider>): CallModel {
  return async (providerId, model, body, timeoutMs, context) => {
    const provider = providers[providerId];
    if (!provider) throw new ProviderError("bad_request", null, `provider "${providerId}" is not registered`);
    const base = context as AIJobRequest;
    const res = await provider.execute({
      ...base,
      model,
      messages: body.messages,
      maxTokens: body.max_tokens ?? base.maxTokens,
      temperature: body.temperature ?? base.temperature,
      timeoutMs,
    });
    if (!res.failed) return res;
    switch (res.code) {
      case "MISSING_API_KEY": throw new ProviderError("auth", null, "MISSING_API_KEY");
      case "TIMEOUT": throw new ProviderError("timeout", null, res.reason);
      case "NETWORK_ERROR": throw new ProviderError("network", null, res.reason);
      case "BUDGET_EXCEEDED": throw new ProviderError("bad_request", null, res.reason);
      case "INVALID_RESPONSE":
        throw new ProviderError(res.reason.startsWith("Invalid request") ? "bad_request" : "server", null, res.reason);
      default: {
        const status = Number(/HTTP (\d{3})/.exec(res.reason)?.[1]);
        throw new ProviderError(Number.isFinite(status) ? classify(status) : "server", Number.isFinite(status) ? status : null, res.reason);
      }
    }
  };
}

export class WorkforceProvider implements AIProvider {
  readonly id = "workforce" as const;

  constructor(
    public readonly registry: WorkforceRegistry,
    private executor: WorkforceExecutor,
  ) {}

  /** Wires registry + executor over the given (already-constructed) legacy providers. */
  static create(providers: Record<string, AIProvider>, registry = new WorkforceRegistry()): WorkforceProvider {
    return new WorkforceProvider(registry, new WorkforceExecutor(registry, { callModel: providerCallModel(providers) }));
  }

  resolveEmployee(request: AIJobRequest): { employee: EmployeeId; routedBy: string } | { error: string } {
    if (request.workerRole === "finance") return { error: "The finance role is never routed through free workforce models." };
    const media = request.messages ? detectMedia(request.messages as ChatMessage[]) : [];
    if (request.employee !== undefined || request.taskType !== undefined || media.length > 0) {
      try {
        const r = routeTask({ employee: request.employee, taskType: request.taskType, media });
        if (r.reason !== "default") return { employee: r.employee, routedBy: r.reason };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
    const byRole = ROLE_TO_EMPLOYEE[request.workerRole];
    return byRole ? { employee: byRole, routedBy: "worker_role" } : { employee: routeTask({}).employee, routedBy: "default" };
  }

  validate(request: AIJobRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!request.task || request.task.trim().length === 0) errors.push("task must be non-empty");
    if (request.confidenceTarget < 0 || request.confidenceTarget > 1) errors.push("confidenceTarget must be between 0 and 1");
    if (request.employee !== undefined && !(EMPLOYEES as readonly string[]).includes(request.employee)) errors.push(`unknown employee "${request.employee}"`);
    return { valid: errors.length === 0, errors };
  }

  estimateCost(): number | null { return null; }
  estimateTokens(): number | null { return null; }

  /** No network call. Reports names/booleans only — never values. */
  async healthCheck(): Promise<ProviderHealth> {
    const keys = ["OPENROUTER_API_KEY", "NVIDIA_API_KEY"].filter((k) => !process.env[k]);
    return {
      provider: this.id,
      healthy: keys.length < 2,
      reason: `catalog=${this.registry.catalogStatus} freeModels=${this.registry.catalogSize}${keys.length ? `; missing env: ${keys.join(", ")}` : ""}`,
      checkedAt: new Date().toISOString(),
    };
  }

  async execute(request: AIJobRequest): Promise<AIProviderResult> {
    const v = this.validate(request);
    if (!v.valid) return FAIL("INVALID_RESPONSE", `Invalid request: ${v.errors.join("; ")}`);
    const target = this.resolveEmployee(request);
    if ("error" in target) return FAIL(request.workerRole === "finance" ? "PROVIDER_UNAVAILABLE" : "INVALID_RESPONSE", target.error);

    const messages = (request.messages as ChatMessage[] | undefined) ?? [{ role: "user", content: request.task }];
    try {
      const r = await this.executor.execute({ employee: target.employee, messages, maxTokens: request.maxTokens, temperature: request.temperature, context: request });
      const inner = r.data as AIProviderSuccess;
      const out: WorkforceSuccess = {
        ...inner,
        provider: r.providerId as ProviderId,
        workforce: { employee: r.employee, routedBy: target.routedBy, usedFallback: r.usedFallback, attempts: r.attempts },
      };
      return out;
    } catch (e) {
      if (e instanceof WorkforceError) {
        const meta = { employee: target.employee, routedBy: target.routedBy, attempts: e.attempts };
        if (e.code === "ALL_MODELS_UNAVAILABLE") return FAIL("PROVIDER_UNAVAILABLE", e.message, meta);
        return FAIL("INVALID_RESPONSE", `${e.code}: ${e.message}`, meta);
      }
      return FAIL("PROVIDER_UNAVAILABLE", "Internal workforce error");
    }
  }

  /** Registry snapshot for the authenticated /api/ai/workforce endpoint (no secrets). */
  describe() {
    return { catalogStatus: this.registry.catalogStatus, catalogModels: this.registry.catalogSize, employees: this.registry.list() };
  }
}
