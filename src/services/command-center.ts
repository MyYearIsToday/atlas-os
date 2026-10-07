import { z } from 'zod';

export type SignalState = 'LOADING' | 'HEALTHY' | 'EMPTY' | 'DISABLED' | 'RESTRICTED' | 'UNAVAILABLE';
export interface Signal<T> { state: SignalState; data?: T; checkedAt?: string }
const count = z.number().int().nonnegative();
export const missionSchema = z.object({ taskId: z.string(), title: z.string(), status: z.string(), approvalRequired: z.string(), createdAt: z.string().optional(), lastFailureReason: z.string().nullable().optional() });
export type Mission = z.infer<typeof missionSchema>;
export const pipelineSchema = z.object({ missionExecutionEnabled: z.boolean(), durable: z.boolean(), counts: z.object({ businesses: count, scores: count, scoresWithheld: count, audits: count, missions: count }), missions: z.array(missionSchema) });
export const healthSchema = z.object({ providers: z.array(z.object({ provider: z.string(), healthy: z.boolean(), checkedAt: z.string().optional() })), scoutDiscovery: z.object({ enabled: z.boolean() }) });
export const workforceSchema = z.object({ catalogStatus: z.enum(['ok', 'pending', 'unavailable']), catalogModels: count, employees: z.array(z.object({ employee: z.string(), enabled: z.boolean(), source: z.string(), providerId: z.string(), model: z.string().nullable(), fallback: z.string().nullable() })) });
export const autonomySchema = z.object({ autonomy: z.object({ enabled: z.boolean(), schedulerStarted: z.boolean(), cycleRunning: z.boolean(), missionExecutionEnabled: z.boolean() }), counts: z.object({ businesses: count, decisions: count, cycles: count, prospects: count, engagements: count, invoices: count, approvals: count }) });
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
export const financeSchema = z.object({ receivedRevenue: z.object({ totals: z.record(decimal), paymentCount: count }), notRevenue: z.record(z.object({ count, amount: z.record(decimal) })), invoices: z.object({ items: z.array(z.object({ invoiceId: z.string(), state: z.string() })), nextCursor: z.string().nullable() }) });
export const decisionsSchema = z.object({ items: z.array(z.object({ decisionId: z.string(), type: z.string(), createdAt: z.string(), execution: z.object({ outcome: z.string() }).nullable().optional() })), nextCursor: z.string().nullable() });
export const missionsSchema = z.object({ items: z.array(missionSchema), nextCursor: z.string().nullable() });
export type Pipeline = z.infer<typeof pipelineSchema>;
export type Health = z.infer<typeof healthSchema>;
export type Workforce = z.infer<typeof workforceSchema>;
export type Autonomy = z.infer<typeof autonomySchema>;
export type Finance = z.infer<typeof financeSchema>;
export type Decisions = z.infer<typeof decisionsSchema>;
export type Missions = z.infer<typeof missionsSchema>;
export interface CommandSignals { health: Signal<Health>; pipeline: Signal<Pipeline>; workforce: Signal<Workforce>; autonomy: Signal<Autonomy>; finance: Signal<Finance>; decisions: Signal<Decisions>; missions: Signal<Missions> }
export const loadingSignals: CommandSignals = { health: { state: 'LOADING' }, pipeline: { state: 'LOADING' }, workforce: { state: 'LOADING' }, autonomy: { state: 'LOADING' }, finance: { state: 'LOADING' }, decisions: { state: 'LOADING' }, missions: { state: 'LOADING' } };

// Classification requires the server's explicit disabled response. Generic 503/404 is not proof of a disabled flag.
export function classifyFailure(status: number, body: unknown): SignalState {
  if (status === 401 || status === 403) return 'RESTRICTED';
  const b = body as { reason?: unknown; error?: { message?: unknown } } | null;
  const message = b?.reason ?? b?.error?.message;
  if (status === 503 && message === 'Atlas pipeline is not enabled') return 'DISABLED';
  if (status === 404 && message === 'Workforce is not enabled') return 'DISABLED';
  return 'UNAVAILABLE';
}
export async function readSignal<T>(path: string, schema: z.ZodType<T>, base: string, fetchImpl: typeof fetch = fetch): Promise<Signal<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(`${base.replace(/\/$/, '')}${path}`, { method: 'GET', signal: controller.signal, cache: 'no-store' });
    const body: unknown = await response.json();
    const checkedAt = new Date().toISOString();
    if (!response.ok) return { state: classifyFailure(response.status, body), checkedAt };
    const parsed = schema.safeParse(body);
    if (!parsed.success) return { state: 'UNAVAILABLE', checkedAt };
    return { state: 'HEALTHY', data: parsed.data, checkedAt };
  } catch { return { state: 'UNAVAILABLE', checkedAt: new Date().toISOString() }; }
  finally { clearTimeout(timer); }
}
export async function loadCommandSignals(base: string): Promise<CommandSignals> {
  const [health, pipeline, workforce, autonomy, finance, decisions, missions] = await Promise.all([
    readSignal('/api/ai/health', healthSchema, base),
    readSignal('/api/atlas/pipeline', pipelineSchema, base),
    readSignal('/api/ai/workforce', workforceSchema, base),
    readSignal('/api/atlas/autonomy/status', autonomySchema, base),
    readSignal('/api/atlas/autonomy/finance', financeSchema, base),
    readSignal('/api/atlas/autonomy/decisions?limit=8', decisionsSchema, base),
    readSignal('/api/atlas/autonomy/missions?limit=100', missionsSchema, base),
  ]);
  return { health, pipeline, workforce, autonomy, finance, decisions: decisions.data?.items.length === 0 ? { ...decisions, state: 'EMPTY' } : decisions, missions };
}
export const missionStates = ['Pending', 'Waiting Approval', 'In Progress', 'Completed', 'Failed', 'Blocked'] as const;
/**
 * The backend keeps an approval-required mission at status "Pending" (the runner refuses it until a human approves),
 * so "awaiting approval" is decided by the approval requirement as well as the status. Contract values only.
 */
export function isAwaitingApproval(m: Mission): boolean {
  return (m.approvalRequired === 'Approval Required' || m.approvalRequired === 'CEO Only') && (m.status === 'Pending' || m.status === 'Waiting Approval');
}
/** Missions that need a human or have gone wrong. */
export function attentionMissions(missions: Mission[]): Mission[] {
  return missions.filter((m) => isAwaitingApproval(m) || ['Waiting Approval', 'Failed', 'Blocked'].includes(m.status));
}
/** Each mission is counted exactly once; an awaiting-approval mission is not also counted as plain Pending. */
export function missionCounts(missions: Mission[]) {
  const category = (m: Mission) => (isAwaitingApproval(m) ? 'Waiting Approval' : m.status);
  return Object.fromEntries(missionStates.map((state) => [state, missions.filter((m) => category(m) === state).length])) as Record<typeof missionStates[number], number>;
}
export function executionState(s: CommandSignals): string {
  if (s.pipeline.data) return s.pipeline.data.missionExecutionEnabled ? 'AVAILABLE' : 'DISABLED';
  return s.pipeline.state;
}
export function pipelineState(s: CommandSignals): string { return s.pipeline.data ? 'AVAILABLE' : s.pipeline.state; }
export function scoutState(s: CommandSignals): string { return s.health.data ? (s.health.data.scoutDiscovery.enabled ? 'ACTIVE' : 'STANDBY') : s.health.state; }
export function autonomyState(s: CommandSignals): string {
  const a = s.autonomy.data?.autonomy;
  return a ? (!a.enabled ? 'DISABLED' : a.cycleRunning ? 'ACTIVE' : a.schedulerStarted ? 'STANDBY' : 'REQUIRES ATTENTION') : s.autonomy.state;
}
export function workforceState(s: CommandSignals): string {
  const p = s.health.data?.providers.find((entry) => entry.provider === 'workforce');
  if (s.health.data && !p) return 'DISABLED';
  if (p && !p.healthy) return 'DEGRADED';
  if (s.workforce.data?.catalogStatus === 'unavailable') return 'DEGRADED';
  return p?.healthy ? 'AVAILABLE' : s.workforce.state;
}
export const stateDescription: Record<SignalState, string> = {
  LOADING: 'Reading the latest operational snapshot.', HEALTHY: 'Source responded with validated data.', EMPTY: 'No records returned by this source.',
  DISABLED: 'This capability is disabled. No action is being executed.', RESTRICTED: 'Operational detail requires authorized server access. No credentials are stored in this browser.',
  UNAVAILABLE: 'A reliable snapshot could not be read. This is unknown, not zero and not proof of a system failure.',
};
