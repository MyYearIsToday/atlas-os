import {
  defaultAtlasSnapshot,
  type AtlasSettings,
  type AtlasSnapshot,
  type CrmDeal,
  type FinanceEntry,
  type Mission,
} from './atlas-data';

const STORAGE_KEY = 'atlas-os:snapshot:v1';
const listeners = new Set<() => void>();

function readSnapshot(): AtlasSnapshot {
  if (typeof window === 'undefined') return defaultAtlasSnapshot;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultAtlasSnapshot;
    return { ...defaultAtlasSnapshot, ...JSON.parse(saved) } as AtlasSnapshot;
  } catch {
    return defaultAtlasSnapshot;
  }
}

let snapshot = readSnapshot();

function notify() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }
  notify();
}

export const atlasStore = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  updateDeal: (dealId: string, patch: Partial<CrmDeal>) => {
    snapshot = {
      ...snapshot,
      deals: snapshot.deals.map((deal) =>
        deal.id === dealId ? { ...deal, ...patch } : deal,
      ),
    };
    persist();
  },
  toggleMission: (missionId: string) => {
    snapshot = {
      ...snapshot,
      missions: snapshot.missions.map((mission) =>
        mission.id === missionId
          ? { ...mission, completed: !mission.completed }
          : mission,
      ),
    };
    persist();
  },
  addMission: (mission: Mission) => {
    snapshot = { ...snapshot, missions: [mission, ...snapshot.missions] };
    persist();
  },
  addFinanceEntry: (entry: FinanceEntry) => {
    snapshot = { ...snapshot, finance: [entry, ...snapshot.finance] };
    persist();
  },
  updateSettings: (settings: Partial<AtlasSettings>) => {
    snapshot = {
      ...snapshot,
      settings: { ...snapshot.settings, ...settings },
    };
    persist();
  },
  reset: () => {
    snapshot = defaultAtlasSnapshot;
    persist();
  },
};