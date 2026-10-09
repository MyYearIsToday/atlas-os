import { isAwaitingApproval, type Mission } from './command-center';

/** Snapshot fields the autonomy missions list actually returns. Absent fields stay absent. */
export interface WorkforceMission extends Mission {
  businessId?: string | null;
  missionType?: string | null;
  retryCount?: number;
  completedAt?: string | null;
  attempts?: number;
  /** SHA of the mission version the approval API checks. Missing means this snapshot cannot be approved. */
  version?: string;
}

export type MissionLens = 'active' | 'queued' | 'approval' | 'completed' | 'failed' | 'blocked' | 'other';

export const missionLenses: { id: MissionLens; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'queued', label: 'Queued' },
  { id: 'approval', label: 'Awaiting approval' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'other', label: 'Other' },
];

/** Display copy for registry ids that Atlas actually registers. Unknown ids are not given a fictional remit. */
export const knownRoles: Record<string, { title: string; remit: string }> = {
  ceo_master_planner: { title: 'CEO Master Planner', remit: 'Plans and reviews work that needs the strongest configured model.' },
  scout: { title: 'Scout', remit: 'Discovery and research routing.' },
  business_analyst: { title: 'Business Analyst', remit: 'Evidence and scoring analysis.' },
  mission_router: { title: 'Mission Router', remit: 'Routes tasks across the workforce.' },
  fast_worker: { title: 'Fast Worker', remit: 'Speed-sensitive text work.' },
  coding_engineer: { title: 'Coding Engineer', remit: 'Code-oriented tasks when a coding model is configured.' },
  writer: { title: 'Writer', remit: 'Longer-form writing tasks.' },
  vision_employee: { title: 'Vision', remit: 'Image, audio, and video inputs through the fixed vision model.' },
  document_analyst: { title: 'Document Analyst', remit: 'Document and multimodal reading through the fixed vision model.' },
  future_falconfx_worker: { title: 'FalconFX placeholder', remit: 'Registered disabled. This workspace does not operate FalconFX.' },
};

export function roleTitle(id: string): string {
  return knownRoles[id]?.title ?? id.replaceAll('_', ' ');
}

export function missionLens(mission: WorkforceMission): MissionLens {
  if (isAwaitingApproval(mission) || mission.status === 'Waiting Approval') return 'approval';
  if (mission.status === 'In Progress') return 'active';
  if (mission.status === 'Pending') return 'queued';
  if (mission.status === 'Completed') return 'completed';
  if (mission.status === 'Failed') return 'failed';
  if (mission.status === 'Blocked') return 'blocked';
  return 'other';
}

export function lensCounts(missions: WorkforceMission[]): Record<MissionLens, number> {
  const counts = { active: 0, queued: 0, approval: 0, completed: 0, failed: 0, blocked: 0, other: 0 };
  for (const mission of missions) counts[missionLens(mission)] += 1;
  return counts;
}

export interface MissionMetrics {
  active: number;
  queued: number;
  approval: number;
  completed: number;
  failed: number;
  blocked: number;
  other: number;
  total: number;
  /** Completed / (completed + failed). Null when there is no terminal sample. */
  successRate: number | null;
  successDenominator: number;
  /** Mean of completedAt − createdAt for completed missions with both timestamps and a non-negative span. */
  averageDurationMs: number | null;
  durationSample: number;
}

export function durationMs(mission: WorkforceMission): number | null {
  if (mission.status !== 'Completed' || !mission.createdAt || !mission.completedAt) return null;
  const start = Date.parse(mission.createdAt);
  const end = Date.parse(mission.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function missionMetrics(missions: WorkforceMission[] | null): MissionMetrics | null {
  if (!missions) return null;
  const counts = lensCounts(missions);
  const successDenominator = counts.completed + counts.failed;
  const durations = missions.map(durationMs).filter((value): value is number => value !== null);
  const averageDurationMs = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
  return {
    ...counts,
    total: missions.length,
    successRate: successDenominator === 0 ? null : counts.completed / successDenominator,
    successDenominator,
    averageDurationMs,
    durationSample: durations.length,
  };
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return 'Unavailable';
  return `${Math.round(rate * 100)}%`;
}

export interface RegistryEmployee {
  employee: string;
  enabled: boolean;
  source: string;
  providerId: string;
  model: string | null;
  fallback: string | null;
  note?: string;
}

/** Configuration state only. The registry does not report working, idle, or blocked. */
export function configurationState(employee: RegistryEmployee): { label: string; badge: 'AVAILABLE' | 'DEGRADED' | 'DISABLED' | 'PENDING' } {
  if (!employee.enabled || employee.source === 'disabled') return { label: 'Disabled', badge: 'DISABLED' };
  if (employee.source === 'static-fallback') return { label: 'Fallback configured', badge: 'DEGRADED' };
  if (employee.source === 'pending') return { label: 'Catalog pending', badge: 'PENDING' };
  if (employee.model) return { label: 'Configured', badge: 'AVAILABLE' };
  return { label: 'Unknown', badge: 'PENDING' };
}

export function attentionItems(missions: WorkforceMission[]): WorkforceMission[] {
  return missions.filter((mission) => {
    const lens = missionLens(mission);
    return lens === 'approval' || lens === 'failed' || lens === 'blocked';
  });
}
