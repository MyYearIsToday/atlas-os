export type EmployeeStatus = 'online' | 'working' | 'standby' | 'locked';

export type CrmStage =
  | 'Prospect'
  | 'Contacted'
  | 'Replied'
  | 'Proposal Sent'
  | 'Won'
  | 'Lost';

export type ActivityType =
  | 'lead'
  | 'score'
  | 'proposal'
  | 'review'
  | 'finance'
  | 'system';

export interface KpiMetric {
  label: string;
  value: string;
  change: string;
  changeDirection: 'up' | 'down' | 'neutral';
  detail: string;
}

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  owner: string;
  priority: 'high' | 'medium' | 'low';
  progress: number;
  dueLabel: string;
  completed: boolean;
}

export interface AiEmployee {
  id: string;
  name: string;
  role: string;
  initials: string;
  status: EmployeeStatus;
  statusLabel: string;
  currentTask: string;
  lastUpdate: string;
  accent: string;
  completedToday: number;
  queue: number;
}

export interface CrmDeal {
  id: string;
  company: string;
  contact: string;
  location: string;
  stage: CrmStage;
  value: number;
  score: number;
  lastContact: string;
  source: string;
}

export interface ScorePoint {
  label: string;
  score: number;
}

export interface Client {
  id: string;
  company: string;
  category: string;
  location: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  status: 'active' | 'at-risk' | 'onboarding';
  score: number;
  scoreHistory: ScorePoint[];
  reviews: number;
  rating: number;
  photos: number;
  notes: string[];
  upsells: string[];
  initials: string;
  accent: string;
}

export interface VisibilityInputs {
  profileCompleteness: number;
  reviews: number;
  photos: number;
  localSeo: number;
  businessInfo: number;
  engagement: number;
}

export interface VisibilityResult extends VisibilityInputs {
  total: number;
  grade: string;
  recommendation: string;
}

export interface IndexBusiness {
  rank: number;
  company: string;
  category: string;
  location: string;
  score: number;
  trend: number;
  reviews: number;
  initials: string;
}

export interface FinanceEntry {
  id: string;
  label: string;
  category: string;
  amount: number;
  type: 'income' | 'expense';
  date: string;
  status: 'cleared' | 'pending';
}

export interface AtlasSettings {
  workspaceName: string;
  timezone: string;
  weeklyDigest: boolean;
  missionAlerts: boolean;
  compactMode: boolean;
}

export interface AtlasSnapshot {
  kpis: KpiMetric[];
  activity: ActivityEvent[];
  missions: Mission[];
  employees: AiEmployee[];
  deals: CrmDeal[];
  clients: Client[];
  index: IndexBusiness[];
  finance: FinanceEntry[];
  settings: AtlasSettings;
}

export const defaultVisibilityInputs: VisibilityInputs = {
  profileCompleteness: 82,
  reviews: 74,
  photos: 62,
  localSeo: 68,
  businessInfo: 90,
  engagement: 55,
};

export const defaultAtlasSnapshot: AtlasSnapshot = {
  kpis: [
    {
      label: 'Revenue',
      value: 'GH₵ 42,850',
      change: '+18.4%',
      changeDirection: 'up',
      detail: 'vs. last month',
    },
    {
      label: 'Leads',
      value: '184',
      change: '+24',
      changeDirection: 'up',
      detail: 'this month',
    },
    {
      label: 'Clients',
      value: '32',
      change: '+6',
      changeDirection: 'up',
      detail: 'active accounts',
    },
    {
      label: 'Visibility Score',
      value: '74',
      change: '+8 pts',
      changeDirection: 'up',
      detail: 'portfolio average',
    },
    {
      label: 'Trading Locked',
      value: 'ON',
      change: 'Protected',
      changeDirection: 'neutral',
      detail: 'capital controls active',
    },
  ],
  activity: [
    {
      id: 'activity-1',
      type: 'score',
      title: 'Visibility report generated',
      description: 'Kasapreko Kitchen moved from 61 to 78',
      timestamp: '8 min ago',
      actor: 'Scout AI',
    },
    {
      id: 'activity-2',
      type: 'proposal',
      title: 'Proposal viewed',
      description: 'Apex Dental opened the MapSpark audit proposal',
      timestamp: '32 min ago',
      actor: 'Closer AI',
    },
    {
      id: 'activity-3',
      type: 'lead',
      title: 'New lead qualified',
      description: 'Bloom & Soil has a 92% close probability',
      timestamp: '1 hr ago',
      actor: 'Operator AI',
    },
    {
      id: 'activity-4',
      type: 'review',
      title: 'Client review response drafted',
      description: '3 suggested responses ready for approval',
      timestamp: '2 hrs ago',
      actor: 'Builder AI',
    },
    {
      id: 'activity-5',
      type: 'finance',
      title: 'Subscription recorded',
      description: 'MapSpark Pro renewal from Golden Bean Café',
      timestamp: '4 hrs ago',
      actor: 'Finance AI',
    },
  ],
  missions: [
    {
      id: 'mission-1',
      title: 'Close the mid-market gap',
      description: 'Move 3 qualified proposals to decision this week.',
      owner: 'Closer AI',
      priority: 'high',
      progress: 67,
      dueLabel: 'Due today',
      completed: false,
    },
    {
      id: 'mission-2',
      title: 'Refresh Kumasi index',
      description: 'Run the next scoring pass across 24 businesses.',
      owner: 'Scout AI',
      priority: 'medium',
      progress: 42,
      dueLabel: 'Due tomorrow',
      completed: false,
    },
    {
      id: 'mission-3',
      title: 'Reconcile October spend',
      description: 'Review 6 pending operating expenses.',
      owner: 'Finance AI',
      priority: 'low',
      progress: 100,
      dueLabel: 'Complete',
      completed: true,
    },
  ],
  employees: [
    {
      id: 'scout',
      name: 'Scout AI',
      role: 'Market Intelligence',
      initials: 'SC',
      status: 'working',
      statusLabel: 'Working',
      currentTask: 'Scanning 48 Accra profiles for score gaps',
      lastUpdate: 'Updated 6 min ago',
      accent: '#D4AF37',
      completedToday: 18,
      queue: 7,
    },
    {
      id: 'builder',
      name: 'Builder AI',
      role: 'Audit Production',
      initials: 'BU',
      status: 'online',
      statusLabel: 'Online',
      currentTask: 'Drafting a review recovery playbook',
      lastUpdate: 'Updated 12 min ago',
      accent: '#16A085',
      completedToday: 11,
      queue: 4,
    },
    {
      id: 'operator',
      name: 'Operator AI',
      role: 'Systems & Delivery',
      initials: 'OP',
      status: 'working',
      statusLabel: 'Working',
      currentTask: 'Routing 9 leads into the priority queue',
      lastUpdate: 'Updated 3 min ago',
      accent: '#7C9CFF',
      completedToday: 31,
      queue: 9,
    },
    {
      id: 'closer',
      name: 'Closer AI',
      role: 'Revenue & Growth',
      initials: 'CL',
      status: 'standby',
      statusLabel: 'Standby',
      currentTask: 'Waiting for 2 proposal decisions',
      lastUpdate: 'Updated 24 min ago',
      accent: '#E98B6D',
      completedToday: 8,
      queue: 2,
    },
    {
      id: 'finance',
      name: 'Finance AI',
      role: 'Finance & Controls',
      initials: 'FI',
      status: 'locked',
      statusLabel: 'Guarded',
      currentTask: 'Monitoring cash position and runway',
      lastUpdate: 'Updated 42 min ago',
      accent: '#B69CFF',
      completedToday: 6,
      queue: 1,
    },
  ],
  deals: [
    {
      id: 'deal-1',
      company: 'Apex Dental',
      contact: 'Dr. Ama Mensah',
      location: 'East Legon, Accra',
      stage: 'Proposal Sent',
      value: 3200,
      score: 86,
      lastContact: 'Today',
      source: 'Google Maps',
    },
    {
      id: 'deal-2',
      company: 'Bloom & Soil',
      contact: 'Nana Yaa Asante',
      location: 'Osu, Accra',
      stage: 'Replied',
      value: 1800,
      score: 92,
      lastContact: 'Yesterday',
      source: 'Referral',
    },
    {
      id: 'deal-3',
      company: 'Golden Bean Café',
      contact: 'Kwame Boateng',
      location: 'Kumasi',
      stage: 'Won',
      value: 2400,
      score: 78,
      lastContact: '2 days ago',
      source: 'Atlas Leaderboard',
    },
    {
      id: 'deal-4',
      company: 'North Ridge Fitness',
      contact: 'Esi Owusu',
      location: 'North Ridge, Accra',
      stage: 'Contacted',
      value: 1400,
      score: 64,
      lastContact: '4 days ago',
      source: 'Google Maps',
    },
    {
      id: 'deal-5',
      company: 'Kente House',
      contact: 'Yaw Frimpong',
      location: 'Adum, Kumasi',
      stage: 'Prospect',
      value: 2200,
      score: 58,
      lastContact: 'Never',
      source: 'Atlas Leaderboard',
    },
    {
      id: 'deal-6',
      company: 'Sankofa Stays',
      contact: 'Akosua Ofori',
      location: 'Cantonments, Accra',
      stage: 'Lost',
      value: 1600,
      score: 46,
      lastContact: '1 week ago',
      source: 'Referral',
    },
  ],
  clients: [
    {
      id: 'client-1',
      company: 'Golden Bean Café',
      category: 'Food & Beverage',
      location: 'Kumasi, Ghana',
      contactName: 'Kwame Boateng',
      contactEmail: 'kwame@goldenbean.example',
      phone: '+233 24 555 0188',
      status: 'active',
      score: 78,
      scoreHistory: [
        { label: 'Jun', score: 54 },
        { label: 'Jul', score: 63 },
        { label: 'Aug', score: 71 },
        { label: 'Sep', score: 78 },
      ],
      reviews: 146,
      rating: 4.7,
      photos: 82,
      notes: ['Strong weekend discovery traffic', 'Needs a fresh menu photo set'],
      upsells: ['Review Response System', 'Seasonal Photo Refresh'],
      initials: 'GB',
      accent: '#D4AF37',
    },
    {
      id: 'client-2',
      company: 'Apex Dental',
      category: 'Healthcare',
      location: 'East Legon, Accra',
      contactName: 'Dr. Ama Mensah',
      contactEmail: 'ama@apexdental.example',
      phone: '+233 20 314 2012',
      status: 'onboarding',
      score: 66,
      scoreHistory: [
        { label: 'Jun', score: 44 },
        { label: 'Jul', score: 51 },
        { label: 'Aug', score: 59 },
        { label: 'Sep', score: 66 },
      ],
      reviews: 89,
      rating: 4.5,
      photos: 34,
      notes: ['Onboarding call scheduled for Thursday'],
      upsells: ['Local Search Sprint', 'Review Response System'],
      initials: 'AD',
      accent: '#16A085',
    },
    {
      id: 'client-3',
      company: 'Kasapreko Kitchen',
      category: 'Restaurant',
      location: 'Airport Residential, Accra',
      contactName: 'Kofi Addo',
      contactEmail: 'kofi@kasapreko.example',
      phone: '+233 27 700 3301',
      status: 'active',
      score: 78,
      scoreHistory: [
        { label: 'Jun', score: 48 },
        { label: 'Jul', score: 57 },
        { label: 'Aug', score: 61 },
        { label: 'Sep', score: 78 },
      ],
      reviews: 212,
      rating: 4.8,
      photos: 116,
      notes: ['Recent score lift after category correction'],
      upsells: ['Competitive Watch'],
      initials: 'KK',
      accent: '#7C9CFF',
    },
  ],
  index: [
    {
      rank: 1,
      company: 'Apex Dental',
      category: 'Healthcare',
      location: 'East Legon',
      score: 91,
      trend: 4,
      reviews: 312,
      initials: 'AD',
    },
    {
      rank: 2,
      company: 'Bloom & Soil',
      category: 'Retail',
      location: 'Osu',
      score: 88,
      trend: 8,
      reviews: 188,
      initials: 'BS',
    },
    {
      rank: 3,
      company: 'Kasapreko Kitchen',
      category: 'Restaurant',
      location: 'Airport Residential',
      score: 78,
      trend: 17,
      reviews: 212,
      initials: 'KK',
    },
    {
      rank: 4,
      company: 'Golden Bean Café',
      category: 'Food & Beverage',
      location: 'Kumasi',
      score: 78,
      trend: 5,
      reviews: 146,
      initials: 'GB',
    },
    {
      rank: 5,
      company: 'North Ridge Fitness',
      category: 'Fitness',
      location: 'North Ridge',
      score: 64,
      trend: -2,
      reviews: 74,
      initials: 'NF',
    },
  ],
  finance: [
    {
      id: 'finance-1',
      label: 'Golden Bean Café',
      category: 'MapSpark Pro',
      amount: 2400,
      type: 'income',
      date: 'Sep 12, 2026',
      status: 'cleared',
    },
    {
      id: 'finance-2',
      label: 'Apex Dental',
      category: 'GBP Audit',
      amount: 3200,
      type: 'income',
      date: 'Sep 10, 2026',
      status: 'pending',
    },
    {
      id: 'finance-3',
      label: 'Google Workspace',
      category: 'Software',
      amount: 214,
      type: 'expense',
      date: 'Sep 09, 2026',
      status: 'cleared',
    },
    {
      id: 'finance-4',
      label: 'Scout data credits',
      category: 'Operations',
      amount: 680,
      type: 'expense',
      date: 'Sep 07, 2026',
      status: 'cleared',
    },
  ],
  settings: {
    workspaceName: 'MapSpark Ghana',
    timezone: 'Africa/Accra',
    weeklyDigest: true,
    missionAlerts: true,
    compactMode: false,
  },
};