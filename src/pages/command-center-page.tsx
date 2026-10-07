import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowUpRight, RefreshCw, Command } from 'lucide-react';
import { loadCommandSignals, loadingSignals } from '@/services/command-center';
import { OperatingState, AttentionRequired, ScoutIntelligence, AIWorkforce, MissionSignal, StateBadge } from '@/components/command-center/operating-panels';
import { BusinessSignal, RevenueSignal, RecentActivity } from '@/components/command-center/signal-panels';
import { AtlasLifecycle } from '@/components/command-center/lifecycle';
import '@/components/command-center/command-center.css';

export function CommandCenterPage() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  // Existing proxy URL, or same-origin forwarding. Never guess a production hostname or send a shared secret.
  const base = import.meta.env.VITE_ATLAS_PROXY_URL ?? '';
  const query = useQuery({ queryKey: ['atlas-command-center', base], queryFn: () => loadCommandSignals(base), staleTime: 30000, refetchInterval: 60000, refetchIntervalInBackground: false, retry: false });
  const signals = query.data ?? loadingSignals;
  const restricted = Object.values(signals).some((s) => s.state === 'RESTRICTED');
  const unavailable = Object.values(signals).some((s) => s.state === 'UNAVAILABLE');
  const coverage = query.isPending ? 'LOADING' : restricted ? 'RESTRICTED' : unavailable ? 'PARTIAL VISIBILITY' : signals.pipeline.state === 'DISABLED' ? 'PIPELINE DISABLED' : 'SNAPSHOT RECEIVED';
  return <div className="cc-root" data-testid="atlas-command-center"><a className="cc-skip" href="#attention">Skip to attention required</a><header className="cc-header"><div><div className="cc-eyebrow"><Command size={15} aria-hidden="true" /><span>MapSpark Ghana / private operating system</span></div><h2>Atlas Command Center<span aria-hidden="true">.</span></h2><p>The company signal. The decisions that matter. The next move.</p></div><div className="cc-header-actions"><time dateTime={now.toISOString()}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(now)} GMT</time><div><button className="cc-button cc-button-secondary" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh operational snapshot"><RefreshCw size={14} className={query.isFetching ? 'cc-refreshing' : ''} aria-hidden="true" />{query.isFetching ? 'Reading signal' : 'Refresh signal'}</button><Link className="cc-button focus-ring" href="/mission-queue">Review missions <ArrowUpRight size={14} aria-hidden="true" /></Link></div></div></header><div className="cc-snapshot" role="status" aria-live="polite"><StateBadge state={coverage} /><span>{query.dataUpdatedAt ? `Snapshot read ${new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: 'Africa/Accra' }).format(new Date(query.dataUpdatedAt))} GMT` : 'Waiting for verified source responses'}</span><span className="cc-snapshot-note">Read-only command surface · no automatic actions enabled here</span></div><OperatingState signals={signals} /><AttentionRequired signals={signals} /><BusinessSignal signals={signals} /><div className="cc-intelligence-grid"><ScoutIntelligence signals={signals} /><AIWorkforce signals={signals} /></div><MissionSignal signals={signals} /><AtlasLifecycle signals={signals} /><div className="cc-bottom-grid"><RecentActivity signals={signals} /><RevenueSignal signals={signals} /></div><footer className="cc-footer"><span>ATLAS / OBSERVE → DECIDE → ACT</span><span>Unknown is not zero. Configured is not executing. Invoiced is not received.</span></footer></div>;
}
