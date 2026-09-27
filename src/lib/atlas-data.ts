export type Stage = 'Prospect' | 'Contacted' | 'Replied' | 'Proposal Sent' | 'Won' | 'Lost';

export type Employee = {
  id: string; name: string; role: string; initials: string; color: string;
  status: 'Working' | 'Waiting' | 'Complete'; task: string; update: string;
};

export type Deal = {
  id: string; company: string; contact: string; stage: Stage; value: number; score: number; source: string;
};

export type Client = {
  id: string; name: string; sector: string; location: string; initials: string; score: number;
  profile: number; reviews: number; photos: number; notes: string[]; upsells: string[]; history: number[];
};

export type Activity = { id: string; kind: string; title: string; detail: string; time: string; tone: 'gold' | 'teal' | 'slate' };

export const employees: Employee[] = [
  { id: 'scout', name: 'Scout AI', role: 'Market intelligence', initials: 'S', color: '#d4af37', status: 'Working', task: 'Qualifying 18 Accra hospitality leads', update: '2 min ago' },
  { id: 'builder', name: 'Builder AI', role: 'Growth systems', initials: 'B', color: '#16a085', status: 'Working', task: 'Publishing visibility reports for 3 clients', update: '8 min ago' },
  { id: 'operator', name: 'Operator AI', role: 'Operations', initials: 'O', color: '#5d8ac6', status: 'Complete', task: 'Weekly client health check complete', update: '24 min ago' },
  { id: 'closer', name: 'Closer AI', role: 'Revenue', initials: 'C', color: '#c77dff', status: 'Working', task: 'Preparing proposal for Amani Stays', update: '31 min ago' },
  { id: 'finance', name: 'Finance AI', role: 'Finance', initials: 'F', color: '#ea8c55', status: 'Waiting', task: 'Awaiting expense receipts from team', update: '1 hr ago' },
];

export const initialDeals: Deal[] = [
  { id: 'd1', company: 'Amani Stays', contact: 'Nana Owusu', stage: 'Proposal Sent', value: 4800, score: 92, source: 'Referral' },
  { id: 'd2', company: 'Kente House', contact: 'Kojo Mensah', stage: 'Replied', value: 2800, score: 78, source: 'Google Maps' },
  { id: 'd3', company: 'Cedar & Salt', contact: 'Esi Boateng', stage: 'Contacted', value: 3600, score: 64, source: 'Instagram' },
  { id: 'd4', company: 'North Ridge Clinic', contact: 'Dr. Ama Ofori', stage: 'Prospect', value: 2200, score: 51, source: 'Atlas Leaderboard' },
  { id: 'd5', company: 'Mango Room', contact: 'Kwame Tetteh', stage: 'Won', value: 5200, score: 96, source: 'Referral' },
  { id: 'd6', company: 'Volta Works', contact: 'Yaw Aboagye', stage: 'Lost', value: 1900, score: 42, source: 'Outbound' },
];

export const initialClients: Client[] = [
  { id: 'c1', name: 'Amani Stays', sector: 'Boutique hospitality', location: 'Osu, Accra', initials: 'AS', score: 84, profile: 91, reviews: 76, photos: 88, notes: ['New rooftop listing is live.', 'Owner wants more weekday bookings.'], upsells: ['Review response system', 'Photo refresh'], history: [62, 67, 70, 76, 79, 84] },
  { id: 'c2', name: 'Mango Room', sector: 'Contemporary dining', location: 'Labone, Accra', initials: 'MR', score: 72, profile: 79, reviews: 68, photos: 62, notes: ['Strong review velocity this month.'], upsells: ['Local SEO sprint', 'Menu photography'], history: [51, 56, 61, 64, 69, 72] },
  { id: 'c3', name: 'North Ridge Clinic', sector: 'Private healthcare', location: 'North Ridge, Accra', initials: 'NC', score: 57, profile: 61, reviews: 49, photos: 43, notes: ['Business hours need confirmation.'], upsells: ['Profile rebuild', 'Patient review campaign'], history: [43, 46, 48, 52, 55, 57] },
  { id: 'c4', name: 'Kente House', sector: 'Design retail', location: 'East Legon, Accra', initials: 'KH', score: 91, profile: 95, reviews: 89, photos: 93, notes: ['Top 3 for “handmade Ghana gifts”.'], upsells: ['Competitor watch'], history: [73, 78, 81, 86, 89, 91] },
];

export const activities: Activity[] = [
  { id: 'a1', kind: 'DEAL', title: 'Proposal moved forward', detail: 'Amani Stays · $4,800 opportunity', time: '09:42', tone: 'gold' },
  { id: 'a2', kind: 'SCORE', title: 'Visibility score improved', detail: 'Mango Room · 68 → 72', time: '09:18', tone: 'teal' },
  { id: 'a3', kind: 'SYSTEM', title: 'Scout AI completed a sweep', detail: '18 hospitality leads added to pipeline', time: '08:56', tone: 'slate' },
  { id: 'a4', kind: 'PAYMENT', title: 'Payment received', detail: 'Kente House · $1,200 retainer', time: 'Yesterday', tone: 'gold' },
  { id: 'a5', kind: 'NOTE', title: 'Client note added', detail: 'North Ridge Clinic · visibility audit', time: 'Yesterday', tone: 'teal' },
];

export const stages: Stage[] = ['Prospect', 'Contacted', 'Replied', 'Proposal Sent', 'Won', 'Lost'];

export const indexBusinesses = [
  { rank: 1, name: 'Kente House', category: 'Design retail', location: 'East Legon', score: 94, trend: '+3.2' },
  { rank: 2, name: 'Amani Stays', category: 'Hospitality', location: 'Osu', score: 91, trend: '+5.8' },
  { rank: 3, name: 'The Good Baker', category: 'Food & drink', location: 'Cantonments', score: 88, trend: '+1.4' },
  { rank: 4, name: 'Mango Room', category: 'Restaurant', location: 'Labone', score: 85, trend: '+4.1' },
  { rank: 5, name: 'Kōbō Studio', category: 'Wellness', location: 'Airport', score: 82, trend: '-0.8' },
  { rank: 6, name: 'North Ridge Clinic', category: 'Healthcare', location: 'North Ridge', score: 79, trend: '+2.0' },
];

export const initialTransactions = [
  { id: 't1', date: 'Oct 24', description: 'Mango Room retainer', category: 'Revenue', amount: 2800 },
  { id: 't2', date: 'Oct 22', description: 'Kente House retainer', category: 'Revenue', amount: 1200 },
  { id: 't3', date: 'Oct 21', description: 'Cloud infrastructure', category: 'Operations', amount: -184 },
  { id: 't4', date: 'Oct 18', description: 'Amani Stays project', category: 'Revenue', amount: 2400 },
];

export const initialExpenses = [
  { id: 'e1', date: 'Oct 23', description: 'Coworking membership', category: 'Workspace', amount: 220 },
  { id: 'e2', date: 'Oct 19', description: 'Contractor — research', category: 'People', amount: 480 },
  { id: 'e3', date: 'Oct 14', description: 'Domain & software', category: 'Tools', amount: 96 },
];