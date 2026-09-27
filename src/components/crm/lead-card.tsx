import { CalendarClock, ChevronRight, MapPin, Zap } from 'lucide-react';

import {
  formatLeadDate,
  isFollowUpOverdue,
  type Lead,
  crmStages,
  type LeadStatus,
} from '@/services/crm';

interface LeadCardProps {
  lead: Lead;
  onOpen: (lead: Lead) => void;
  onStatusChange: (status: LeadStatus) => void;
}

const money = (value: number) => `GH₵ ${value.toLocaleString('en-GH')}`;

export function LeadCard({ lead, onOpen, onStatusChange }: LeadCardProps) {
  const overdue = isFollowUpOverdue(lead);

  return (
    <article
      className="rounded-lg border border-[#26374e] bg-[#101f31] p-3.5 shadow-[0_5px_15px_rgba(0,0,0,.08)] transition-transform hover:-translate-y-0.5 hover:border-[#3a4e68]"
      onClick={() => onOpen(lead)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(lead);
      }}
      role="button"
      tabIndex={0}
      data-testid={`card-lead-${lead.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[12px] font-semibold text-white">{lead.businessName}</p>
          <p className="mt-1 truncate text-[10px] text-[#8798ad]">{lead.contactName || 'No contact yet'}</p>
        </div>
        <span className="shrink-0 rounded-md bg-[#16a08518] px-2 py-1 font-mono text-[10px] font-semibold text-[#42c7a8]">
          {lead.visibilityScore}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#778aa0]">
        <MapPin size={11} className="shrink-0" />
        <span className="truncate">{lead.location || 'Location not set'}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-[#d4af37]">{money(lead.estimatedDealValue)}</span>
        <span className="flex items-center gap-1 font-mono text-[9px] text-[#42c7a8]">
          <Zap size={10} /> score
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#233247] pt-3">
        <span className={`flex min-w-0 items-center gap-1.5 truncate text-[9px] ${overdue ? 'text-[#e28c76]' : 'text-[#71839a]'}`}>
          <CalendarClock size={11} className="shrink-0" />
          {lead.nextFollowUpDate ? `${overdue ? 'Overdue · ' : ''}${formatLeadDate(lead.nextFollowUpDate)}` : 'No follow-up'}
        </span>
        <select
          value={lead.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onStatusChange(event.target.value as LeadStatus)}
          className="max-w-[112px] bg-transparent text-right font-mono text-[9px] text-[#9dafc0] outline-none"
          data-testid={`select-lead-status-${lead.id}`}
          aria-label={`Status for ${lead.businessName}`}
        >
          {crmStages.map((stage) => <option className="bg-[#0b1f3a]" key={stage} value={stage}>{stage}</option>)}
        </select>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 font-mono text-[9px] uppercase tracking-wider text-[#d4af37]">
        View lead <ChevronRight size={11} />
      </div>
    </article>
  );
}