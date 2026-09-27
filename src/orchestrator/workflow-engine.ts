import { allowedTransitions, canTransition, type ScoutWorkflowState } from "../services/scout/workflow";
import type { EventBus } from "./event-bus";
import { computeEventId } from "./idempotency";

/**
 * Workflow Engine. Reuses `src/services/scout/workflow.ts`'s
 * `allowedTransitions`/`canTransition` as the single source of truth for
 * the state machine — this file does not redefine the transition graph. Its
 * only job is to attempt a transition and, if invalid, emit a
 * `WorkflowBlocked` event through the orchestrator's event bus so the
 * failure is visible and logged rather than silently ignored.
 */
export class WorkflowEngine {
  constructor(private bus: EventBus, private lineageIdFactory: () => string) {}

  async attemptTransition(
    businessId: string,
    from: ScoutWorkflowState,
    to: ScoutWorkflowState,
  ): Promise<{ succeeded: boolean; state: ScoutWorkflowState }> {
    if (canTransition(from, to)) {
      return { succeeded: true, state: to };
    }

    await this.bus.emit({
      type: "WorkflowBlocked",
      payload: {
        businessId,
        fromState: from,
        attemptedState: to,
        reason: `Invalid transition: ${from} -> ${to} is not in allowedTransitions.`,
      },
      eventId: computeEventId("WorkflowBlocked", { businessId, from, to }),
      lineageId: this.lineageIdFactory(),
      emittedAt: new Date().toISOString(),
    });

    return { succeeded: false, state: from };
  }

  possibleNextStates(from: ScoutWorkflowState): ScoutWorkflowState[] {
    return allowedTransitions[from];
  }
}
