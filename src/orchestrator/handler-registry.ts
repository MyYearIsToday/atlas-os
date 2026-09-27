import type { OrchestrationEvent, OrchestrationEventType } from "./orchestration-types";

/**
 * Sprint 5B — Handler Registry.
 *
 * Centralizes what Sprint 5A left as a bare `Map` inside `AtlasOrchestrator`.
 * The registry's only job is bookkeeping: register, look up, and refuse to
 * silently clobber an existing registration. It holds no business logic —
 * the handlers themselves live in `real-handlers.ts`, calling the actual
 * Scout/Scoring/Audit/Mission/Finance services.
 */

export type RegisteredHandlerResult = { output: unknown; confidence?: number; nextEvent?: { type: OrchestrationEventType; payload: unknown } };

export type RegisteredHandler<T extends OrchestrationEventType = OrchestrationEventType> = (
  event: OrchestrationEvent<T>,
) => Promise<RegisteredHandlerResult>;

export class DuplicateHandlerError extends Error {
  constructor(type: OrchestrationEventType) {
    super(`A handler is already registered for "${type}". Call unregister() first, or pass { replace: true } if the replacement is intentional.`);
    this.name = "DuplicateHandlerError";
  }
}

export class MissingHandlerError extends Error {
  constructor(type: OrchestrationEventType) {
    super(`No handler is registered for "${type}".`);
    this.name = "MissingHandlerError";
  }
}

export class HandlerRegistry {
  private handlers = new Map<OrchestrationEventType, RegisteredHandler<any>>();

  /**
   * Registers a handler. Throws DuplicateHandlerError if one already exists
   * for this event type, unless `options.replace` is explicitly true — a
   * handler is never silently overwritten.
   */
  register<T extends OrchestrationEventType>(
    type: T,
    handler: RegisteredHandler<T>,
    options: { replace?: boolean } = {},
  ): void {
    if (this.handlers.has(type) && !options.replace) {
      throw new DuplicateHandlerError(type);
    }
    this.handlers.set(type, handler);
  }

  unregister(type: OrchestrationEventType): boolean {
    return this.handlers.delete(type);
  }

  has(type: OrchestrationEventType): boolean {
    return this.handlers.has(type);
  }

  /** Throws MissingHandlerError rather than returning undefined, so a caller that forgets to check `has()` fails loudly instead of silently no-op-ing. */
  get<T extends OrchestrationEventType>(type: T): RegisteredHandler<T> {
    const handler = this.handlers.get(type);
    if (!handler) throw new MissingHandlerError(type);
    return handler;
  }

  /** Non-throwing lookup, for callers that want to handle "no handler" as data rather than a caught exception. */
  tryGet<T extends OrchestrationEventType>(type: T): RegisteredHandler<T> | null {
    return this.handlers.get(type) ?? null;
  }

  registeredTypes(): OrchestrationEventType[] {
    return [...this.handlers.keys()];
  }
}
