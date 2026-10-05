import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Radar, Bot, ShieldCheck, ListTodo, LockKeyhole, CircleHelp } from 'lucide-react';
import { SectionLabel } from '@/components/atlas-shell';
import { type CommandSignals, type SignalState, missionCounts, missionStates, pipelineState, scoutState, workforceState, autonomyState, executionState, stateDescription } from '@/services/command-center';

export function StateBadge({ state }: { state: string }) { return <span className="cc-badge" data-state={state}><span aria-hidden="true" />{state.toLowerCase().replaceAll('_', ' ')}</span>; }
export function Panel({ id, title, href, children, className = '' }: { id: string; title: string; href?: string; children: ReactNode; className?: string }) {
  return <section id={id} className={`cc-panel ${className}`} aria-label={title}><SectionLabel action={href && <Link className="cc-link focus-ring" href={href}>Open <ArrowUpRight size={13} aria-hidden="true" /></Link>}>{title}</SectionLabel>{children}</section>;
}
export function DataState({ state, detail }: { state: SignalState; detail?: string }) {
  return <div className="cc-data-state" role="status"><span className="cc-state-icon" aria-hidden="true">{state === 'RESTRICTED' ? <LockKeyhole size={20} /> : <CircleHelp size={20} />}</span><div><StateBadge state={state} /><p>{detail ?? stateDescription[state]}</p></div></div>;
}
export function OperatingState({ signals: s }: { signals: CommandSignals }) {
  const systems = [
    { name: 'AI Workforce', state: workforceState(s), note: 'Provider configuration · not live execution' },
    { name: 'Scout', state: scoutState(s), note: 'Discovery scheduler' },
    { name: 'Pipeline', state: pipelineState(s), note: 'Evidence → audit → mission' },
    { name: 'Mission execution', state: executionState(s), note: 'Independent execution gate' },
    { name: 'Autonomy', state: autonomyState(s), note: 'Decision cycle scheduler' },
  ];
  return <section className="cc-operating" aria-label="Operating state"><div className="cc-strip-heading"><span className="cc-kicker">Operating state</span><span>Disabled does not mean failed</span></div><div className="cc-system-grid">{systems.map((system) => <div key={system.name} className="cc-system"><h3>{system.name}</h3><StateBadge state={system.state} /><p>{system.note}</p></div>)}</div></section>;
}
export function AttentionRequired({ signals: s }: { signals: CommandSignals }) {
  const tasks = s.pipeline.data?.missions;
  const items = tasks?.filter((m) => ['Waiting Approval', 'Failed', 'Blocked'].includes(m.status));
  return <Panel id="attention" title="Attention required" href="/mission-queue" className="cc-attention"><div className="cc-attention-heading"><ShieldCheck size={25} aria-hidden="true" /><div><h3>{items ? (items.length ? `${items.length} missions need a decision` : 'No mission blockers reported') : 'Your attention signal is not yet visible'}</h3><p>Human decisions remain at the center of Atlas.</p></div></div>{items ? items.length ? <ul className="cc-records">{items.slice(0, 5).map((m) => <li key={m.taskId}><Link href="/mission-queue" className="focus-ring"><span>{m.title}</span><StateBadge state={m.status.toUpperCase()} /></Link></li>)}</ul> : <div className="cc-empty-inline">The current mission snapshot has no waiting approvals, failed missions, or blocked missions. Customer decisions and other approval types are not covered by this snapshot.</div> : <DataState state={s.pipeline.state} />}{items && items.length > 5 && <Link className="cc-link focus-ring" href="/mission-queue">Review all {items.length} missions <ArrowUpRight size={13} /></Link>}<p className="cc-footnote">Payment follow-up is shown in Revenue Signal. No alerts are fabricated.</p></Panel>;
}
export function ScoutIntelligence({ signals: s }: { signals: CommandSignals }) {
  return <Panel id="scout" title="Scout intelligence" href="/scout"><div className="cc-panel-title"><Radar size={24} aria-hidden="true" /><div><h3>Discovery frontier</h3><p>From a business on the map to an evidence-backed opportunity.</p></div><StateBadge state={scoutState(s)} /></div>{s.health.data ? <><div className="cc-scout-field"><span>Discovery scheduler</span><strong>{s.health.data.scoutDiscovery.enabled ? 'Enabled' : 'Not started'}</strong></div><div className="cc-scout-field"><span>Discovery source</span><strong>Not exposed by health API</strong></div><div className="cc-empty-inline">Discovery history and per-run counts are not exposed. Pipeline business totals below are not labeled as Scout discoveries.</div></> : <DataState state={s.health.state} />}<div className="cc-panel-bottom"><span>Manual intake uses the existing Scout workflow.</span><Link className="cc-link focus-ring" href="/scout">Open Scout <ArrowUpRight size={13} /></Link></div></Panel>;
}
export function AIWorkforce({ signals: s }: { signals: CommandSignals }) {
  const wf = s.workforce.data;
  return <Panel id="workforce" title="AI workforce" href="/employees"><div className="cc-panel-title"><Bot size={24} aria-hidden="true" /><div><h3>The Atlas workforce</h3><p>Specialized roles. Governed execution.</p></div><StateBadge state={workforceState(s)} /></div>{wf ? <><div className="cc-workforce-metrics"><div><strong>{wf.employees.filter((e) => e.enabled).length}<small> / {wf.employees.length}</small></strong><span>Roles enabled / registered</span></div><div><strong>{wf.catalogModels.toLocaleString()}</strong><span>Models in full catalog · not free-model count</span></div></div><div className="cc-scout-field"><span>Catalog</span><StateBadge state={wf.catalogStatus === 'ok' ? 'AVAILABLE' : wf.catalogStatus === 'pending' ? 'PENDING' : 'UNAVAILABLE'} /></div><ul className="cc-role-list">{wf.employees.map((e) => <li key={e.employee}><span>{e.employee.replaceAll('_', ' ')}</span><span>{!e.enabled ? 'disabled' : e.source === 'static-fallback' ? 'fallback configured' : 'configured'}</span></li>)}</ul></> : <DataState state={s.workforce.state} />}{s.health.data && <div className="cc-provider-list">{s.health.data.providers.map((p) => <div key={p.provider}><span>{p.provider}</span><StateBadge state={p.healthy ? 'AVAILABLE' : 'DEGRADED'} /></div>)}</div>}<p className="cc-footnote">Provider signals describe configuration, not a verified live model call. Enabled roles are not employees currently working.</p></Panel>;
}
export function MissionSignal({ signals: s }: { signals: CommandSignals }) {
  const tasks = s.pipeline.data?.missions;
  const counts = tasks ? missionCounts(tasks) : null;
  return <Panel id="missions" title="Mission signal" href="/mission-queue"><div className="cc-panel-title"><ListTodo size={23} aria-hidden="true" /><div><h3>Execution with oversight</h3><p>Recorded work, not simulated momentum.</p></div><StateBadge state={executionState(s)} /></div>{counts ? <dl className="cc-mission-grid">{missionStates.map((state) => <div key={state}><dt>{state === 'Waiting Approval' ? 'Awaiting approval' : state}</dt><dd>{counts[state]}</dd></div>)}</dl> : <DataState state={s.pipeline.state} />}<p className="cc-footnote">{executionState(s) === 'DISABLED' ? 'Mission execution is disabled. Queued missions do not imply autonomous execution.' : 'Counts come from the backend pipeline snapshot, not the local development queue.'}</p></Panel>;
}
