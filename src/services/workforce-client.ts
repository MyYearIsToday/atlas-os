import { z } from 'zod';
import { classifyFailure, readSignal, type Signal } from './command-center';
import type { RegistryEmployee, WorkforceMission } from './workforce-view';

const count = z.number().int().nonnegative();

export const workforceEmployeeSchema = z.object({
  employee: z.string(),
  enabled: z.boolean(),
  source: z.string(),
  providerId: z.string(),
  model: z.string().nullable(),
  fallback: z.string().nullable(),
  note: z.string().optional(),
});

export const workforceBoardSchema = z.object({
  catalogStatus: z.enum(['ok', 'pending', 'unavailable']),
  catalogModels: count,
  employees: z.array(workforceEmployeeSchema),
});

export const workforceMissionSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  status: z.string(),
  approvalRequired: z.string(),
  createdAt: z.string().optional(),
  lastFailureReason: z.string().nullable().optional(),
  businessId: z.string().nullable().optional(),
  missionType: z.string().nullable().optional(),
  retryCount: count.optional(),
  completedAt: z.string().nullable().optional(),
  attempts: count.optional(),
  version: z.string().min(1).optional(),
});

export const missionsPageSchema = z.object({
  items: z.array(workforceMissionSchema),
  nextCursor: z.string().nullable(),
});

export const decisionItemSchema = z.object({
  decisionId: z.string(),
  type: z.string(),
  createdAt: z.string(),
  reason: z.string().optional(),
  approvalRequirement: z.string().optional(),
  execution: z.object({ outcome: z.string() }).nullable().optional(),
});

export const decisionsPageSchema = z.object({
  items: z.array(decisionItemSchema),
  nextCursor: z.string().nullable(),
});

export const autonomyStatusSchema = z.object({
  autonomy: z.object({
    enabled: z.boolean(),
    schedulerStarted: z.boolean(),
    cycleRunning: z.boolean(),
    missionExecutionEnabled: z.boolean(),
  }),
  counts: z.object({ approvals: count }).passthrough(),
});

export const healthBoardSchema = z.object({
  providers: z.array(z.object({ provider: z.string(), healthy: z.boolean() })),
});

export interface WorkforceBoard {
  health: Signal<z.infer<typeof healthBoardSchema>>;
  workforce: Signal<z.infer<typeof workforceBoardSchema>>;
  autonomy: Signal<z.infer<typeof autonomyStatusSchema>>;
  decisions: Signal<z.infer<typeof decisionsPageSchema>>;
  missions: Signal<z.infer<typeof missionsPageSchema>>;
}

export async function loadWorkforceBoard(base: string): Promise<WorkforceBoard> {
  const [health, workforce, autonomy, decisions, missions] = await Promise.all([
    readSignal('/api/ai/health', healthBoardSchema, base),
    readSignal('/api/ai/workforce', workforceBoardSchema, base),
    readSignal('/api/atlas/autonomy/status', autonomyStatusSchema, base),
    readSignal('/api/atlas/autonomy/decisions?limit=12', decisionsPageSchema, base),
    readSignal('/api/atlas/autonomy/missions?limit=100', missionsPageSchema, base),
  ]);
  return {
    health,
    workforce,
    autonomy,
    decisions: decisions.data?.items.length === 0 ? { ...decisions, state: 'EMPTY' } : decisions,
    missions: missions.data?.items.length === 0 ? { ...missions, state: 'EMPTY' } : missions,
  };
}

export interface ApprovalSubmission {
  ok: boolean;
  status: number;
  code?: string;
  message: string;
  idempotent?: boolean;
  outcome?: string;
}

/** Posts one typed mission approval. Does not invent success from a non-OK response. */
export async function submitMissionApproval(base: string, body: { taskId: string; actor: string; version: string }, fetchImpl: typeof fetch = fetch): Promise<ApprovalSubmission> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(`${base.replace(/\/$/, '')}/api/atlas/approvals/mission`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as { code?: unknown; message?: unknown } : null;
    const result = record.result && typeof record.result === 'object' ? record.result as { outcome?: unknown } : null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: typeof error?.code === 'string' ? error.code : classifyFailure(response.status, payload),
        message: typeof error?.message === 'string' ? error.message : 'The approval API refused this request.',
      };
    }
    return {
      ok: true,
      status: response.status,
      message: record.idempotent === true ? 'This exact approval was already recorded. Nothing new was executed.' : 'The approval API accepted the request.',
      idempotent: record.idempotent === true,
      outcome: typeof result?.outcome === 'string' ? result.outcome : undefined,
    };
  } catch {
    return { ok: false, status: 0, code: 'UNAVAILABLE', message: 'The approval API could not be reached. No approval was recorded.' };
  } finally {
    clearTimeout(timer);
  }
}

export function asMissions(signal: Signal<{ items: WorkforceMission[] }>): WorkforceMission[] | null {
  return signal.data?.items ?? null;
}

export function asEmployees(signal: Signal<{ employees: RegistryEmployee[] }>): RegistryEmployee[] | null {
  return signal.data?.employees ?? null;
}
