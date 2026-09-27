import type { ExecutionLogEntry } from "./orchestration-types";

/**
 * Append-only execution log. Nothing is ever edited or removed from it —
 * same "preserve history, never overwrite" principle as the Finance
 * Ledger's audit trail (src/services/finance/ledger.ts).
 */
export class ExecutionLog {
  private entries: ExecutionLogEntry[] = [];

  record(entry: ExecutionLogEntry): void {
    this.entries.push(entry);
  }

  all(): ExecutionLogEntry[] {
    return [...this.entries];
  }

  forLineage(lineageId: string): ExecutionLogEntry[] {
    return this.entries.filter((e) => e.lineageId === lineageId);
  }
}
