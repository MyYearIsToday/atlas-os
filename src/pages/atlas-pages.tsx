import { useState } from 'react';
import type { Client, Deal, Stage } from '@/lib/atlas-data';
import { activities, employees, indexBusinesses, initialClients, initialDeals, initialExpenses, initialTransactions, stages } from '@/lib/atlas-data';
import { MetricCard, PageIntro, SectionLabel } from '@/components/atlas-shell';
import { calculateVisibilityScore } from '@/services/visibility-score';
import { summarizeToday, useMissionQueue } from '@/services/mission-queue';
import { Link } from 'wouter';
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, Check, ChevronRight,
  CircleDollarSign, Clock3, CloudOff, Copy, Download, ExternalLink, FileText, Filter, Flame,
  Gauge, LockKeyhole, MapPin, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search, Send,
  Settings2, ShieldCheck, SlidersHorizontal, Star, Target, TrendingUp, UserRound,
  WalletCards, X, Zap,
} from 'lucide-react';

const money = (value: number) => `$${value.toLocaleString('en-US')}`;
const cardClass = 'card-glow rounded-xl border border-[#233247] bg-[#0d1a2b]/90';
const buttonClass = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d] active:translate-y-0';
const ghostButton = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0d1a2b] px-3.5 py-2.5 text-[11px] font-semibold text-[#b6c3d1] transition-colors hover:border-[#d4af37] hover:text-white';
function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const stored = localStorage.getItem(key); return stored ? JSON.parse(stored) as T : initial; } catch { return initial; }
  });
  const setPersisted = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      try { localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* local mode remains usable */ }
      return resolved;
    });
  };
  return [value, setPersisted] as const;
}

function ChartBars() {
  const bars = [35, 44, 39, 52, 48, 61, 57, 71, 64, 76, 72, 88];
  return <div className="flex h-36 items-end gap-1.5 sm:gap-3">{bars.map((height, index) => <div key={index} className="group flex h-full flex-1 items-end"><div className={`relative w-full rounded-t-[4px] transition-all duration-300 group-hover:bg-[#e1bf4d] ${index > 8 ? 'bg-[#d4af37]' : 'bg-[#47617f]'}`} style={{ height: `${height}%` }}><span className="absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-[#07111f] px-1.5 py-1 font-mono text-[8px] text-[#d4af37] group-hover:block">{index + 1}.2k</span></div></div>)}</div>;
}

function ProgressBar({ value, color = '#d4af37' }: { value: number; color?: string }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-[#1b2a3d]"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, backgroundColor: color }} /></div>;
}

function Avatar({ initials, color = '#d4af37', size = 'md' }: { initials: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-7 w-7 text-[9px]', md: 'h-9 w-9 text-[10px]', lg: 'h-12 w-12 text-[12px]' };
  return <span className={`flex shrink-0 items-center justify-center rounded-lg font-display font-bold ${sizes[size]}`} style={{ backgroundColor: `${color}20`, color }}>{initials}</span>;
}

export function DashboardPage() {
  const { tasks } = useMissionQueue();
  const todaysMission = summarizeToday(tasks);
  const money2 = (value: number) => `GH₵ ${value.toLocaleString('en-GH')}`;
  const kpis = [
    { label: 'Revenue', value: 'GH₵ 42,850', change: '+18.4%', detail: 'vs. GH₵ 36,200 last month', icon: TrendingUp, accent: '#d4af37' },
    { label: 'Leads', value: '184', change: '+24', detail: 'qualified this month', icon: Target, accent: '#16a085' },
    { label: 'Clients', value: '32', change: '+6', detail: 'active accounts', icon: UserRound, accent: '#6c9ed8' },
    { label: 'Visibility Score', value: '74', change: '+8 pts', detail: 'portfolio average', icon: Gauge, accent: '#bb8be4' },
    { label: 'Trading Locked', value: 'ON', change: 'Protected', detail: 'capital controls active', icon: LockKeyhole, accent: '#e28c76' },
  ];
  return <div className="mx-auto max-w-[1440px]">
    <PageIntro eyebrow="Monday, 28 October 2024 · 09:47 GMT" title="Good morning, Kofi." description="Here is the signal from across MapSpark. Your company is moving in the right direction." action={<button className={buttonClass} onClick={() => window.location.reload()} data-testid="button-refresh-dashboard"><RefreshCw size={14} /> Refresh signal</button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{kpis.map((metric, index) => <div className={`fade-up delay-${Math.min(index + 1, 3)}`} key={metric.label}><MetricCard {...metric} /></div>)}</div>
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <section className={`${cardClass} fade-up p-5 sm:p-6`}><SectionLabel action={<button className="font-mono text-[9px] uppercase tracking-wider text-[#d4af37] hover:text-[#ebcd6e]" data-testid="button-view-revenue">View report <ChevronRight size={12} className="inline" /></button>}>Revenue velocity</SectionLabel><div className="mb-5 flex items-end justify-between"><div><span className="font-display text-3xl font-semibold tracking-[-.06em] text-white">$28,410</span><span className="ml-2 font-mono text-[10px] text-[#42c7a8]">+18.4%</span><p className="mt-1 text-[11px] text-[#71839a]">Collected revenue · last 12 months</p></div><div className="flex items-center gap-1 font-mono text-[9px] text-[#71839a]"><span className="h-2 w-2 rounded-sm bg-[#47617f]" /> 2023 <span className="ml-2 h-2 w-2 rounded-sm bg-[#d4af37]" /> 2024</div></div><ChartBars /><div className="mt-3 flex justify-between px-1 font-mono text-[9px] text-[#5f728a]">{['NOV','DEC','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT'].map((month) => <span key={month}>{month}</span>)}</div></section>
      <section className={`${cardClass} fade-up delay-1 p-5 sm:p-6`}><SectionLabel action={<span className="flex items-center gap-1.5 font-mono text-[9px] text-[#42c7a8]"><span className="h-1.5 w-1.5 rounded-full bg-[#16a085]" /> LIVE</span>}>Today's mission</SectionLabel><div className="rounded-lg border border-[#3d3723] bg-[#171a22] p-4"><div className="flex items-start justify-between"><div className="flex items-center gap-2"><span className="rounded-md bg-[#d4af3718] p-2 text-[#d4af37]"><Flame size={16} /></span><div><p className="font-display text-[13px] font-semibold text-white">Mission Queue snapshot</p><p className="mt-0.5 font-mono text-[9px] text-[#8798ad]">{todaysMission.employeesWorking} / {todaysMission.totalEmployees} AI employees working</p></div></div></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-[#0d1017] p-2.5"><p className="font-display text-[16px] font-semibold text-white">{todaysMission.pending}</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-[#71839a]">Pending</p></div><div className="rounded-lg bg-[#0d1017] p-2.5"><p className="font-display text-[16px] font-semibold text-[#d4af37]">{todaysMission.inProgress}</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-[#71839a]">In progress</p></div><div className="rounded-lg bg-[#0d1017] p-2.5"><p className="font-display text-[16px] font-semibold text-[#e28c76]">{todaysMission.awaitingApproval}</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-[#71839a]">Awaiting approval</p></div></div><p className="mt-4 flex items-center justify-between font-mono text-[9px] text-[#8798ad]"><span>Estimated value in motion</span><span className="text-[#42c7a8]">{money2(todaysMission.estimatedValueInMotion)}</span></p><p className="mt-1 text-[9px] leading-4 text-[#5f738b]">Development estimate from linked CRM deals — not measured revenue.</p></div><Link href="/mission-queue" className="mt-4 flex w-full items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#d4af37] hover:text-[#ebcd6e]" data-testid="button-open-mission">Open Mission Queue <ExternalLink size={11} /></Link></section>
    </div>
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section><SectionLabel action={<button className={ghostButton} data-testid="button-view-all-activity">View all <ChevronRight size={13} /></button>}>Live activity</SectionLabel><div className={`${cardClass} divide-y divide-[#233247] overflow-hidden`}>{activities.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 p-4 transition-colors hover:bg-white/[.025]"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tone === 'gold' ? 'bg-[#d4af3718] text-[#d4af37]' : item.tone === 'teal' ? 'bg-[#16a08518] text-[#42c7a8]' : 'bg-[#6e829a18] text-[#93a9c2]'}`}>{item.kind === 'DEAL' ? <Target size={15} /> : item.kind === 'SCORE' ? <Gauge size={15} /> : item.kind === 'PAYMENT' ? <CircleDollarSign size={15} /> : <Activity size={15} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-[12px] font-medium text-[#e0e7ef]">{item.title}</p><span className="font-mono text-[9px] text-[#61748d]">{item.time}</span></div><p className="mt-1 text-[11px] text-[#74879d]">{item.detail}</p></div></div>)}</div></section>
      <section><SectionLabel>AI fleet status</SectionLabel><div className={`${cardClass} divide-y divide-[#233247] overflow-hidden`}>{employees.slice(0, 4).map((employee) => <div className="flex items-center gap-3 p-3.5" key={employee.id}><Avatar initials={employee.initials} color={employee.color} size="sm" /><div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-[#e0e7ef]">{employee.name}</p><p className="mt-0.5 truncate text-[10px] text-[#74879d]">{employee.task}</p></div><span className={`font-mono text-[8px] uppercase tracking-wider ${employee.status === 'Working' ? 'text-[#42c7a8]' : employee.status === 'Complete' ? 'text-[#d4af37]' : 'text-[#7d8ea3]'}`}>{employee.status}</span></div>)}<Link href="/employees" className="flex items-center justify-center gap-1 border-t border-[#233247] p-3 font-mono text-[9px] uppercase tracking-wider text-[#d4af37] hover:bg-white/[.025]" data-testid="link-view-employees">View all employees <ChevronRight size={12} /></Link></div></section>
    </div>
  </div>;
}

export function EmployeesPage() {
  const [selected, setSelected] = useState<string | null>(null);
  return <div className="mx-auto max-w-[1440px]"><PageIntro eyebrow="Autonomous operating layer" title="AI Employees" description="Five specialized operators keep the company moving while you stay on the highest-leverage decisions." action={<button className={ghostButton} data-testid="button-fleet-settings"><Settings2 size={14} /> Fleet settings</button>} /><div className="mb-5 flex items-center justify-between rounded-xl border border-[#233247] bg-[#0c192a] px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#16a08518] text-[#42c7a8]"><Bot size={16} /></span><div><p className="text-[11px] font-semibold text-white">Autonomy is healthy</p><p className="mt-0.5 text-[10px] text-[#71839a]">All five agents checked in within the last hour.</p></div></div><span className="font-mono text-[10px] text-[#42c7a8]">5 / 5 ONLINE</span></div><div className="grid gap-4 lg:grid-cols-2">{employees.map((employee, index) => <article key={employee.id} className={`${cardClass} fade-up delay-${Math.min(index + 1, 3)} p-5 transition-transform hover:-translate-y-0.5 ${selected === employee.id ? 'border-[#d4af37]' : ''}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><Avatar initials={employee.initials} color={employee.color} size="lg" /><div><h3 className="font-display text-[14px] font-semibold text-white">{employee.name}</h3><p className="mt-1 text-[10px] text-[#7f91a7]">{employee.role}</p></div></div><button className="rounded-md p-1.5 text-[#71839a] hover:bg-white/[.06] hover:text-white" data-testid={`button-employee-menu-${employee.id}`} aria-label={`Open ${employee.name} menu`}><MoreHorizontal size={17} /></button></div><div className="mt-6 rounded-lg border border-[#233247] bg-[#0a1625] p-3.5"><p className="font-mono text-[9px] uppercase tracking-[.14em] text-[#60758d]">Current task</p><p className="mt-2 text-[12px] leading-5 text-[#d1dce7]">{employee.task}</p><div className="mt-3 flex items-center gap-2"><ProgressBar value={employee.status === 'Complete' ? 100 : employee.status === 'Waiting' ? 38 : 68} color={employee.color} /><span className="font-mono text-[9px] text-[#7689a0]">{employee.status === 'Complete' ? '100%' : employee.status === 'Waiting' ? '38%' : '68%'}</span></div></div><div className="mt-4 flex items-center justify-between"><span className="flex items-center gap-1.5 text-[10px] text-[#71839a]"><Clock3 size={12} /> Last update {employee.update}</span><button className={selected === employee.id ? buttonClass : ghostButton} onClick={() => setSelected((value) => value === employee.id ? null : employee.id)} data-testid={`button-open-employee-${employee.id}`}>{selected === employee.id ? 'Close brief' : 'Open brief'} <ChevronRight size={12} /></button></div></article>)}</div></div>;
}

function DealCard({ deal, onStageChange }: { deal: Deal; onStageChange: (id: string, stage: Stage) => void }) {
  return <div className="rounded-lg border border-[#26374e] bg-[#101f31] p-3.5 shadow-[0_5px_15px_rgba(0,0,0,.08)] transition-transform hover:-translate-y-0.5"><div className="flex items-start justify-between gap-2"><div><p className="font-display text-[12px] font-semibold text-white">{deal.company}</p><p className="mt-1 text-[10px] text-[#8798ad]">{deal.contact}</p></div><button className="rounded-md p-1 text-[#6f839a] hover:bg-white/[.06] hover:text-white" data-testid={`button-deal-menu-${deal.id}`} aria-label={`Menu for ${deal.company}`}><MoreHorizontal size={14} /></button></div><div className="mt-4 flex items-end justify-between"><span className="font-mono text-[13px] font-semibold text-[#d4af37]">{money(deal.value)}</span><span className="flex items-center gap-1 font-mono text-[9px] text-[#42c7a8]"><Zap size={10} /> {deal.score}</span></div><div className="mt-3 flex items-center justify-between border-t border-[#233247] pt-3"><span className="text-[9px] text-[#6f839a]">{deal.source}</span><select value={deal.stage} onChange={(event) => onStageChange(deal.id, event.target.value as Stage)} className="max-w-[105px] bg-transparent text-right font-mono text-[9px] text-[#9dafc0] outline-none" data-testid={`select-stage-${deal.id}`} aria-label={`Stage for ${deal.company}`}>{stages.map((stage) => <option className="bg-[#0b1f3a]" key={stage} value={stage}>{stage}</option>)}</select></div></div>;
}

export function CrmPage() {
  const [deals, setDeals] = useLocalState<Deal[]>('atlas-deals', initialDeals);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ company: '', contact: '', value: '', stage: 'Prospect' as Stage });
  const filtered = deals.filter((deal) => `${deal.company} ${deal.contact}`.toLowerCase().includes(query.toLowerCase()));
  const addDeal = () => { if (!draft.company.trim()) return; setDeals((current) => [...current, { id: `d${Date.now()}`, company: draft.company, contact: draft.contact || 'New contact', stage: draft.stage, value: Number(draft.value) || 0, score: 50, source: 'Manual' }]); setDraft({ company: '', contact: '', value: '', stage: 'Prospect' }); setShowAdd(false); };
  return <div className="mx-auto max-w-[1440px]"><PageIntro eyebrow="Revenue engine" title="CRM pipeline" description="A clear view of every conversation between MapSpark and its next client." action={<button className={buttonClass} onClick={() => setShowAdd(true)} data-testid="button-add-deal"><Plus size={14} /> Add opportunity</button>} /><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-1 items-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0c1a2c] px-3 py-2.5 sm:max-w-xs"><Search size={15} className="text-[#71839a]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pipeline" className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#667990]" data-testid="input-search-pipeline" /></div><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-[#71839a]">{filtered.length} opportunities</span><button className={ghostButton} data-testid="button-filter-pipeline"><Filter size={13} /> Filter</button></div></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">{stages.map((stage) => { const stageDeals = filtered.filter((deal) => deal.stage === stage); const total = stageDeals.reduce((sum, deal) => sum + deal.value, 0); return <section key={stage} className="min-w-0"><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${stage === 'Won' ? 'bg-[#16a085]' : stage === 'Lost' ? 'bg-[#d65c63]' : 'bg-[#d4af37]'}`} /><h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#acbac9]">{stage}</h3></div><span className="rounded bg-[#192a3e] px-1.5 py-0.5 font-mono text-[9px] text-[#71839a]">{stageDeals.length}</span></div><p className="mb-3 font-mono text-[10px] text-[#61758d]">{money(total)}</p><div className="space-y-2.5">{stageDeals.map((deal) => <DealCard key={deal.id} deal={deal} onStageChange={(id, nextStage) => setDeals((current) => current.map((item) => item.id === id ? { ...item, stage: nextStage } : item))} />)}{stageDeals.length === 0 && <div className="rounded-lg border border-dashed border-[#2a3b51] p-7 text-center"><p className="font-mono text-[9px] text-[#5f738b]">No opportunities</p></div>}</div></section>; })}</div>{showAdd && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020812]/70 p-4 backdrop-blur-sm"><div className={`${cardClass} w-full max-w-md p-5`} role="dialog" aria-modal="true"><div className="flex items-center justify-between"><h3 className="font-display text-[16px] font-semibold text-white">New opportunity</h3><button onClick={() => setShowAdd(false)} className="text-[#71839a] hover:text-white" data-testid="button-close-add-deal"><X size={18} /></button></div><div className="mt-5 space-y-3"><label className="block"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Company</span><input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" placeholder="Company name" data-testid="input-deal-company" /></label><label className="block"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Contact</span><input value={draft.contact} onChange={(event) => setDraft({ ...draft, contact: event.target.value })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" placeholder="Decision maker" data-testid="input-deal-contact" /></label><div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Value (USD)</span><input type="number" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" placeholder="2500" data-testid="input-deal-value" /></label><label className="block"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Stage</span><select value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value as Stage })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" data-testid="select-deal-stage">{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label></div></div><button className={`mt-5 w-full ${buttonClass}`} onClick={addDeal} data-testid="button-save-deal"><Plus size={14} /> Add to pipeline</button></div></div>}</div>;
}

function MiniSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values); const min = Math.min(...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${34 - ((value - min) / (max - min || 1)) * 28}`).join(' ');
  return <svg viewBox="0 0 100 36" className="h-9 w-24 overflow-visible"><polyline points={points} fill="none" stroke="#d4af37" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="100" cy={34 - ((values[values.length - 1] - min) / (max - min || 1)) * 28} r="2.2" fill="#d4af37" /></svg>;
}

export function ClientsPage() {
  const [clients, setClients] = useLocalState<Client[]>('atlas-clients', initialClients);
  const [active, setActive] = useState<Client | null>(null);
  const [note, setNote] = useState('');
  const saveNote = () => { if (!active || !note.trim()) return; const next = { ...active, notes: [note.trim(), ...active.notes] }; setClients((current) => current.map((client) => client.id === active.id ? next : client)); setActive(next); setNote(''); };
  return <div className="mx-auto max-w-[1440px]"><PageIntro eyebrow="Relationship layer" title="Clients" description="The operating picture for every business trusting MapSpark with their next chapter." action={<button className={ghostButton} data-testid="button-export-clients"><Download size={14} /> Export view</button>} /><div className="grid gap-4 xl:grid-cols-2">{clients.map((client, index) => <article key={client.id} className={`${cardClass} fade-up delay-${Math.min(index + 1, 3)} cursor-pointer p-5 transition-transform hover:-translate-y-0.5 hover:border-[#3c4d64]`} onClick={() => setActive(client)} data-testid={`card-client-${client.id}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><Avatar initials={client.initials} color={index % 2 ? '#16a085' : '#d4af37'} size="lg" /><div><h3 className="font-display text-[14px] font-semibold text-white">{client.name}</h3><p className="mt-1 flex items-center gap-1.5 text-[10px] text-[#7b8ea5]"><MapPin size={11} /> {client.location} · {client.sector}</p></div></div><div className="text-right"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Score</p><p className={`mt-1 font-display text-xl font-semibold ${client.score >= 80 ? 'text-[#42c7a8]' : 'text-[#d4af37]'}`}>{client.score}</p></div></div><div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-4"><div><div className="mb-2 flex justify-between font-mono text-[9px] text-[#71839a]"><span>Visibility trend</span><span className="text-[#42c7a8]">+{client.history.at(-1)! - client.history[0]} pts</span></div><MiniSparkline values={client.history} /></div><div className="space-y-1.5 text-right font-mono text-[9px] text-[#71839a]"><p>Profile <span className="ml-2 text-[#c3cfdb]">{client.profile}%</span></p><p>Reviews <span className="ml-2 text-[#c3cfdb]">{client.reviews}%</span></p><p>Photos <span className="ml-2 text-[#c3cfdb]">{client.photos}%</span></p></div></div><div className="mt-4 flex items-center justify-between border-t border-[#233247] pt-3"><span className="flex items-center gap-1.5 font-mono text-[9px] text-[#71839a]"><MessageSquare size={11} /> {client.notes.length} notes</span><span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#d4af37]">Open profile <ChevronRight size={11} /></span></div></article>)}</div>{active && <div className="fixed inset-0 z-50 flex justify-end bg-[#020812]/65 backdrop-blur-sm" onClick={() => setActive(null)}><aside className="scrollbar h-full w-full max-w-lg overflow-y-auto border-l border-[#2c3c52] bg-[#0b1f3a] p-5 sm:p-7" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><Avatar initials={active.initials} color="#d4af37" size="lg" /><div><p className="font-display text-[17px] font-semibold text-white">{active.name}</p><p className="mt-1 text-[11px] text-[#8798ad]">{active.sector} · {active.location}</p></div></div><button onClick={() => setActive(null)} className="rounded-md p-2 text-[#71839a] hover:bg-white/[.06] hover:text-white" data-testid="button-close-client"><X size={18} /></button></div><div className="mt-7 grid grid-cols-3 gap-2">{[['Score', active.score], ['Reviews', active.reviews], ['Photos', active.photos]].map(([label, value]) => <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3" key={label}><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">{label}</p><p className="mt-2 font-display text-xl font-semibold text-white">{value}</p></div>)}</div><div className="mt-7"><SectionLabel>Score history</SectionLabel><div className="rounded-lg border border-[#233247] bg-[#091828] p-4"><MiniSparkline values={active.history} /><div className="mt-2 flex justify-between font-mono text-[9px] text-[#71839a]"><span>May</span><span>Oct 24</span></div></div></div><div className="mt-7"><SectionLabel action={<button className="text-[#d4af37]" data-testid="button-add-client-note"><Plus size={14} /></button>}>Notes</SectionLabel><div className="space-y-2">{active.notes.map((item, index) => <div key={index} className="rounded-lg border border-[#233247] bg-[#091828] p-3 text-[11px] leading-5 text-[#b7c5d4]">{item}</div>)}</div><div className="mt-3 flex gap-2"><input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveNote(); }} className="min-w-0 flex-1 rounded-lg border border-[#2a3c54] bg-[#091828] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" placeholder="Add an internal note" data-testid="input-client-note" /><button onClick={saveNote} className={buttonClass} data-testid="button-save-client-note"><Send size={13} /></button></div></div><div className="mt-7"><SectionLabel>Upsell opportunities</SectionLabel><div className="space-y-2">{active.upsells.map((upsell) => <div key={upsell} className="flex items-center justify-between rounded-lg border border-[#284456] bg-[#0e2731] px-3 py-3"><span className="text-[11px] text-[#cae1dc]">{upsell}</span><button className="font-mono text-[9px] uppercase tracking-wider text-[#42c7a8]" data-testid={`button-pursue-${upsell.toLowerCase().replaceAll(' ', '-')}`}>Pursue <ChevronRight size={11} className="inline" /></button></div>)}</div></div></aside></div>}</div>;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 61; const circumference = 2 * Math.PI * radius; const offset = circumference - (score / 100) * circumference;
  return <div className="relative h-44 w-44"><svg viewBox="0 0 150 150" className="-rotate-90"><circle cx="75" cy="75" r={radius} fill="none" stroke="#1d3046" strokeWidth="9" /><circle cx="75" cy="75" r={radius} fill="none" stroke="#d4af37" strokeWidth="9" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="font-display text-4xl font-semibold tracking-[-.08em] text-white">{score}</span><span className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">out of 100</span></div></div>;
}

export function VisibilityPage() {
  const [inputs, setInputs] = useLocalState('atlas-visibility-inputs', { profile: 84, reviews: 68, photos: 72, seo: 61, info: 92, engagement: 57 });
  const [shared, setShared] = useState(false);
  const scoreResult = calculateVisibilityScore({
    profileCompleteness: inputs.profile,
    reviews: inputs.reviews,
    photos: inputs.photos,
    localSeo: inputs.seo,
    businessInfo: inputs.info,
    engagement: inputs.engagement,
  });
  const score = scoreResult.total;
  const fields = [{ key: 'profile', label: 'Profile Completeness', detail: 'Description, categories, services', icon: UserRound }, { key: 'reviews', label: 'Reviews', detail: 'Volume, velocity, sentiment', icon: Star }, { key: 'photos', label: 'Photos', detail: 'Quality, freshness, coverage', icon: FileText }, { key: 'seo', label: 'Local SEO', detail: 'Search ranking and citations', icon: Search }, { key: 'info', label: 'Business Info', detail: 'Accuracy across directories', icon: ShieldCheck }, { key: 'engagement', label: 'Engagement', detail: 'Clicks, calls, direction requests', icon: Activity }] as const;
  const update = (key: keyof typeof inputs, value: number) => setInputs((current) => ({ ...current, [key]: value }));
  const share = () => { setShared(true); navigator.clipboard?.writeText(`Atlas visibility report · score ${score}/100`); };
  return <div className="mx-auto max-w-[1200px]"><PageIntro eyebrow="Signal generator" title="Visibility score" description="Model how discoverable a business is right now, then turn the gaps into a precise action plan." action={<button className={buttonClass} onClick={share} data-testid="button-share-report">{shared ? <Check size={14} /> : <Copy size={14} />} {shared ? 'Report link copied' : 'Share report'}</button>} /><div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]"><section className={`${cardClass} flex flex-col items-center justify-center p-7 text-center sm:p-10`}><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#d4af37]">Current signal</p><div className="mt-5"><ScoreRing score={score} /></div><p className="mt-3 font-display text-[15px] font-semibold text-white">{scoreResult.grade} local presence</p><p className="mt-2 max-w-xs text-[11px] leading-5 text-[#71839a]">Calculated from six weighted signals for how customers find and choose businesses in Ghana.</p><p className="mt-3 max-w-xs text-[10px] leading-5 text-[#42c7a8]">{scoreResult.recommendation}</p><button className="mt-6 flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-[#42c7a8]" data-testid="button-recalculate"><RefreshCw size={12} /> Recalculate signal</button></section><section className={`${cardClass} p-5 sm:p-7`}><div className="mb-5 flex items-center justify-between"><div><p className="font-display text-[15px] font-semibold text-white">Score inputs</p><p className="mt-1 text-[11px] text-[#71839a]">Adjust the signal to model a growth scenario.</p></div><SlidersHorizontal size={18} className="text-[#71839a]" /></div><div className="space-y-5">{fields.map(({ key, label, detail, icon: Icon }) => <div key={key}><div className="mb-2 flex items-center gap-3"><span className="rounded-md bg-[#d4af3715] p-2 text-[#d4af37]"><Icon size={14} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><p className="text-[11px] font-medium text-[#dbe4ed]">{label}</p><span className="font-mono text-[11px] font-semibold text-white">{inputs[key]}</span></div><p className="mt-0.5 text-[10px] text-[#71839a]">{detail}</p></div></div><input type="range" min="0" max="100" value={inputs[key]} onChange={(event) => update(key, Number(event.target.value))} className="h-1.5 w-full cursor-pointer accent-[#d4af37]" data-testid={`input-score-${key}`} /></div>)}</div></section></div><div className="mt-5 grid gap-5 md:grid-cols-2"><section className={`${cardClass} p-5`}><SectionLabel>Recommended next moves</SectionLabel><div className="space-y-2.5">{fields.filter(({ key }) => inputs[key] < 75).slice(0, 3).map(({ label, key }, index) => <div className="flex items-center gap-3 rounded-lg bg-[#101f31] px-3 py-3" key={key}><span className="font-mono text-[10px] text-[#d4af37]">0{index + 1}</span><span className="flex-1 text-[11px] text-[#c7d3df]">Improve {label.toLowerCase()}</span><span className="font-mono text-[9px] text-[#e28c76]">-{75 - inputs[key]} pts</span></div>)}</div></section><section className={`${cardClass} p-5`}><SectionLabel>Report preview</SectionLabel><div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-4"><div className="flex items-center justify-between"><span className="font-display text-[12px] font-semibold text-white">Amani Stays</span><span className="font-mono text-[9px] text-[#71839a]">ATLAS REPORT · OCT 24</span></div><div className="mt-4 flex items-center gap-4"><div className="font-display text-3xl font-semibold text-[#d4af37]">{score}</div><div><p className="text-[11px] font-medium text-white">Visibility score</p><p className="mt-1 text-[10px] text-[#71839a]">Top 18% of businesses in Accra</p></div></div><div className="mt-4"><ProgressBar value={score} /></div></div></section></div></div>;
}

export function LeaderboardPage() {
  const [search, setSearch] = useState('');
  const visible = indexBusinesses.filter((business) => `${business.name} ${business.category} ${business.location}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageIntro
        eyebrow="Market intelligence"
        title="Atlas Leaderboard"
        description="The living leaderboard of discoverability across Accra. Find the signal, understand the gap, create the opportunity."
        action={
          <button className={ghostButton} data-testid="button-index-methodology">
            <HelpCircleIcon /> Methodology
          </button>
        }
      />
      <div className={`${cardClass} mb-5 overflow-hidden p-5 sm:p-7`}>
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="pulse-dot h-2 w-2 rounded-full bg-[#16a085]" />
              <span className="font-mono text-[9px] uppercase tracking-[.18em] text-[#42c7a8]">
                Accra · Live leaderboard
              </span>
            </div>
            <h3 className="mt-3 font-display text-2xl font-semibold tracking-[-.05em] text-white">
              Who is winning the local search game?
            </h3>
            <p className="mt-2 max-w-lg text-[11px] leading-5 text-[#71839a]">
              A composite signal from reviews, profile health, content freshness
              and customer engagement.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">
                Businesses tracked
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-white">2,418</p>
            </div>
            <div className="h-10 w-px bg-[#2a3c54]" />
            <div className="text-right">
              <p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">
                Avg. score
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-[#d4af37]">67.4</p>
            </div>
          </div>
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0c1a2c] px-3 py-2.5 sm:max-w-sm">
          <Search size={15} className="text-[#71839a]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#667990]"
            placeholder="Search businesses, sectors, areas"
            data-testid="input-search-index"
          />
        </div>
        <button className={ghostButton} data-testid="button-index-filter">
          <Filter size={13} /> <span className="hidden sm:inline">Filter</span>
        </button>
      </div>
      <div className={`${cardClass} overflow-hidden`}>
        <div className="hidden grid-cols-[60px_1.5fr_1fr_1fr_100px_90px] border-b border-[#233247] bg-[#101e30] px-5 py-3 font-mono text-[9px] uppercase tracking-wider text-[#64778e] sm:grid">
          <span>Rank</span>
          <span>Business</span>
          <span>Category</span>
          <span>Location</span>
          <span>Atlas score</span>
          <span>30d trend</span>
        </div>
        {visible.map((business) => (
          <div
            key={business.name}
            className="grid grid-cols-[45px_1fr_auto] items-center gap-3 border-b border-[#233247] px-4 py-4 last:border-0 sm:grid-cols-[60px_1.5fr_1fr_1fr_100px_90px] sm:px-5"
          >
            <span className={`font-display text-sm font-semibold ${business.rank <= 3 ? 'text-[#d4af37]' : 'text-[#71839a]'}`}>
              {String(business.rank).padStart(2, '0')}
            </span>
            <div>
              <p className="text-[12px] font-semibold text-white">{business.name}</p>
              <p className="mt-1 text-[10px] text-[#71839a] sm:hidden">
                {business.category} · {business.location}
              </p>
            </div>
            <span className="hidden text-[11px] text-[#9babbc] sm:block">{business.category}</span>
            <span className="hidden items-center gap-1 text-[11px] text-[#9babbc] sm:flex">
              <MapPin size={11} /> {business.location}
            </span>
            <div className="text-right sm:text-left">
              <span className="font-mono text-[12px] font-semibold text-[#d4af37]">
                {business.score}
              </span>
              <span className="ml-2 font-mono text-[9px] text-[#42c7a8] sm:hidden">
                {business.trend}%
              </span>
            </div>
            <span className={`hidden font-mono text-[10px] sm:block ${business.trend.startsWith('-') ? 'text-[#e28c76]' : 'text-[#42c7a8]'}`}>
              {business.trend}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HelpCircleIcon() { return <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">?</span>; }

export function FinancePage() {
  const [expenses, setExpenses] = useLocalState<typeof initialExpenses>('atlas-expenses', initialExpenses);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ description: '', category: 'Operations', amount: '' });
  const revenue = initialTransactions.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
  const cost = expenses.reduce((sum, item) => sum + item.amount, 0) + Math.abs(initialTransactions.find((item) => item.amount < 0)?.amount ?? 0);
  const addExpense = () => { if (!draft.description.trim() || !draft.amount) return; setExpenses((current) => [{ id: `e${Date.now()}`, date: 'Today', description: draft.description, category: draft.category, amount: Number(draft.amount) }, ...current]); setDraft({ description: '', category: 'Operations', amount: '' }); setShowAdd(false); };
  return <div className="mx-auto max-w-[1440px]"><PageIntro eyebrow="Capital & runway" title="Finance" description="Know what the business earned, what it spent, and what is deliberately off-limits for now." action={<button className={buttonClass} onClick={() => setShowAdd(true)} data-testid="button-add-expense"><Plus size={14} /> Log expense</button>} /><div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Revenue this month" value={money(revenue)} change="+22.1%" detail="4 incoming transactions" icon={TrendingUp} /><MetricCard label="Operating expenses" value={money(cost)} change="-8.6%" detail="vs. $1,012 last month" icon={ArrowDownRight} accent="#e28c76" /><MetricCard label="Net operating cash" value={money(revenue - cost)} change="+31.4%" detail="before tax & owner draw" icon={WalletCards} accent="#16a085" /></div><div className="mt-7 grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><section><SectionLabel action={<button className="font-mono text-[9px] uppercase tracking-wider text-[#d4af37]" data-testid="button-export-ledger"><Download size={12} className="mr-1 inline" /> Export CSV</button>}>Recent transactions</SectionLabel><div className={`${cardClass} overflow-hidden`}>{initialTransactions.map((item) => <div key={item.id} className="flex items-center gap-3 border-b border-[#233247] px-4 py-4 last:border-0"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.amount > 0 ? 'bg-[#16a08518] text-[#42c7a8]' : 'bg-[#d4af3718] text-[#d4af37]'}`}>{item.amount > 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span><div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-[#dce5ee]">{item.description}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[#71839a]">{item.date} · {item.category}</p></div><span className={`font-mono text-[12px] font-semibold ${item.amount > 0 ? 'text-[#42c7a8]' : 'text-[#d5a161]'}`}>{item.amount > 0 ? '+' : '-'}{money(Math.abs(item.amount))}</span></div>)}</div></section><section><SectionLabel>Expense tracker</SectionLabel><div className={`${cardClass} overflow-hidden`}>{expenses.map((item) => <div key={item.id} className="flex items-center gap-3 border-b border-[#233247] px-4 py-3.5 last:border-0"><span className="h-1.5 w-1.5 rounded-full bg-[#d4af37]" /><div className="min-w-0 flex-1"><p className="truncate text-[11px] text-[#c5d1de]">{item.description}</p><p className="mt-1 font-mono text-[9px] text-[#71839a]">{item.category} · {item.date}</p></div><span className="font-mono text-[11px] text-[#d5a161]">-{money(item.amount)}</span></div>)}<button onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-1.5 border-t border-[#233247] p-3 font-mono text-[9px] uppercase tracking-wider text-[#d4af37] hover:bg-white/[.025]" data-testid="button-add-expense-inline"><Plus size={12} /> Add expense</button></div></section></div><section className={`${cardClass} relative mt-5 overflow-hidden border-[#483f26] p-5 sm:p-7`}><div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_70%_50%,rgba(212,175,55,.08),transparent_60%)]" /><div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-4"><span className="rounded-lg bg-[#d4af3718] p-3 text-[#d4af37]"><LockKeyhole size={19} /></span><div><div className="flex items-center gap-2"><h3 className="font-display text-[14px] font-semibold text-white">Atlas Trading</h3><span className="rounded bg-[#d4af3718] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#d4af37]">Locked</span></div><p className="mt-2 max-w-lg text-[11px] leading-5 text-[#8293aa]">Algorithmic trading is intentionally paused while we complete financial controls and risk review. No capital is deployed.</p></div></div><button className={ghostButton} data-testid="button-trading-details"><LockKeyhole size={13} /> View controls</button></div></section>{showAdd && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020812]/70 p-4 backdrop-blur-sm"><div className={`${cardClass} w-full max-w-md p-5`} role="dialog" aria-modal="true"><div className="flex items-center justify-between"><h3 className="font-display text-[16px] font-semibold text-white">Log an expense</h3><button onClick={() => setShowAdd(false)} className="text-[#71839a] hover:text-white" data-testid="button-close-expense"><X size={18} /></button></div><div className="mt-5 space-y-3"><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" placeholder="What was this for?" data-testid="input-expense-description" /><div className="grid grid-cols-2 gap-3"><input type="number" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" placeholder="Amount" data-testid="input-expense-amount" /><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#d4af37]" data-testid="select-expense-category"><option>Operations</option><option>People</option><option>Workspace</option><option>Tools</option></select></div></div><button className={`mt-5 w-full ${buttonClass}`} onClick={addExpense} data-testid="button-save-expense"><Check size={14} /> Save expense</button></div></div>}</div>;
}

export function SettingsPage() {
  const [toggles, setToggles] = useLocalState('atlas-settings-toggles', { alerts: true, digest: true, autonomous: true, compact: false });
  const flip = (key: keyof typeof toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  const rows = [{ key: 'alerts' as const, title: 'Priority alerts', detail: 'Get notified when an opportunity changes stage or a client score drops.' }, { key: 'digest' as const, title: 'Daily operator digest', detail: 'A 08:00 summary of movement, blockers, and decisions waiting for you.' }, { key: 'autonomous' as const, title: 'Autonomous actions', detail: 'Allow Atlas agents to draft, schedule, and queue work without asking first.' }, { key: 'compact' as const, title: 'Compact data density', detail: 'Use tighter row spacing across pipeline and finance views.' }];
  return <div className="mx-auto max-w-[1000px]"><PageIntro eyebrow="Workspace controls" title="Settings" description="Shape the operating environment. Changes are saved to this device until Firebase is connected." action={<span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-[#42c7a8]"><span className="h-1.5 w-1.5 rounded-full bg-[#16a085]" /> Local changes saved</span>} /><div className="grid gap-5"><section className={`${cardClass} p-5 sm:p-7`}><SectionLabel>Workspace profile</SectionLabel><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Workspace name</span><input defaultValue="MapSpark Ghana" className="w-full rounded-lg border border-[#2a3c54] bg-[#091828] px-3.5 py-3 text-[12px] text-white outline-none focus:border-[#d4af37]" data-testid="input-workspace-name" /></label><label><span className="mb-2 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Timezone</span><select defaultValue="GMT" className="w-full rounded-lg border border-[#2a3c54] bg-[#091828] px-3.5 py-3 text-[12px] text-white outline-none focus:border-[#d4af37]" data-testid="select-timezone"><option>GMT</option><option>WAT</option><option>UTC</option></select></label></div><button className={`mt-5 ${buttonClass}`} data-testid="button-save-workspace"><Check size={13} /> Save workspace</button></section><section className={`${cardClass} p-5 sm:p-7`}><SectionLabel>Atlas behaviour</SectionLabel><div className="divide-y divide-[#233247]">{rows.map((row) => <div key={row.key} className="flex items-center justify-between gap-5 py-4 first:pt-0 last:pb-0"><div><p className="text-[12px] font-medium text-[#dce5ee]">{row.title}</p><p className="mt-1 max-w-xl text-[10px] leading-5 text-[#71839a]">{row.detail}</p></div><button onClick={() => flip(row.key)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${toggles[row.key] ? 'bg-[#16a085]' : 'bg-[#24354a]'}`} data-testid={`toggle-${row.key}`} aria-pressed={toggles[row.key]}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${toggles[row.key] ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>)}</div></section><section className={`${cardClass} overflow-hidden`}><div className="flex items-start gap-4 border-b border-[#5a4820] bg-[#201c12] p-5 sm:p-7"><span className="rounded-lg bg-[#d4af3718] p-3 text-[#d4af37]"><CloudOff size={19} /></span><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-[14px] font-semibold text-white">Firebase integration paused</h3><span className="rounded bg-[#d4af3718] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#d4af37]">Awaiting credentials</span></div><p className="mt-2 max-w-2xl text-[11px] leading-5 text-[#b5a77d]">Atlas is running in local mode. Your changes persist in this browser; live sync, authentication, and multi-device access will activate when the workspace credentials are added.</p></div></div><div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-7">{[['Local data', 'Active', true], ['Cloud sync', 'Paused', false], ['Authentication', 'Paused', false]].map(([label, status, active]) => <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3.5" key={label as string}><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">{label as string}</p><p className={`mt-2 flex items-center gap-1.5 text-[11px] font-semibold ${active ? 'text-[#42c7a8]' : 'text-[#d4af37]'}`}><span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[#16a085]' : 'bg-[#d4af37]'}`} />{status as string}</p></div>)}</div></section></div></div>;
}