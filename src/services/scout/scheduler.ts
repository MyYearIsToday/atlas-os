import { runScoutDiscovery, type ScoutDiscoveryDeps, type ScoutDiscoveryRunResult } from "./discovery-loop";

export type SchedulerListener = (result: ScoutDiscoveryRunResult) => void;

/** Scheduled discovery and an internal trigger share one serialized run path. */
export class ScoutScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private listeners: SchedulerListener[] = [];
  lastResult: ScoutDiscoveryRunResult | null = null;
  lastError: string | null = null;

  constructor(private deps: ScoutDiscoveryDeps) {}

  onRun(listener: SchedulerListener): void {
    this.listeners.push(listener);
  }

  async triggerNow(): Promise<ScoutDiscoveryRunResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await runScoutDiscovery(this.deps);
      this.lastResult = result;
      this.lastError = result.ok ? null : result.error ?? "discovery failed";
      for (const listener of this.listeners) listener(result);
      return result;
    } finally {
      this.running = false;
    }
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.triggerNow(), intervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.running;
  }
}