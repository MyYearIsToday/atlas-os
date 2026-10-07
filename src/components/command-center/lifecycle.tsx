import { Link } from 'wouter';
import { Workflow, ArrowRight } from 'lucide-react';
import { type CommandSignals, scoutState } from '@/services/command-center';
import { Panel, StateBadge } from './operating-panels';

export function AtlasLifecycle({ signals: s }: { signals: CommandSignals }) {
  const p = s.pipeline.data;
  const observed = (n: number | undefined, source: string) => n === undefined ? source : n > 0 ? 'RECORDED' : 'NOT YET REACHED';
  const stages = [
    { label: 'Scout', href: '/scout', state: scoutState(s), note: 'Discovery scheduler' },
    { label: 'Business', href: '/scout', state: observed(p?.counts.businesses, s.pipeline.state), note: 'Pipeline records' },
    { label: 'Evidence', href: '/visibility', state: 'UNKNOWN', note: 'No aggregate evidence count' },
    { label: 'Score', href: '/visibility', state: observed(p?.counts.scores, s.pipeline.state), note: 'Includes withheld records' },
    { label: 'Audit', href: '/visibility', state: observed(p?.counts.audits, s.pipeline.state), note: 'Recorded audits' },
    { label: 'Opportunity', href: '/crm', state: 'UNKNOWN', note: 'No authoritative aggregate' },
    { label: 'Mission', href: '/mission-queue', state: observed(p?.counts.missions, s.pipeline.state), note: p?.missionExecutionEnabled === false ? 'Execution disabled' : 'Queue records ≠ execution' },
    { label: 'Client', href: '/clients', state: 'UNKNOWN', note: 'Engagements ≠ client count' },
    { label: 'Delivery', href: '/clients', state: 'UNKNOWN', note: 'No delivery-state aggregate' },
    { label: 'Invoice', href: '/finance', state: s.finance.data ? (s.finance.data.invoices.items.length ? 'RECORDED' : s.finance.data.invoices.nextCursor ? 'UNKNOWN' : 'NOT YET REACHED') : s.finance.state, note: 'Operational state only' },
    { label: 'Payment', href: '/finance', state: observed(s.finance.data?.receivedRevenue.paymentCount, s.finance.state), note: 'Human-recorded payments' },
    { label: 'Revenue', href: '/finance', state: observed(s.finance.data?.receivedRevenue.paymentCount, s.finance.state), note: 'Recorded payments only' },
  ];
  return <Panel id="lifecycle" title="Atlas operating lifecycle" className="cc-lifecycle-panel"><div className="cc-panel-title"><Workflow size={24} aria-hidden="true" /><div><h3>One operating system. One connected journey.</h3><p>Discovery becomes evidence. Human decisions turn opportunity into delivery and recorded revenue.</p></div></div><ol className="cc-lifecycle">{stages.map((stage, index) => <li key={stage.label}><Link href={stage.href} className="focus-ring" data-state={stage.state}><span className="cc-stage-number">{String(index + 1).padStart(2, '0')}<ArrowRight size={13} aria-hidden="true" /></span><strong>{stage.label}</strong><StateBadge state={stage.state} /><small>{stage.note}</small></Link></li>)}</ol><div className="cc-lifecycle-legend"><StateBadge state="ACTIVE" /><StateBadge state="RECORDED" /><StateBadge state="NOT YET REACHED" /><StateBadge state="DISABLED" /><StateBadge state="UNKNOWN" /></div><p className="cc-footnote">Recorded means records exist, not that the stage is running. Not yet reached means the source returned zero records. Unknown means no reliable aggregate is exposed. This map does not imply automatic end-to-end execution.</p></Panel>;
}
