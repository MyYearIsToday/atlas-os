import { useSyncExternalStore } from 'react';

import { type AgentId, agentRegistry } from '@/agents';

import { localCrmRepository } from './crm';

export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export type TaskStatus = 'Pending' | 'In Progress' | 'Waiting Approval' | 'Completed';

export type ApprovalLevel = 'Auto' | 'Approval Required' | 'CEO Only';

export const taskPriorities: TaskPriority[] = ['Low', 'Medium', 'High', 'Critical'];
export const taskStatuses: TaskStatus[] = ['Pending', 'In Progress', 'Waiting Approval', 'Completed'];
export const approvalLevels: ApprovalLevel[] = ['Auto', 'Approval Required', 'CEO Only'];

const priorityRank: Record<TaskPriority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export interface Task {
  taskId: string;
  title: string;
  description: string;
  assignedAI: AgentId;
  clientId: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  approvalRequired: ApprovalLevel;
  dueDate: string;
  createdAt: string;
  completedAt: string | null;
  estimatedCost: number;
  estimatedTime: string;
}

export type TaskInput = Omit<Task, 'taskId' | 'createdAt' | 'completedAt' | 'status'> & {
  status?: TaskStatus;
};

const STORAGE_KEY = 'atlas-os:mission-queue:v1';
const listeners = new Set<() => void>();

/**
 * Sprint 3 seed data. These are development/demo tasks only — no AI has
 * actually executed any of them, and no completion timestamps or costs below
 * represent real work performed. See docs/specs/SPEC-002-CRM.md for the
 * fictional client roster these tasks reference by clientId.
 */
const seedTasks: Task[] = [
  {
    taskId: 'task-visibility-audit-amani',
    title: 'MapSpark visibility audit — Amani Stays',
    description: 'Run the full visibility audit across Google Business Profile, reviews, and local SEO signals ahead of the proposal follow-up.',
    assignedAI: 'scout',
    clientId: 'lead-amani-stays',
    priority: 'High',
    status: 'In Progress',
    approvalRequired: 'Auto',
    dueDate: '2026-09-16',
    createdAt: '2026-09-14T09:12:00.000Z',
    completedAt: null,
    estimatedCost: 45,
    estimatedTime: '45 min',
  },
  {
    taskId: 'task-gbp-diagnosis-north-ridge',
    title: 'Google Business Profile diagnosis — North Ridge Clinic',
    description: 'Identify missing categories, hours, and photo gaps on the profile before outreach resumes.',
    assignedAI: 'scout',
    clientId: 'lead-north-ridge-clinic',
    priority: 'Medium',
    status: 'Pending',
    approvalRequired: 'Auto',
    dueDate: '2026-09-17',
    createdAt: '2026-09-15T07:40:00.000Z',
    completedAt: null,
    estimatedCost: 20,
    estimatedTime: '30 min',
  },
  {
    taskId: 'task-client-report-kente',
    title: 'Client report preparation — Kente House',
    description: 'Compile the monthly visibility report with score history, review velocity, and next-step recommendations.',
    assignedAI: 'builder',
    clientId: 'lead-kente-house',
    priority: 'Medium',
    status: 'Waiting Approval',
    approvalRequired: 'Approval Required',
    dueDate: '2026-09-16',
    createdAt: '2026-09-13T14:05:00.000Z',
    completedAt: null,
    estimatedCost: 80,
    estimatedTime: '1 hr',
  },
  {
    taskId: 'task-competitor-research-labone',
    title: 'Competitor research — Labone dining cluster',
    description: 'Map the top 8 competing dining profiles near Cedar & Salt and Mango Room to size the local opportunity.',
    assignedAI: 'scout',
    clientId: null,
    priority: 'Low',
    status: 'Pending',
    approvalRequired: 'Auto',
    dueDate: '2026-09-19',
    createdAt: '2026-09-15T08:02:00.000Z',
    completedAt: null,
    estimatedCost: 15,
    estimatedTime: '1.5 hr',
  },
  {
    taskId: 'task-content-pack-cedar-salt',
    title: 'Content pack preparation — Cedar & Salt',
    description: 'Draft a week of caption and photo-brief content to support the review-response follow-up plan.',
    assignedAI: 'builder',
    clientId: 'lead-cedar-salt',
    priority: 'Medium',
    status: 'Pending',
    approvalRequired: 'Approval Required',
    dueDate: '2026-09-18',
    createdAt: '2026-09-15T06:55:00.000Z',
    completedAt: null,
    estimatedCost: 60,
    estimatedTime: '2 hr',
  },
  {
    taskId: 'task-lead-research-osu',
    title: 'Lead research — Osu boutique retail',
    description: 'Surface new boutique retail prospects in Osu with visibility scores under 60 for the outreach queue.',
    assignedAI: 'scout',
    clientId: null,
    priority: 'Low',
    status: 'Completed',
    approvalRequired: 'Auto',
    dueDate: '2026-09-14',
    createdAt: '2026-09-12T10:30:00.000Z',
    completedAt: '2026-09-14T16:20:00.000Z',
    estimatedCost: 25,
    estimatedTime: '1 hr',
  },
  {
    taskId: 'task-followup-mango-room',
    title: 'Follow-up preparation — Mango Room retainer renewal',
    description: 'Draft the retainer renewal follow-up referencing the confirmed growth-sprint outcome.',
    assignedAI: 'closer',
    clientId: 'lead-mango-room',
    priority: 'High',
    status: 'Waiting Approval',
    approvalRequired: 'CEO Only',
    dueDate: '2026-09-16',
    createdAt: '2026-09-14T11:15:00.000Z',
    completedAt: null,
    estimatedCost: 30,
    estimatedTime: '20 min',
  },
  {
    taskId: 'task-proposal-followup-volta',
    title: 'Re-engagement proposal — Volta Works',
    description: 'Prepare a re-engagement message for the next budget cycle, referencing the paused deal notes.',
    assignedAI: 'closer',
    clientId: 'lead-volta-works',
    priority: 'Low',
    status: 'Pending',
    approvalRequired: 'Approval Required',
    dueDate: '2026-09-22',
    createdAt: '2026-09-15T09:00:00.000Z',
    completedAt: null,
    estimatedCost: 20,
    estimatedTime: '25 min',
  },
  {
    taskId: 'task-finance-reconciliation-sep',
    title: 'Weekly finance reconciliation',
    description: 'Match new revenue and expense entries to the operating ledger and flag anomalies.',
    assignedAI: 'finance',
    clientId: null,
    priority: 'Medium',
    status: 'In Progress',
    approvalRequired: 'Auto',
    dueDate: '2026-09-15',
    createdAt: '2026-09-15T05:00:00.000Z',
    completedAt: null,
    estimatedCost: 35,
    estimatedTime: '40 min',
  },
  {
    taskId: 'task-pricing-review-q4',
    title: 'Q4 pricing tier review',
    description: 'Prepare a comparison of current MapSpark tiers against the visibility-score outcomes they produced, for CEO review only — no pricing change is executed by this task.',
    assignedAI: 'finance',
    clientId: null,
    priority: 'Critical',
    status: 'Pending',
    approvalRequired: 'CEO Only',
    dueDate: '2026-09-25',
    createdAt: '2026-09-15T09:30:00.000Z',
    completedAt: null,
    estimatedCost: 90,
    estimatedTime: '3 hr',
  },
];

function readTasks(): Task[] {
  if (typeof window === 'undefined') return seedTasks;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as Task[];
    return seedTasks;
  } catch {
    return seedTasks;
  }
}

let snapshot = readTasks();

function persist(next: Task[]) {
  snapshot = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function createId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Resolves a task's next status when it moves forward one step, respecting
 * its approval level. Auto tasks complete directly; Approval Required and
 * CEO Only tasks route through Waiting Approval first, exactly as described
 * in docs/specs/SPEC-003-MissionQueue.md's queue-state resolution.
 */
function nextForwardStatus(task: Task): TaskStatus {
  if (task.status === 'Pending') return 'In Progress';
  if (task.status === 'In Progress') {
    return task.approvalRequired === 'Auto' ? 'Completed' : 'Waiting Approval';
  }
  if (task.status === 'Waiting Approval') return 'Completed';
  return task.status;
}

export interface MissionQueueRepository {
  getSnapshot: () => Task[];
  subscribe: (listener: () => void) => () => void;
  create: (input: TaskInput) => Promise<Task>;
  update: (id: string, input: Partial<Task>) => Promise<Task>;
  remove: (id: string) => Promise<void>;
  advance: (id: string) => Promise<Task>;
  sendBackForRevision: (id: string) => Promise<Task>;
}

export const localMissionQueueRepository: MissionQueueRepository = {
  getSnapshot: () => snapshot,
  subscribe: (listener) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        snapshot = JSON.parse(event.newValue) as Task[];
        listener();
      } catch {
        // Keep the last valid local snapshot.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  },
  create: async (input) => {
    const task: Task = {
      ...input,
      taskId: createId(),
      status: input.status ?? 'Pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    persist([task, ...snapshot]);
    return task;
  },
  update: async (id, input) => {
    const current = snapshot.find((task) => task.taskId === id);
    if (!current) throw new Error('Task not found');
    const updated = { ...current, ...input };
    persist(snapshot.map((task) => (task.taskId === id ? updated : task)));
    return updated;
  },
  remove: async (id) => {
    persist(snapshot.filter((task) => task.taskId !== id));
  },
  advance: async (id) => {
    const current = snapshot.find((task) => task.taskId === id);
    if (!current) throw new Error('Task not found');
    const status = nextForwardStatus(current);
    const updated: Task = {
      ...current,
      status,
      completedAt: status === 'Completed' ? new Date().toISOString() : current.completedAt,
    };
    persist(snapshot.map((task) => (task.taskId === id ? updated : task)));
    return updated;
  },
  sendBackForRevision: async (id) => {
    const current = snapshot.find((task) => task.taskId === id);
    if (!current) throw new Error('Task not found');
    const updated: Task = { ...current, status: 'In Progress', completedAt: null };
    persist(snapshot.map((task) => (task.taskId === id ? updated : task)));
    return updated;
  },
};

export function useMissionQueue(repository: MissionQueueRepository = localMissionQueueRepository) {
  const tasks = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
    repository.getSnapshot,
  );

  return {
    tasks,
    createTask: repository.create,
    updateTask: repository.update,
    deleteTask: repository.remove,
    advanceTask: repository.advance,
    sendBackForRevision: repository.sendBackForRevision,
  };
}

export function formatTaskDate(value: string | null) {
  if (!value) return 'Not set';
  const date = value.length <= 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function isTaskOverdue(task: Task) {
  if (task.status === 'Completed') return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.dueDate < today;
}

/**
 * Next recommended action for a task, matching the state machine described
 * in the Sprint 3 brief: Pending -> Start, In Progress -> Mark complete,
 * Waiting Approval -> Review, Completed -> View result.
 */
export function nextActionLabel(task: Task): string {
  switch (task.status) {
    case 'Pending':
      return 'Start';
    case 'In Progress':
      return task.approvalRequired === 'Auto' ? 'Mark complete' : 'Submit for approval';
    case 'Waiting Approval':
      return 'Review';
    case 'Completed':
      return 'View result';
  }
}

/**
 * Loose, read-only reference from a Mission Queue task to a CRM lead. This is
 * intentionally not a hard foreign key — see SPEC-003-MissionQueue.md, open
 * question 5 — it only resolves a display label for the Task Detail panel.
 */
export function resolveClientLabel(clientId: string | null): string {
  if (!clientId) return 'Internal — no client';
  const lead = localCrmRepository.getSnapshot().find((item) => item.id === clientId);
  return lead ? lead.businessName : clientId;
}

/**
 * Resolves the CRM deal value a task's linked client represents, if any.
 * Used only as a rough "business impact" estimate for Today's Mission — it
 * is real mock CRM data (see SPEC-002-CRM.md's seed leads), not a fabricated
 * number, but it is still a Sprint 3 development estimate, not measured
 * revenue.
 */
export function resolveClientDealValue(clientId: string | null): number {
  if (!clientId) return 0;
  const lead = localCrmRepository.getSnapshot().find((item) => item.id === clientId);
  return lead ? lead.estimatedDealValue : 0;
}

export interface AgentActivity {
  agentId: AgentId;
  name: string;
  purpose: string;
  currentTask: Task | null;
  queueLength: number;
  completedToday: number;
  isWorking: boolean;
}

/**
 * Derives live AI employee status from Mission Queue tasks rather than a
 * second, separately-maintained employee model — see ATLAS_PRINCIPLES.md
 * rule 10 and AI_REGISTRY.md. Identity/purpose comes from the existing
 * src/agents registry; activity is computed from real task state.
 */
export function deriveAgentActivity(tasks: Task[]): AgentActivity[] {
  const today = new Date().toISOString().slice(0, 10);
  return (Object.keys(agentRegistry) as AgentId[]).map((agentId) => {
    const agentTasks = tasks.filter((task) => task.assignedAI === agentId);
    const currentTask = agentTasks
      .filter((task) => task.status === 'In Progress')
      .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority])[0] ?? null;
    const queueLength = agentTasks.filter((task) => task.status === 'Pending').length;
    const completedToday = agentTasks.filter(
      (task) => task.status === 'Completed' && (task.completedAt ?? '').slice(0, 10) === today,
    ).length;
    return {
      agentId,
      name: agentRegistry[agentId].name,
      purpose: agentRegistry[agentId].purpose,
      currentTask,
      queueLength,
      completedToday,
      isWorking: currentTask !== null,
    };
  });
}

export interface TodaysMissionSummary {
  pending: number;
  inProgress: number;
  awaitingApproval: number;
  employeesWorking: number;
  totalEmployees: number;
  estimatedValueInMotion: number;
}

/**
 * "Estimated value in motion" reuses the existing estimatedCost field on
 * in-flight tasks rather than adding a separate profit-impact field to the
 * core Task model. It is a development estimate, not measured revenue — see
 * PROJECT_STATE.md for how this should be treated once real cost/value data
 * exists.
 */
export function summarizeToday(tasks: Task[]): TodaysMissionSummary {
  const activity = deriveAgentActivity(tasks);
  const inFlight = tasks.filter((task) => task.status === 'In Progress' || task.status === 'Waiting Approval');
  return {
    pending: tasks.filter((task) => task.status === 'Pending').length,
    inProgress: tasks.filter((task) => task.status === 'In Progress').length,
    awaitingApproval: tasks.filter((task) => task.status === 'Waiting Approval').length,
    employeesWorking: activity.filter((agent) => agent.isWorking).length,
    totalEmployees: activity.length,
    estimatedValueInMotion: inFlight.reduce((sum, task) => sum + resolveClientDealValue(task.clientId), 0),
  };
}
