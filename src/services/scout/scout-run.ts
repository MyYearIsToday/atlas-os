export type ScoutRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";

export interface ScoutTargetArea {
  query: string;
  latitude?: number;
  longitude?: number;
  radiusMeters: number;
  categories: string[];
}

export interface ScoutRun {
  runId: string;
  targetArea: ScoutTargetArea;
  status: ScoutRunStatus;
  businessIds: string[];
  evidenceIds: string[];
  opportunityScoreIds: string[];
  workflowIds: string[];
  workflowStates: Record<string, string>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoutRunInput {
  targetArea: ScoutTargetArea;
  idFactory?: () => string;
  now?: () => Date;
}

export function createScoutRun(input: ScoutRunInput): ScoutRun {
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const now = (input.now ?? (() => new Date()))().toISOString();
  return {
    runId: idFactory(),
    targetArea: { ...input.targetArea, categories: [...input.targetArea.categories] },
    status: "PENDING",
    businessIds: [],
    evidenceIds: [],
    opportunityScoreIds: [],
    workflowIds: [],
    workflowStates: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function updateScoutRun(
  run: ScoutRun,
  patch: Partial<Omit<ScoutRun, "runId" | "createdAt">>,
  now: () => Date = () => new Date(),
): ScoutRun {
  return { ...run, ...patch, updatedAt: now().toISOString() };
}