import type { BusinessIntelligence } from "./evidence/business-intelligence";
import type { EvidenceRecord } from "./evidence/evidence";
import type { OpportunityScore } from "./scoring/opportunity-types";
import type { ScoutRun } from "./scout/scout-run";

export const PHASE1_STORAGE_KEY = "atlas-os:phase1-domain:v1";

export interface Phase1Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface Phase1State {
  version: 1;
  businesses: BusinessIntelligence[];
  evidence: EvidenceRecord[];
  opportunityScores: OpportunityScore[];
  scoutRuns: ScoutRun[];
}

export interface BusinessIntelligenceRepository {
  list(): BusinessIntelligence[];
  get(id: string): BusinessIntelligence | undefined;
  upsert(value: BusinessIntelligence): Promise<BusinessIntelligence>;
  remove(id: string): Promise<void>;
}

export interface EvidenceRecordRepository {
  list(): EvidenceRecord[];
  get(id: string): EvidenceRecord | undefined;
  listByBusiness(businessId: string): EvidenceRecord[];
  upsert(value: EvidenceRecord): Promise<EvidenceRecord>;
  remove(id: string): Promise<void>;
}

export interface OpportunityScoreRepository {
  list(): OpportunityScore[];
  get(id: string): OpportunityScore | undefined;
  listByBusiness(businessId: string): OpportunityScore[];
  upsert(value: OpportunityScore): Promise<OpportunityScore>;
  remove(id: string): Promise<void>;
}

export interface ScoutRunRepository {
  list(): ScoutRun[];
  get(id: string): ScoutRun | undefined;
  create(value: ScoutRun): Promise<ScoutRun>;
  update(id: string, patch: Partial<Omit<ScoutRun, "runId" | "createdAt">>): Promise<ScoutRun>;
  remove(id: string): Promise<void>;
}

export interface Phase1Repositories {
  businesses: BusinessIntelligenceRepository;
  evidence: EvidenceRecordRepository;
  opportunityScores: OpportunityScoreRepository;
  scoutRuns: ScoutRunRepository;
  reset(): void;
}

function emptyState(): Phase1State {
  return { version: 1, businesses: [], evidence: [], opportunityScores: [], scoutRuns: [] };
}

function readState(storage?: Phase1Storage): Phase1State {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(PHASE1_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<Phase1State>;
    return {
      version: 1,
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      opportunityScores: Array.isArray(parsed.opportunityScores) ? parsed.opportunityScores : [],
      scoutRuns: Array.isArray(parsed.scoutRuns) ? parsed.scoutRuns : [],
    };
  } catch {
    return emptyState();
  }
}

export function createLocalPhase1Repositories(options: { storage?: Phase1Storage } = {}): Phase1Repositories {
  const storage =
    options.storage ??
    (typeof window !== "undefined" ? (window.localStorage as Phase1Storage) : undefined);
  let state = readState(storage);

  const persist = () => storage?.setItem(PHASE1_STORAGE_KEY, JSON.stringify(state));
  const upsert = <T extends { id: string }>(items: T[], value: T): T[] => {
    const index = items.findIndex((item) => item.id === value.id);
    if (index < 0) return [value, ...items];
    const next = [...items];
    next[index] = value;
    return next;
  };

  const businesses: BusinessIntelligenceRepository = {
    list: () => [...state.businesses],
    get: (id) => state.businesses.find((item) => item.id === id),
    upsert: async (value) => {
      state = { ...state, businesses: upsert(state.businesses, { ...value, updatedAt: value.updatedAt }) };
      persist();
      return value;
    },
    remove: async (id) => {
      state = { ...state, businesses: state.businesses.filter((item) => item.id !== id) };
      persist();
    },
  };

  const evidence: EvidenceRecordRepository = {
    list: () => [...state.evidence],
    get: (id) => state.evidence.find((item) => item.evidenceId === id),
    listByBusiness: (businessId) => state.evidence.filter((item) => item.businessId === businessId),
    upsert: async (value) => {
      const items = state.evidence.filter((item) => item.evidenceId !== value.evidenceId);
      state = { ...state, evidence: [value, ...items] };
      persist();
      return value;
    },
    remove: async (id) => {
      state = { ...state, evidence: state.evidence.filter((item) => item.evidenceId !== id) };
      persist();
    },
  };

  const opportunityScores: OpportunityScoreRepository = {
    list: () => [...state.opportunityScores],
    get: (id) => state.opportunityScores.find((item) => item.id === id),
    listByBusiness: (businessId) => state.opportunityScores.filter((item) => item.businessId === businessId),
    upsert: async (value) => {
      state = { ...state, opportunityScores: upsert(state.opportunityScores, value) };
      persist();
      return value;
    },
    remove: async (id) => {
      state = { ...state, opportunityScores: state.opportunityScores.filter((item) => item.id !== id) };
      persist();
    },
  };

  const scoutRuns: ScoutRunRepository = {
    list: () => [...state.scoutRuns],
    get: (id) => state.scoutRuns.find((item) => item.runId === id),
    create: async (value) => {
      state = { ...state, scoutRuns: [value, ...state.scoutRuns.filter((item) => item.runId !== value.runId)] };
      persist();
      return value;
    },
    update: async (id, patch) => {
      const current = state.scoutRuns.find((item) => item.runId === id);
      if (!current) throw new Error(`ScoutRun not found: ${id}`);
      const updated = { ...current, ...patch };
      state = { ...state, scoutRuns: state.scoutRuns.map((item) => (item.runId === id ? updated : item)) };
      persist();
      return updated;
    },
    remove: async (id) => {
      state = { ...state, scoutRuns: state.scoutRuns.filter((item) => item.runId !== id) };
      persist();
    },
  };

  return {
    businesses,
    evidence,
    opportunityScores,
    scoutRuns,
    reset: () => {
      state = emptyState();
      persist();
    },
  };
}