import { EventBus } from "./event-bus";
import { ExecutionLog } from "./execution-log";
import { RetryManager } from "./retry-manager";
import { WorkforceManager } from "./workforce-manager";
import { WorkflowEngine } from "./workflow-engine";
import { HandlerRegistry } from "./handler-registry";
import { ProcessedEventCache, computeEventId } from "./idempotency";
import { validatePayload } from "./payload-validation";
import { routeFor } from "./router";
import { checkApproval, type ApprovalContext } from "./approval-gateway";
import { defaultOrchestrationConfig } from "./orchestration-config";
import { registerRealHandlers } from "./real-handlers";
import type {
  OrchestrationConfig,
  OrchestrationEvent,
  OrchestrationEventMap,
  OrchestrationEventType,
  WorkerRole,
} from "./orchestration-types";

/**
 * Atlas Orchestrator (Sprint 5A coordination layer, Sprint 5B live wiring).
 *
 * Sprint 5A built routing/approval/retry/escalation/logging with handlers
 * registered externally. Sprint 5B wires real Scout/Scoring/Audit/Mission/
 * Finance calls (real-handlers.ts) behind a proper HandlerRegistry, adds
 * idempotency, payload validation, duration-accurate logging, and
 * automatic event chaining where a handler's real output honestly supplies
 * the next event's payload. See DECISION_LOG.md, 2026-09-18 and 2026-09-19.
 */

let lineageCounter = 0;
function nextLineageId(): string {
  lineageCounter += 1;
  return `lineage-${Date.now()}-${lineageCounter}`;
}

export class AtlasOrchestrator {
  readonly bus = new EventBus();
  readonly log = new ExecutionLog();
  readonly retryManager: RetryManager;
  readonly workforceManager: WorkforceManager;
  readonly workflowEngine: WorkflowEngine;
  readonly registry = new HandlerRegistry();
  readonly processedEvents: ProcessedEventCache;

  constructor(private config: OrchestrationConfig = defaultOrchestrationConfig, wireRealHandlers = true) {
    this.retryManager = new RetryManager(config.retryPolicy);
    this.workforceManager = new WorkforceManager(config);
    this.workflowEngine = new WorkflowEngine(this.bus, nextLineageId);
    this.processedEvents = new ProcessedEventCache(config.idempotencyPolicy.ttlMs);
    if (wireRealHandlers) registerRealHandlers(this.registry, config);
  }

  /**
   * Emits and dispatches an event through the router. `eventId` defaults to
   * a deterministic hash of type+payload (see idempotency.ts) when omitted.
   * `approval` must be supplied explicitly for any non-Auto route; omitting
   * it is always treated as "not yet approved."
   */
  async dispatch<T extends OrchestrationEventType>(
    type: T,
    payload: OrchestrationEventMap[T],
    options: {
      approval?: Pick<ApprovalContext, "approvedByHuman" | "approvedByCeo">;
      eventId?: string;
      lineageId?: string;
    } = {},
  ): Promise<void> {
    const lineageId = options.lineageId ?? nextLineageId();
    const eventId = options.eventId ?? computeEventId(type, payload);
    const event: OrchestrationEvent<T> = { type, payload, eventId, lineageId, emittedAt: new Date().toISOString() };
    const route = routeFor(type);

    // 1. Idempotency — a duplicate event never re-executes the handler.
    if (this.processedEvents.hasProcessed(eventId)) {
      this.record(event, route.serviceInvoked, route.workerRole, "DUPLICATE", 0, null);
      return;
    }

    // 2. Handler enable/disable kill switch.
    if (this.config.handlerEnabled[type] === false) {
      this.record(event, route.serviceInvoked, route.workerRole, "DISABLED", 0, null);
      return;
    }

    await this.bus.emit(event);

    // 3. Approval Engine — never bypassed.
    const approvalResult = checkApproval({
      level: route.approvalLevel,
      approvedByHuman: options.approval?.approvedByHuman ?? false,
      approvedByCeo: options.approval?.approvedByCeo ?? false,
    });
    if (!approvalResult.allowed) {
      this.record(event, route.serviceInvoked, route.workerRole, "BLOCKED", 0, null);
      return;
    }

    // 4. Payload validation — reject before executing, never fabricate.
    const validation = validatePayload(event);
    if (!validation.valid) {
      this.record(event, route.serviceInvoked, route.workerRole, "INVALID_PAYLOAD", 0, null);
      return;
    }

    // 5. Handler lookup.
    const handler = this.registry.tryGet(type);
    if (!handler) {
      this.record(event, route.serviceInvoked, route.workerRole, "FAILURE", 0, null);
      return;
    }

    // 6. Execute — via WorkforceManager (worker-routed, with escalation) or
    //    RetryManager (deterministic service calls), each with real timing.
    let nextEvent: { type: OrchestrationEventType; payload: unknown } | undefined;

    if (route.workerRole) {
      const started = performance.now();
      const result = await this.workforceManager.executeWithEscalation(route.workerRole, async () => {
        const handlerResult = await handler(event);
        nextEvent = handlerResult.nextEvent;
        return { output: handlerResult.output, confidence: handlerResult.confidence ?? 1 };
      });
      const durationMs = Math.round(performance.now() - started);
      this.record(event, route.serviceInvoked, route.workerRole, result.succeeded ? "SUCCESS" : "FAILURE", result.assignment.attempt - 1, durationMs);
      if (result.succeeded) this.processedEvents.markProcessed(eventId);
    } else {
      const started = performance.now();
      const retryResult = await this.retryManager.execute(lineageId, route.serviceInvoked, async () => {
        const handlerResult = await handler(event);
        nextEvent = handlerResult.nextEvent;
        return handlerResult.output;
      });
      const durationMs = Math.round(performance.now() - started);
      const outcome = retryResult.succeeded ? "SUCCESS" : retryResult.attempts > 1 ? "DEAD_LETTERED" : "FAILURE";
      this.record(event, route.serviceInvoked, route.workerRole, outcome, retryResult.attempts - 1, durationMs);
      if (retryResult.succeeded) this.processedEvents.markProcessed(eventId);
    }

    // 7. Auto-chain — only when the handler honestly supplied a next event
    //    from its own real output (see real-handlers.ts's comments on why
    //    some steps deliberately do not chain).
    if (nextEvent) {
      await this.dispatch(nextEvent.type, nextEvent.payload as OrchestrationEventMap[typeof nextEvent.type]);
    }
  }

  private record(
    event: OrchestrationEvent<any>,
    serviceInvoked: string,
    worker: WorkerRole | null,
    outcome: "SUCCESS" | "FAILURE" | "BLOCKED" | "RETRIED" | "DEAD_LETTERED" | "DUPLICATE" | "INVALID_PAYLOAD" | "DISABLED",
    retryCount: number,
    durationMs: number | null,
  ): void {
    this.log.record({
      eventId: event.eventId,
      lineageId: event.lineageId,
      timestamp: new Date().toISOString(),
      event: event.type,
      worker,
      serviceInvoked,
      outcome,
      retryCount,
      durationMs,
    });
  }
}
