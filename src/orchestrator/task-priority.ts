import type { TaskPriority } from "../services/mission-queue";
import type { TaskPriorityInput } from "./orchestration-types";

/**
 * Deterministic priority ordering. No randomness anywhere in this file —
 * ties are broken by a fixed, documented rule (see comparePriority), not by
 * insertion order or Math.random().
 */

const urgencyWeight: Record<TaskPriority, number> = { Critical: 100, High: 70, Medium: 40, Low: 15 };

function daysUntil(dueDate: string | null, now: string): number | null {
  if (!dueDate) return null;
  const diffMs = new Date(dueDate).getTime() - new Date(now).getTime();
  return diffMs / 86_400_000;
}

/**
 * Returns a single deterministic score, higher = more urgent/valuable.
 * Weights: 35% opportunity score, 25% commercial value (normalized to a
 * 0-100-ish band via log dampening so a single huge deal doesn't swamp
 * everything else), 25% mission urgency tier, 15% due-date proximity.
 * Missing inputs contribute 0, never an assumed average — consistent with
 * Sprint 4A/4B's "do not invent a value for missing evidence."
 */
export function computeTaskPriority(input: TaskPriorityInput): number {
  const now = input.now ?? new Date().toISOString();

  const opportunityComponent = (input.opportunityScore ?? 0) * 0.35;

  const commercialValueComponent = input.commercialValue
    ? Math.min(100, Math.log10(input.commercialValue + 1) * 20) * 0.25
    : 0;

  const urgencyComponent = urgencyWeight[input.missionUrgency] * 0.25;

  const days = daysUntil(input.dueDate, now);
  const dueDateComponent = days === null
    ? 0
    : Math.max(0, 100 - Math.min(100, Math.max(0, days) * 10)) * 0.15;

  return Math.round((opportunityComponent + commercialValueComponent + urgencyComponent + dueDateComponent) * 100) / 100;
}

/** Deterministic comparator for sorting: higher priority first, then earlier due date, then lexical id as a final fixed tiebreaker. */
export function comparePriority(
  a: { priority: number; dueDate: string | null; id: string },
  b: { priority: number; dueDate: string | null; id: string },
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  return a.id.localeCompare(b.id);
}
