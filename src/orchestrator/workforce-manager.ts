import type { OrchestrationConfig, ProviderConfig, WorkerRole, WorkforceAssignment } from "./orchestration-types";
import type { AgentId } from "../agents";

/**
 * Workforce Manager — provider-agnostic worker selection.
 *
 * Per Sprint 5A: no provider is hardcoded, and no real model call is made
 * here. This module decides *which* configured provider/tier should handle
 * a step and *when* to escalate; the actual execution function is supplied
 * by the caller (dependency injection via `executeWithEscalation`'s `run`
 * parameter). This keeps the orchestrator honest about not having real AI
 * execution yet (ATLAS.md § Engineering Standards: "never fake
 * functionality" / "if an AI execution provider is not connected, the UI
 * must say so").
 */

/**
 * WorkerRole is a task-execution role, not an Atlas AI employee. This maps
 * a role to the employee most likely to own that kind of work, for
 * logging/attribution purposes only — it does not replace AI_REGISTRY.md
 * or the AgentId hierarchy.
 */
const workerRoleToAgent: Record<WorkerRole, AgentId> = {
  planner: "operator",
  researcher: "scout",
  reviewer: "closer",
  analyst: "builder",
  finance: "finance",
  writer: "builder",
};

export function agentForWorkerRole(role: WorkerRole): AgentId {
  return workerRoleToAgent[role];
}

export interface EscalationResult<T> {
  assignment: WorkforceAssignment;
  output: T | null;
  confidence: number | null;
  succeeded: boolean;
  /** True only when acceptance happened via acceptUnknownConfidenceOnSuccess rather than a real confidence >= threshold match — logged distinctly, never conflated with a confidence-verified success. */
  acceptedOnUnknownConfidence: boolean;
}

export class WorkforceManager {
  constructor(private config: OrchestrationConfig) {}

  private providersFor(role: WorkerRole): ProviderConfig[] {
    const providers = this.config.providers[role];
    if (!providers || providers.length === 0) {
      throw new Error(`No providers configured for worker role "${role}"`);
    }
    return providers;
  }

  /**
   * Runs `run` against providers for `role`, cheapest first. Per the
   * escalation policy: retries once on the same tier, then escalates to
   * the next configured tier only if confidence stays below that tier's
   * threshold. Never uses randomness in tier/order selection.
   */
  async executeWithEscalation<T>(
    role: WorkerRole,
    run: (provider: ProviderConfig, attempt: number) => Promise<{ output: T; confidence: number; confidenceKnown?: boolean; executionSucceeded?: boolean }>,
  ): Promise<EscalationResult<T>> {
    const providers = this.providersFor(role);
    let attempt = 0;

    for (let tier = 0; tier < providers.length; tier++) {
      const provider = providers[tier];
      const attemptsOnTier = this.config.escalationPolicy.attemptsBeforeEscalation;

      for (let tierAttempt = 1; tierAttempt <= attemptsOnTier; tierAttempt++) {
        attempt++;
        try {
          const { output, confidence, confidenceKnown = true, executionSucceeded = true } = await run(provider, attempt);

          if (confidenceKnown && confidence >= provider.confidenceThreshold) {
            return { assignment: { role, provider, attempt, escalated: tier > 0 }, output, confidence, succeeded: true, acceptedOnUnknownConfidence: false };
          }
          // Sprint 5D fix (5C-04): a real provider that succeeded but can't
          // self-report confidence is not the same as a low-confidence or
          // failed run. `executionSucceeded` must be explicitly true — a
          // caller that never sets it defaults to true for backward
          // compatibility with Sprint 5A/5C stub handlers, but any real
          // failure must report executionSucceeded: false to keep this
          // path from ever accepting a genuine error.
          if (executionSucceeded && !confidenceKnown && provider.acceptUnknownConfidenceOnSuccess) {
            return { assignment: { role, provider, attempt, escalated: tier > 0 }, output, confidence, succeeded: true, acceptedOnUnknownConfidence: true };
          }
          // Confidence too low (or unknown and not opted in), or a failed run: retry, then escalate.
        } catch {
          // Execution failure: retry on this tier, then escalate. Terminal
          // failure after all tiers is reported to the caller, not thrown,
          // so the orchestrator can log it and hand off to RetryManager's
          // dead-letter queue rather than crash the event handler.
        }
      }
    }

    const lastProvider = providers[providers.length - 1];
    return {
      assignment: { role, provider: lastProvider, attempt, escalated: providers.length > 1 },
      output: null,
      confidence: null,
      succeeded: false,
      acceptedOnUnknownConfidence: false,
    };
  }
}
