import { useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3, Bell, Bot, BriefcaseBusiness, ChevronDown, CircleDollarSign, Command, Gauge,
  LayoutDashboard, ListTodo, Menu, PanelLeftClose, Search, Settings, Users, X,
} from 'lucide-react';

const nav = [
  { href: '/', label: 'Mission Control', icon: LayoutDashboard },
  { href: '/employees', label: 'AI Employees', icon: Bot },
  { href: '/mission-queue', label: 'Mission Queue', icon: ListTodo },
  { href: '/crm', label: 'CRM Pipeline', icon: Users },
  { href: '/clients', label: 'Clients', icon: BriefcaseBusiness },
  { href: '/visibility', label: 'Visibility Score', icon: Gauge },
  { href: '/atlas-leaderboard', label: 'Atlas Leaderboard', icon: BarChart3 },
  { href: '/finance', label: 'Finance', icon: CircleDollarSign },
];

export function AtlasShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const current = nav.find((item) => item.href === location);

  return (
    <div className="noise min-h-[100dvh] bg-[#07111f] text-[#e7edf4]">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[254px] flex-col border-r border-[#233247] bg-[#0b1f3a] transition-transform duration-300 ${collapsed ? 'lg:w-[78px]' : ''} ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className={`flex h-[74px] items-center border-b border-white/[.07] px-5 ${collapsed ? 'lg:justify-center lg:px-3' : 'justify-between'}`}>
          <Link href="/" className="flex items-center gap-3 focus-ring" onClick={() => setMobileOpen(false)} data-testid="link-brand">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#d4af37] text-[#0b1f3a] shadow-[0_8px_20px_rgba(212,175,55,.2)]"><Command size={19} strokeWidth={2.8} /></span>
            <span className={`font-display text-[15px] font-700 tracking-[-.03em] text-white ${collapsed ? 'lg:hidden' : ''}`}>ATLAS<span className="text-[#d4af37]">OS</span></span>
          </Link>
          <button className="rounded-md p-1.5 text-[#8293aa] hover:bg-white/[.06] hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-sidebar" aria-label="Close navigation"><X size={18} /></button>
          <button className="hidden rounded-md p-1.5 text-[#8293aa] hover:bg-white/[.06] hover:text-white lg:block" onClick={() => setCollapsed((value) => !value)} data-testid="button-collapse-sidebar" aria-label="Collapse navigation"><PanelLeftClose size={17} /></button>
        </div>
        <div className={`border-b border-white/[.07] px-4 py-4 ${collapsed ? 'lg:px-3' : ''}`}>
          <div className={`flex items-center gap-3 rounded-lg bg-white/[.06] px-3 py-2.5 ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#163b63] font-display text-xs font-bold text-[#98c4eb]">MS</span>
            <span className={`${collapsed ? 'lg:hidden' : ''}`}>
              <span className="block text-[11px] font-semibold text-white">MapSpark Ghana</span>
              <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider text-[#8293aa]">CEO workspace</span>
            </span>
            <ChevronDown size={14} className={`ml-auto text-[#8293aa] ${collapsed ? 'lg:hidden' : ''}`} />
          </div>
        </div>
        <nav className="scrollbar flex-1 overflow-y-auto px-3 py-5">
          <p className={`mb-2 px-3 font-mono text-[9px] font-semibold uppercase tracking-[.18em] text-[#62738a] ${collapsed ? 'lg:hidden' : ''}`}>Command centre</p>
          <div className="space-y-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = item.href === location;
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-medium transition-colors focus-ring ${active ? 'bg-[#d4af37] text-[#0b1f3a] shadow-[0_5px_16px_rgba(212,175,55,.14)]' : 'text-[#95a5b8] hover:bg-white/[.06] hover:text-white'} ${collapsed ? 'lg:justify-center lg:px-2' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}>
                  <Icon size={17} strokeWidth={active ? 2.4 : 1.8} />
                  <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
                  {item.href === '/employees' && <span className={`ml-auto h-1.5 w-1.5 rounded-full bg-[#16a085] ${collapsed ? 'lg:hidden' : ''}`} />}
                </Link>
              );
            })}
          </div>
          <p className={`mb-2 mt-8 px-3 font-mono text-[9px] font-semibold uppercase tracking-[.18em] text-[#62738a] ${collapsed ? 'lg:hidden' : ''}`}>Workspace</p>
          <Link href="/settings" onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-medium transition-colors focus-ring ${location === '/settings' ? 'bg-white/[.1] text-white' : 'text-[#95a5b8] hover:bg-white/[.06] hover:text-white'} ${collapsed ? 'lg:justify-center lg:px-2' : ''}`} data-testid="link-nav-settings"><Settings size={17} /><span className={collapsed ? 'lg:hidden' : ''}>Settings</span></Link>
        </nav>
        <div className={`border-t border-white/[.07] p-4 ${collapsed ? 'lg:px-3' : ''}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'lg:justify-center' : ''}`}>
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4af37] font-display text-[11px] font-bold text-[#0b1f3a]">KA<span className="absolute bottom-0 right-[-1px] h-2.5 w-2.5 rounded-full border-2 border-[#0b1f3a] bg-[#16a085]" /></div>
            <div className={`${collapsed ? 'lg:hidden' : ''}`}><p className="text-[11px] font-semibold text-white">Kofi Asare</p><p className="mt-0.5 text-[10px] text-[#8293aa]">Founder & CEO</p></div>
            <button className={`ml-auto rounded-md p-1.5 text-[#8293aa] hover:bg-white/[.06] hover:text-white ${collapsed ? 'lg:hidden' : ''}`} data-testid="button-user-menu" aria-label="Open account menu"><ChevronDown size={14} /></button>
          </div>
        </div>
      </aside>

      <div className={`min-h-[100dvh] transition-[padding] duration-300 ${collapsed ? 'lg:pl-[78px]' : 'lg:pl-[254px]'}`}>
        <header className="sticky top-0 z-30 flex h-[74px] items-center justify-between border-b border-[#233247] bg-[#07111f]/90 px-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3">
            <button className="rounded-lg border border-[#2a3c54] p-2 text-[#a6b5c6] hover:border-[#d4af37] hover:text-[#d4af37] lg:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-sidebar" aria-label="Open navigation"><Menu size={18} /></button>
            <div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#71839b]">Atlas / {current?.label ?? 'Workspace'}</p><h1 className="mt-1 font-display text-[17px] font-semibold tracking-[-.035em] text-white sm:text-[19px]">{current?.label ?? 'Workspace'}</h1></div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden items-center gap-2 rounded-lg border border-[#25364d] bg-[#0c1a2d] px-3 py-2 sm:flex"><Search size={15} className="text-[#6e829a]" /><span className="font-mono text-[10px] text-[#6e829a]">Search command</span><kbd className="ml-6 rounded border border-[#33465d] px-1.5 py-0.5 font-mono text-[9px] text-[#7f91a7]">⌘K</kbd></div>
            <button className="relative rounded-lg border border-[#25364d] p-2 text-[#94a5b9] hover:border-[#d4af37] hover:text-[#d4af37]" data-testid="button-notifications" aria-label="Notifications"><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#d4af37]" /></button>
            <div className="hidden h-7 w-px bg-[#233247] sm:block" />
            <div className="hidden items-center gap-2 sm:flex"><span className="h-2 w-2 rounded-full bg-[#16a085] pulse-dot" /><span className="font-mono text-[9px] uppercase tracking-wider text-[#7f91a7]">All systems nominal</span></div>
          </div>
        </header>
        <main className="app-grid min-h-[calc(100dvh-74px)] px-4 py-6 sm:px-7 lg:px-9">{children}</main>
      </div>
    </div>
  );
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end fade-up"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#d4af37]">{eyebrow}</p><h2 className="mt-2 font-display text-[28px] font-semibold tracking-[-.05em] text-white sm:text-[34px]">{title}</h2><p className="mt-2 max-w-xl text-[13px] leading-6 text-[#8798ad]">{description}</p></div>{action}</div>;
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><h3 className="font-mono text-[10px] font-semibold uppercase tracking-[.17em] text-[#8293aa]">{children}</h3>{action}</div>;
}

export function MetricCard({ label, value, change, detail, icon: Icon, accent = '#d4af37' }: { label: string; value: string; change: string; detail: string; icon: ElementType; accent?: string }) {
  return <div className="card-glow rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#3a4b61] sm:p-5"><div className="flex items-start justify-between"><span className="font-mono text-[9px] uppercase tracking-[.15em] text-[#7c8da2]">{label}</span><span className="rounded-md p-2" style={{ backgroundColor: `${accent}18`, color: accent }}><Icon size={16} /></span></div><div className="mt-4 flex items-end gap-2"><span className="font-display text-[26px] font-semibold tracking-[-.05em] text-white">{value}</span><span className="mb-1 rounded bg-[#16a0851c] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#42c7a8]">{change}</span></div><p className="mt-1.5 text-[11px] text-[#71839a]">{detail}</p></div>;
}