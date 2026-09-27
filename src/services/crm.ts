import { useSyncExternalStore } from 'react';

import type { CrmStage } from './atlas-data';

export type LeadStatus = CrmStage;

export const crmStages: LeadStatus[] = [
  'Prospect',
  'Contacted',
  'Replied',
  'Proposal Sent',
  'Won',
  'Lost',
];

export interface Lead {
  id: string;
  businessName: string;
  businessCategory: string;
  location: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  googleMapsUrl: string;
  visibilityScore: number;
  status: LeadStatus;
  lastContactDate: string;
  nextFollowUpDate: string;
  notes: string;
  estimatedDealValue: number;
}

export type LeadInput = Omit<Lead, 'id'>;

export const emptyLead: LeadInput = {
  businessName: '',
  businessCategory: '',
  location: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
  googleMapsUrl: '',
  visibilityScore: 50,
  status: 'Prospect',
  lastContactDate: '',
  nextFollowUpDate: '',
  notes: '',
  estimatedDealValue: 0,
};

const STORAGE_KEY = 'atlas-os:crm-leads:v2';
const LEGACY_STORAGE_KEY = 'atlas-deals';
const listeners = new Set<() => void>();

const seedLeads: Lead[] = [
  {
    id: 'lead-amani-stays',
    businessName: 'Amani Stays',
    businessCategory: 'Boutique hospitality',
    location: 'Osu, Accra',
    contactName: 'Nana Owusu',
    phone: '+233 24 555 0188',
    email: 'nana@amanistays.example',
    website: 'https://amanistays.example',
    googleMapsUrl: 'https://maps.google.com/?q=Amani+Stays+Accra',
    visibilityScore: 92,
    status: 'Proposal Sent',
    lastContactDate: '2026-09-10',
    nextFollowUpDate: '2026-09-16',
    notes: 'Owner wants to increase weekday bookings before the next quarter.',
    estimatedDealValue: 4800,
  },
  {
    id: 'lead-kente-house',
    businessName: 'Kente House',
    businessCategory: 'Design retail',
    location: 'East Legon, Accra',
    contactName: 'Kojo Mensah',
    phone: '+233 20 314 2012',
    email: 'kojo@kentehouse.example',
    website: 'https://kentehouse.example',
    googleMapsUrl: 'https://maps.google.com/?q=Kente+House+Accra',
    visibilityScore: 78,
    status: 'Replied',
    lastContactDate: '2026-09-12',
    nextFollowUpDate: '2026-09-17',
    notes: 'Interested in improving discovery for handmade Ghana gifts.',
    estimatedDealValue: 2800,
  },
  {
    id: 'lead-cedar-salt',
    businessName: 'Cedar & Salt',
    businessCategory: 'Restaurant',
    location: 'Labone, Accra',
    contactName: 'Esi Boateng',
    phone: '+233 27 700 3301',
    email: 'esi@cedarandsalt.example',
    website: '',
    googleMapsUrl: 'https://maps.google.com/?q=Cedar+and+Salt+Labone',
    visibilityScore: 64,
    status: 'Contacted',
    lastContactDate: '2026-09-09',
    nextFollowUpDate: '2026-09-15',
    notes: 'Initial audit shared. Follow up with review response examples.',
    estimatedDealValue: 3600,
  },
  {
    id: 'lead-north-ridge-clinic',
    businessName: 'North Ridge Clinic',
    businessCategory: 'Private healthcare',
    location: 'North Ridge, Accra',
    contactName: 'Dr. Ama Ofori',
    phone: '+233 24 201 8844',
    email: 'ama@northridgeclinic.example',
    website: 'https://northridgeclinic.example',
    googleMapsUrl: 'https://maps.google.com/?q=North+Ridge+Clinic+Accra',
    visibilityScore: 51,
    status: 'Prospect',
    lastContactDate: '',
    nextFollowUpDate: '2026-09-18',
    notes: 'Business hours and services need verification before outreach.',
    estimatedDealValue: 2200,
  },
  {
    id: 'lead-mango-room',
    businessName: 'Mango Room',
    businessCategory: 'Contemporary dining',
    location: 'Labone, Accra',
    contactName: 'Kwame Tetteh',
    phone: '+233 55 109 7440',
    email: 'kwame@mangoroom.example',
    website: 'https://mangoroom.example',
    googleMapsUrl: 'https://maps.google.com/?q=Mango+Room+Labone',
    visibilityScore: 96,
    status: 'Won',
    lastContactDate: '2026-09-08',
    nextFollowUpDate: '',
    notes: 'Strong review velocity. Retainer confirmed for the next growth sprint.',
    estimatedDealValue: 5200,
  },
  {
    id: 'lead-volta-works',
    businessName: 'Volta Works',
    businessCategory: 'Professional services',
    location: 'Airport, Accra',
    contactName: 'Yaw Aboagye',
    phone: '+233 50 440 9912',
    email: 'yaw@voltaworks.example',
    website: 'https://voltaworks.example',
    googleMapsUrl: 'https://maps.google.com/?q=Volta+Works+Accra',
    visibilityScore: 42,
    status: 'Lost',
    lastContactDate: '2026-08-30',
    nextFollowUpDate: '',
    notes: 'Paused until the next budget cycle.',
    estimatedDealValue: 1900,
  },
];

function migrateLegacyDeals(): Lead[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return null;

    const deals = JSON.parse(saved) as Array<{
      id: string;
      company: string;
      contact: string;
      stage: LeadStatus;
      value: number;
      score: number;
    }>;

    if (!Array.isArray(deals) || deals.length === 0) return null;
    return deals.map((deal) => ({
      ...emptyLead,
      id: deal.id,
      businessName: deal.company,
      businessCategory: 'Uncategorized',
      contactName: deal.contact,
      visibilityScore: deal.score,
      status: deal.stage,
      estimatedDealValue: deal.value,
    }));
  } catch {
    return null;
  }
}

function readLeads(): Lead[] {
  if (typeof window === 'undefined') return seedLeads;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as Lead[];

    const migrated = migrateLegacyDeals();
    return migrated ?? seedLeads;
  } catch {
    return seedLeads;
  }
}

let snapshot = readLeads();

function persist(next: Lead[]) {
  snapshot = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function createId() {
  return `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface CrmLeadRepository {
  getSnapshot: () => Lead[];
  subscribe: (listener: () => void) => () => void;
  create: (input: LeadInput) => Promise<Lead>;
  update: (id: string, input: Partial<LeadInput>) => Promise<Lead>;
  remove: (id: string) => Promise<void>;
}

export const localCrmRepository: CrmLeadRepository = {
  getSnapshot: () => snapshot,
  subscribe: (listener) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        snapshot = JSON.parse(event.newValue) as Lead[];
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
    const lead = { ...input, id: createId() };
    persist([lead, ...snapshot]);
    return lead;
  },
  update: async (id, input) => {
    const current = snapshot.find((lead) => lead.id === id);
    if (!current) throw new Error('Lead not found');
    const updated = { ...current, ...input };
    persist(snapshot.map((lead) => (lead.id === id ? updated : lead)));
    return updated;
  },
  remove: async (id) => {
    persist(snapshot.filter((lead) => lead.id !== id));
  },
};

export function useCrmLeads(repository: CrmLeadRepository = localCrmRepository) {
  const leads = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
    repository.getSnapshot,
  );

  return {
    leads,
    createLead: repository.create,
    updateLead: repository.update,
    deleteLead: repository.remove,
  };
}

export function formatLeadDate(value: string) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export function isFollowUpOverdue(lead: Lead) {
  if (!lead.nextFollowUpDate || lead.status === 'Won' || lead.status === 'Lost') return false;
  return lead.nextFollowUpDate < new Date().toISOString().slice(0, 10);
}