import { Link } from 'wouter';
import { ArrowUpRight, CircleDollarSign, Activity, Image as ImageIcon } from 'lucide-react';
import { type CommandSignals, missionCounts } from '@/services/command-center';
import { Panel, DataState, StateBadge } from './operating-panels';

export function BusinessSignal({ signals: s }: { signals: CommandSignals }) {
  const p = s.pipeline.data;
  const counts = p ? missionCounts(p.missions) : null;
  const values = [
    { label: 'Businesses in pipeline', value: p?.counts.businesses, href: '/scout', note: 'Not a discovery-source total' },
    { label: 'Numeric scores', value: p ? p.counts.scores - p.counts.scoresWithheld : undefined, href: '/visibility', note: 'Withheld scores excluded' },
    { label: 'Audits recorded', value: p?.counts.audits, href: '/visibility', note: 'Evidence-backed audit records' },
    { label: 'Missions pending', value: counts?.Pending, href: '/mission-queue', note: 'Backend queue snapshot' },
    { label: 'Missions completed', value: counts?.Completed, href: '/mission-queue', note: 'Recorded completion state' },
    { label: 'Active opportunities', value: undefined, href: '/crm', note: 'No aggregate read source' },
    { label: 'Clients', value: undefined, href: '/clients', note: 'No authoritative client total' },
  ];
  return <section id="business-signal" className="cc-business" aria-label="Business operating signal"><div className="cc-strip-heading"><span className="cc-kicker">Business operating signal</span><span>Recorded state · no demo estimates</span></div><div className="cc-business-grid">{values.map((item) => <Link key={item.label} href={item.href} className="cc-business-stat focus-ring"><span>{item.label}<ArrowUpRight size={12} aria-hidden="true" /></span><strong aria-label={item.value === undefined ? 'Unknown' : undefined}>{item.value === undefined ? '—' : item.value.toLocaleString()}</strong><small>{item.value === undefined && p ? item.note : !p ? s.pipeline.state.toLowerCase() : item.note}</small></Link>)}</div></section>;
}
export function RevenueSignal({ signals: s }: { signals: CommandSignals }) {
  const f = s.finance.data;
  const totals = f ? Object.entries(f.receivedRevenue.totals) : [];
  const pending = f?.notRevenue.PAYMENT_PENDING?.count;
  return <Panel id="revenue" title="Revenue signal" href="/finance"><div className="cc-panel-title"><CircleDollarSign size={24} aria-hidden="true" /><div><h3>Recorded payments only</h3><p>Invoices are operational records, not revenue.</p></div></div>{f ? <><StateBadge state={f.receivedRevenue.paymentCount === 0 ? 'EMPTY' : 'RECORDED'} />{totals.length ? <dl className="cc-revenue-totals">{totals.map(([currency, amount]) => <div key={currency}><dt>{currency}</dt><dd>{amount}</dd></div>)}</dl> : <div className="cc-empty-inline">{f.receivedRevenue.paymentCount === 0 ? 'No payments recorded. No currency total is assumed.' : 'Payment count exists, but currency totals are not available.'}</div>}<div className="cc-scout-field"><span>Payments recorded</span><strong>{f.receivedRevenue.paymentCount}</strong></div>{pending !== undefined && <div className="cc-scout-field"><span>Invoices awaiting payment · not revenue</span><strong>{pending}</strong></div>}{pending !== undefined && pending > 0 && <p className="cc-footnote">Payment follow-up is required outside this read-only surface. Atlas does not move money.</p>}</> : <DataState state={s.finance.state} />}<p className="cc-footnote">All-time recorded totals, per currency. No conversions, invoice-value estimates, or projected revenue.</p></Panel>;
}
export function VisualIntelligenceSignal({ signals: s }: { signals: CommandSignals }) {
  const pipeline = s.pipeline.data;
  const multimodal = pipeline?.multimodal;
  return <Panel id="visual-intelligence" title="Visual intelligence">
    <div className="cc-panel-title"><ImageIcon size={23} aria-hidden="true" /><div><h3>Business media observations</h3><p>Image findings from eligible public business websites.</p></div>{multimodal && <StateBadge state={multimodal.enabled ? 'ENABLED' : 'DISABLED'} />}</div>
    {multimodal ? <>
      <div className="cc-scout-field"><span>Image sources with observations</span><strong>{multimodal.imageSourcesWithObservations}</strong></div>
      <div className="cc-scout-field"><span>Recorded visual observations</span><strong>{pipeline.counts.multimodalObservations}</strong></div>
      {multimodal.observations.length ? <ul className="cc-role-list">{multimodal.observations.slice(0, 8).map((item) => <li key={item.observationId}>
        <strong>{item.businessName}</strong><span>{item.observation}</span><small>{item.category.replaceAll('_', ' ')} · {item.confidence.toLowerCase()} confidence</small>
        <StateBadge state={item.verificationStatus} />
        <small><a href={item.sourceReference} target="_blank" rel="noreferrer">Open source</a> · opportunity score: {item.opportunityScore === null ? 'not available' : item.opportunityScore}</small>
      </li>)}</ul> : <div className="cc-empty-inline">{multimodal.enabled ? 'No visual observations have been recorded.' : 'Image analysis is disabled; existing text research continues normally.'}</div>}
      <p className="cc-footnote">Enabled reflects configuration, not a completed model call. Every finding remains UNVERIFIED and is excluded from evidence and scoring. Atlas does not currently analyze video, audio, or PDFs.</p>
    </> : <DataState state={s.pipeline.state} />}
  </Panel>;
}
export function RecentActivity({ signals: s }: { signals: CommandSignals }) {
  const items = s.decisions.data?.items;
  return <Panel id="activity" title="Recent operational activity"><div className="cc-panel-title"><Activity size={23} aria-hidden="true" /><div><h3>Decision trail</h3><p>Latest backend decisions · not a complete company event feed.</p></div></div>{items?.length ? <ol className="cc-timeline">{items.map((d) => <li key={d.decisionId}><span className="cc-timeline-dot" aria-hidden="true" /><div><strong>{d.type.replaceAll('_', ' ').toLowerCase()}</strong><time dateTime={d.createdAt}>{Number.isFinite(Date.parse(d.createdAt)) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(new Date(d.createdAt)) : 'Timestamp unavailable'} GMT</time></div><StateBadge state={d.execution?.outcome ?? 'DECISION RECORDED'} /></li>)}</ol> : <DataState state={s.decisions.state} detail={s.decisions.state === 'EMPTY' ? 'No decisions have been returned. Business discovery, evidence, audit and payment events are not exposed as one global feed.' : undefined} />}<p className="cc-footnote">A recorded decision is not proof that its action executed.</p></Panel>;
}
