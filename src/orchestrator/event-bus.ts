import type { EventHandler, OrchestrationEvent, OrchestrationEventType } from "./orchestration-types";

/**
 * Lightweight internal event bus. Deterministic: handlers for a given event
 * type run in the exact order they subscribed, and emit() awaits every
 * handler in sequence (not Promise.all) so ordering never depends on
 * timing. No external transport — in-process only.
 */
export class EventBus {
  private handlers = new Map<OrchestrationEventType, EventHandler<any>[]>();

  subscribe<T extends OrchestrationEventType>(type: T, handler: EventHandler<T>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => this.unsubscribe(type, handler);
  }

  unsubscribe<T extends OrchestrationEventType>(type: T, handler: EventHandler<T>): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const next = list.filter((h) => h !== handler);
    this.handlers.set(type, next);
  }

  async emit<T extends OrchestrationEventType>(event: OrchestrationEvent<T>): Promise<void> {
    const list = this.handlers.get(event.type) ?? [];
    for (const handler of list) {
      await handler(event);
    }
  }

  listenerCount(type: OrchestrationEventType): number {
    return this.handlers.get(type)?.length ?? 0;
  }
}
