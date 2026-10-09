import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowUpRight, Bot, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { DataState, StateBadge } from '@/components/command-center/operating-panels';
import { stateDescription, type Signal, type SignalState } from '@/services/command-center';
import { asEmployees, asMissions, loadWorkforceBoard, submitMissionApproval, type ApprovalSubmission } from '@/services/workforce-client';
import {
  attentionItems, configurationState, formatDuration, formatRate, knownRoles, lensCounts, missionLens,
  missionLenses, missionMetrics, roleTitle, type MissionLens, type WorkforceMission,
} from '@/services/workforce-view';
import '@/components/command-center/command-center.css';
import '@/components/workforce/workforce.css';

const base = import.meta.env.VITE_ATLAS_PROXY_URL ?? '';

function when(value?: string | null) {
  if (!value) return 'Not recorded';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(parsed);
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="cc-business-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export function WorkforcePage() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [lens, setLens] = useState<MissionLens>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [actor, setActor] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApprovalSubmission | null>(null);
  const titleId = useId();
  const query = useQuery({
    queryKey: ['atlas-workforce-board', base],
    queryFn: () => loadWorkforceBoard(base),
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  const board = query.data;
  const missions = board ? asMissions(board.missions) : null;
  const employees = board ? asEmployees(board.workforce) : null;
  const metrics = missionMetrics(missions);
  const counts = missions ? lensCounts(missions) : null;
  const visible = missions?.filter((mission) => missionLens(mission) === lens) ?? [];
  const attention = missions ? attentionItems(missions) : null;
  const selected = missions?.find((mission) => mission.taskId === openId) ?? null;
  const coverage: SignalState | string = !board || query.isPending ? 'LOADING' : board.missions.state === 'HEALTHY' || board.missions.state === 'EMPTY' ? 'SNAPSHOT RECEIVED' : board.missions.state;

  const approve = async (mission: WorkforceMission) => {
    if (!mission.version || !/^human:.+/.test(actor.trim()) || pending) return;
    setPending(true);
    setResult(null);
    const submission = await submitMissionApproval(base, { taskId: mission.taskId, actor: actor.trim(), version: mission.version });
    setResult(submission);
    setPending(false);
    if (submission.ok) void queryClient.invalidateQueries({ queryKey: ['atlas-workforce-board', base] });
  };

  return <div className="cc-root wf-root" data-testid="atlas-workforce">
    <header className="cc-header">
      <div>
        <div className="cc-eyebrow"><Bot size={15} aria-hidden="true" /><span>Atlas workforce / governed execution</span></div>
        <h2>Workforce<span aria-hidden="true">.</span></h2>
        <p>Who is configured, what is recorded, and what still needs a human. Nothing on this screen is inferred from silence.</p>
      </div>
      <div className="cc-header-actions">
        <time dateTime={now.toISOString()}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(now)} GMT</time>
        <div>
          <button className="cc-button cc-button-secondary" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14} className={query.isFetching ? 'cc-refreshing' : ''} aria-hidden="true" />{query.isFetching ? 'Reading' : 'Refresh'}</button>
          <Link className="cc-button focus-ring" href="/mission-queue">Mission queue <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      </div>
    </header>

    <div className="cc-snapshot" role="status">
      <StateBadge state={coverage} />
      <span>{query.dataUpdatedAt ? `Snapshot ${when(new Date(query.dataUpdatedAt).toISOString())}` : 'Waiting for the workforce and mission sources'}</span>
      <span className="cc-snapshot-note">Read on a one-minute interval · not a live event stream</span>
    </div>

    <section className="cc-business" aria-label="Workforce metrics">
      <div className="cc-strip-heading"><span className="cc-kicker">Operational counts</span><span>From the autonomy mission list and the workforce registry</span></div>
      <div className="cc-business-grid">
        <Metric label="Working now" value="—" detail="Not exposed. Enabled is not the same as working." />
        <Metric label="Roles enabled" value={employees ? String(employees.filter((employee) => employee.enabled).length) : '—'} detail={employees ? `${employees.length} registered` : stateDescription[board?.workforce.state ?? 'LOADING']} />
        <Metric label="Active missions" value={metrics ? String(metrics.active) : '—'} detail={metrics ? 'Status In Progress' : stateDescription[board?.missions.state ?? 'LOADING']} />
        <Metric label="Queued" value={metrics ? String(metrics.queued) : '—'} detail="Pending, and not waiting on approval" />
        <Metric label="Awaiting approval" value={metrics ? String(metrics.approval) : '—'} detail={board?.autonomy.data ? `${board.autonomy.data.counts.approvals} approval records stored` : 'Stored approval count unread'} />
        <Metric label="Completed" value={metrics ? String(metrics.completed) : '—'} detail={metrics ? `${metrics.failed} failed · ${metrics.blocked} blocked` : 'Failed and blocked unread'} />
        <Metric label="Success rate" value={metrics ? formatRate(metrics.successRate) : '—'} detail={metrics?.successRate === null ? 'No completed or failed sample' : `${metrics?.successDenominator} terminal missions`} />
      </div>
      <p className="cc-footnote" style={{ padding: '0 16px 16px' }}>{metrics ? (metrics.averageDurationMs != null ? `Average duration ${formatDuration(metrics.averageDurationMs)} across ${metrics.durationSample} completed mission${metrics.durationSample === 1 ? '' : 's'} with both timestamps.` : 'Average duration unavailable. No completed mission in this snapshot has both a start and an end.') : 'Average duration unread.'}</p>
    </section>

    <section className="cc-panel cc-attention" aria-label="Attention required">
      <div className="cc-attention-heading"><ShieldCheck size={22} aria-hidden="true" /><div><h3>{attention ? (attention.length ? `${attention.length} recorded items need a look` : 'No approval, failure, or blocked mission in this snapshot') : 'Attention list is not visible'}</h3><p>Human authorization stays outside the model. This list does not execute anything.</p></div></div>
      {attention ? attention.length ? <ul className="cc-records">{attention.slice(0, 6).map((mission) => <li key={mission.taskId}><button className="focus-ring" onClick={() => { setOpenId(mission.taskId); setResult(null); }}><span>{mission.title}</span><StateBadge state={missionLens(mission) === 'approval' ? 'WAITING APPROVAL' : mission.status.toUpperCase()} /></button></li>)}</ul> : <div className="cc-empty-inline">A clear snapshot is not proof that every other approval type is clear. Outreach, proposals, artifacts, and invoices are separate operations and are not listed here unless they appear as missions.</div> : <DataState state={board?.missions.state ?? 'LOADING'} />}
    </section>

    <div className="wf-grid">
      <section className="cc-panel" aria-label="AI employees">
        <div className="cc-panel-title"><Bot size={22} aria-hidden="true" /><div><h3>Registry</h3><p>Roles returned by the workforce registry. Builder, Operator, Closer, and Finance are older product names and are omitted unless this registry lists them.</p></div><StateBadge state={board ? (board.workforce.state === 'HEALTHY' ? 'AVAILABLE' : board.workforce.state) : 'LOADING'} /></div>
        {employees ? <div className="wf-employees">{employees.map((employee) => {
          const state = configurationState(employee);
          const open = employeeId === employee.employee;
          const known = knownRoles[employee.employee];
          return <button key={employee.employee} className="wf-card focus-ring" data-open={open} aria-expanded={open} onClick={() => setEmployeeId(open ? null : employee.employee)}>
            <div className="wf-card-top"><span className="wf-mark" aria-hidden="true">{roleTitle(employee.employee).slice(0, 2).toUpperCase()}</span><StateBadge state={state.badge} /></div>
            <h3>{roleTitle(employee.employee)}</h3>
            <p>{known?.remit ?? 'Registered role. No local description is attached, so none is invented.'}</p>
            <div className="wf-meta">
              <div><span>Configuration</span><strong>{state.label}</strong></div>
              <div><span>Current mission</span><strong>Not attributed</strong></div>
              <div><span>Provider</span><strong>{employee.providerId}</strong></div>
              {open && <>
                <div><span>Model</span><strong>{employee.model ?? 'None'}</strong></div>
                <div><span>Fallback</span><strong>{employee.fallback ?? 'None'}</strong></div>
                <div><span>Source</span><strong>{employee.source}</strong></div>
                <div><span>Last activity</span><strong>Not recorded on this role</strong></div>
              </>}
            </div>
            {open && employee.note && <p>{employee.note}</p>}
          </button>;
        })}</div> : <DataState state={board?.workforce.state ?? 'LOADING'} />}
        {board?.workforce.data && <p className="cc-footnote">Catalog {board.workforce.data.catalogStatus} · {board.workforce.data.catalogModels.toLocaleString()} models in the full catalog. That number is not a count of free models, and it is not a count of completed jobs. Provider health: {board.health.data ? board.health.data.providers.map((provider) => `${provider.provider} ${provider.healthy ? 'available' : 'degraded'}`).join(' · ') : stateDescription[board.health.state]}.</p>}
      </section>

      <section className="cc-panel" aria-label="Recorded decisions">
        <div className="cc-panel-title"><div><h3>Recorded decisions</h3><p>Autonomy decisions already stored. This is not a live activity stream.</p></div></div>
        <DecisionFeed signal={board?.decisions} />
      </section>
    </div>

    <section className="cc-panel" aria-label="Mission control">
      <div className="cc-panel-title"><div><h3>Missions</h3><p>Filtered from the autonomy mission list. Progress is not shown because this API does not report a percentage.</p></div>{board?.autonomy.data && <StateBadge state={board.autonomy.data.autonomy.missionExecutionEnabled ? 'AVAILABLE' : 'DISABLED'} />}</div>
      <div className="wf-tabs" role="tablist" aria-label="Mission status">
        {missionLenses.map((item) => <button key={item.id} role="tab" aria-selected={lens === item.id} className="focus-ring" onClick={() => setLens(item.id)}>{item.label}{counts ? ` ${counts[item.id]}` : ''}</button>)}
      </div>
      {!missions && <DataState state={board?.missions.state ?? 'LOADING'} />}
      {missions && visible.length === 0 && <div className="cc-empty-inline">No missions in {missionLenses.find((item) => item.id === lens)?.label.toLowerCase()}.</div>}
      {visible.length > 0 && <div>{visible.map((mission) => <button key={mission.taskId} className="wf-mission focus-ring" onClick={() => { setOpenId(mission.taskId); setResult(null); }}>
        <strong>{mission.title}</strong>
        <StateBadge state={missionLens(mission) === 'approval' ? 'WAITING APPROVAL' : mission.status.toUpperCase()} />
        <small>{mission.missionType ?? 'Unclassified type'} · {mission.approvalRequired} · created {when(mission.createdAt)}{typeof mission.attempts === 'number' ? ` · ${mission.attempts} recorded attempt${mission.attempts === 1 ? '' : 's'}` : ''}</small>
      </button>)}</div>}
    </section>

    {selected && <div className="wf-drawer-back" onClick={() => setOpenId(null)}>
      <aside className="wf-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="cc-panel-title" style={{ marginTop: 0 }}><div><p className="cc-kicker">Mission</p><h3 id={titleId}>{selected.title}</h3><p>{selected.taskId}</p></div><button className="cc-button cc-button-secondary" onClick={() => setOpenId(null)} aria-label="Close mission"><X size={14} /></button></div>
        <div className="wf-facts">
          <div><span>Status</span><strong>{selected.status}</strong></div>
          <div><span>Approval</span><strong>{selected.approvalRequired}</strong></div>
          <div><span>Type</span><strong>{selected.missionType ?? 'Not classified'}</strong></div>
          <div><span>Business</span><strong>{selected.businessId ?? 'Not linked'}</strong></div>
          <div><span>Created</span><strong>{when(selected.createdAt)}</strong></div>
          <div><span>Completed</span><strong>{when(selected.completedAt)}</strong></div>
          <div><span>Retries</span><strong>{typeof selected.retryCount === 'number' ? String(selected.retryCount) : 'Not recorded'}</strong></div>
          <div><span>Attempts</span><strong>{typeof selected.attempts === 'number' ? String(selected.attempts) : 'Not recorded'}</strong></div>
          <div><span>Assigned employee</span><strong>Not in this snapshot</strong></div>
          <div><span>Duration</span><strong>{(() => { const ms = selected.status === 'Completed' && selected.createdAt && selected.completedAt ? Date.parse(selected.completedAt) - Date.parse(selected.createdAt) : NaN; return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : 'Not measurable'; })()}</strong></div>
        </div>
        <p className="wf-note">Execution history, inputs, outputs, evidence, and lineage identifiers are not included in the mission list. Attempt count is the only execution figure this snapshot provides. No intermediate stages are filled in.</p>
        {selected.lastFailureReason ? <p className="wf-note wf-error" style={{ marginTop: 10 }}>Last failure: {selected.lastFailureReason}</p> : <p className="wf-muted" style={{ marginTop: 10 }}>No failure reason on this record.</p>}
        <div style={{ marginTop: 18 }}>
          <p className="cc-kicker">Human authorization</p>
          {missionLens(selected) !== 'approval' && <p className="wf-note" style={{ marginTop: 10 }}>This mission is not awaiting approval, so no approval is offered.</p>}
          {missionLens(selected) === 'approval' && !selected.version && <p className="wf-note" style={{ marginTop: 10 }}>The snapshot has no object version. Atlas refuses approvals that do not name the exact version, so this screen will not submit one.</p>}
          {missionLens(selected) === 'approval' && selected.version && <>
            <p className="wf-muted" style={{ marginTop: 8 }}>Approving calls the existing mission approval. That authorizes a human-gated run of this mission. It does not edit the mission. Reject is not a mission operation.</p>
            <form className="wf-form" onSubmit={(event) => { event.preventDefault(); void approve(selected); }}>
              <label htmlFor="wf-actor">Human actor <span className="wf-muted">required as human:id</span></label>
              <input id="wf-actor" value={actor} onChange={(event) => setActor(event.target.value)} autoComplete="off" placeholder="human:kofi" spellCheck={false} />
              <div className="wf-actions">
                <button className="cc-button" type="submit" disabled={pending || !/^human:.+/.test(actor.trim())}>{pending ? 'Submitting' : 'Approve mission'}</button>
              </div>
            </form>
            {result && <p className={`wf-note ${result.ok ? 'wf-ok' : 'wf-error'}`} role="status" style={{ marginTop: 12 }}>{result.message}{result.outcome ? ` Outcome: ${result.outcome}.` : ''}{result.code ? ` (${result.code})` : ''}</p>}
          </>}
        </div>
      </aside>
    </div>}

    <footer className="cc-footer"><span>ATLAS / WORKFORCE</span><span><Link className="cc-link focus-ring" href="/">Command Center</Link> · <Link className="cc-link focus-ring" href="/scout">Scout</Link> · <Link className="cc-link focus-ring" href="/finance">Finance</Link></span></footer>
  </div>;
}

function DecisionFeed({ signal }: { signal?: Signal<{ items: { decisionId: string; type: string; createdAt: string; reason?: string; execution?: { outcome: string } | null }[] }> }) {
  if (!signal || signal.state === 'LOADING') return <DataState state="LOADING" />;
  if (signal.state !== 'HEALTHY' && signal.state !== 'EMPTY') return <DataState state={signal.state} />;
  if (!signal.data?.items.length) return <div className="cc-empty-inline">No decisions in this snapshot.</div>;
  return <ul className="cc-timeline">{signal.data.items.map((item) => <li key={item.decisionId}><span className="cc-timeline-dot" aria-hidden="true" /><div><strong>{item.type.replaceAll('_', ' ')}</strong><p className="wf-muted">{item.reason ?? 'No reason text on this decision.'}</p><time dateTime={item.createdAt}>{when(item.createdAt)}</time></div><StateBadge state={item.execution?.outcome ?? 'RECORDED'} /></li>)}</ul>;
}
