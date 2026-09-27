import type { RetryOutcome, RetryPolicy } from "./orchestration-types";

/**
 * Deterministic exponential backoff (no jitter/randomness, per Sprint 5A's
 * "never use randomness" requirement extended to retries as well). Failures
 * that exhaust retries are never silently discarded — they land in the
 * dead-letter queue for human/Scout follow-up via the Mission Queue.
 */
export function computeBackoff(attempt: number, policy: RetryPolicy): RetryOutcome {
  const exhausted = attempt >= policy.maxRetries;
  const delayMs = policy.baseDelayMs * Math.pow(policy.backoffFactor, Math.max(0, attempt - 1));
  return { attempt, delayMs, exhausted };
}

export interface DeadLetter {
  lineageId: string;
  serviceInvoked: string;
  reason: string;
  attempts: number;
  recordedAt: string;
}

export class RetryManager {
  private deadLetters: DeadLetter[] = [];

  constructor(private policy: RetryPolicy) {}

  /**
   * Runs `task` up to `policy.maxRetries` times. Does not sleep for real —
   * callers (or tests) can inspect the returned delay schedule; this keeps
   * the manager deterministic and testable without fake timers.
   */
  async execute<T>(
    lineageId: string,
    serviceInvoked: string,
    task: (attempt: number) => Promise<T>,
  ): Promise<{ result: T | null; attempts: number; succeeded: boolean; delays: number[] }> {
    const delays: number[] = [];
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.policy.maxRetries; attempt++) {
      try {
        const result = await task(attempt);
        return { result, attempts: attempt, succeeded: true, delays };
      } catch (error) {
        lastError = error;
        const backoff = computeBackoff(attempt, this.policy);
        delays.push(backoff.delayMs);
        if (backoff.exhausted) break;
      }
    }

    this.deadLetters.push({
      lineageId,
      serviceInvoked,
      reason: lastError instanceof Error ? lastError.message : String(lastError),
      attempts: this.policy.maxRetries,
      recordedAt: new Date().toISOString(),
    });

    return { result: null, attempts: this.policy.maxRetries, succeeded: false, delays };
  }

  getDeadLetters(): DeadLetter[] {
    return [...this.deadLetters];
  }
}
