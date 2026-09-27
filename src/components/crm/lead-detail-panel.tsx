import { CalendarClock, ExternalLink, Globe, Mail, MapPin, Pencil, Phone, Trash2, X } from 'lucide-react';

import { formatLeadDate, type Lead } from '@/services/crm';

interface LeadDetailPanelProps {
  lead: Lead;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const money = (value: number) => `GH₵ ${value.toLocaleString('en-GH')}`;

export function LeadDetailPanel({ lead, onClose, onEdit, onDelete }: LeadDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#020812]/65 backdrop-blur-sm" onClick={onClose}>
      <aside className="scrollbar h-full w-full max-w-lg overflow-y-auto border-l border-[#2c3c52] bg-[#0b1f3a] p-5 sm:p-7" onClick={(event) => event.stopPropagation()} aria-label={`${lead.businessName} lead details`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#d4af37]">Lead detail</p>
            <h3 className="mt-2 font-display text-[21px] font-semibold tracking-[-.04em] text-white">{lead.businessName}</h3>
            <p className="mt-1 text-[11px] text-[#8798ad]">{lead.businessCategory} · {lead.location || 'Location not set'}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-[#71839a] hover:bg-white/[.06] hover:text-white" aria-label="Close lead details" data-testid="button-close-lead-detail"><X size={18} /></button>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Score</p><p className="mt-2 font-display text-xl font-semibold text-[#42c7a8]">{lead.visibilityScore}</p></div>
          <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Deal value</p><p className="mt-2 truncate font-display text-[15px] font-semibold text-[#d4af37]">{money(lead.estimatedDealValue)}</p></div>
          <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Status</p><p className="mt-2 truncate font-mono text-[10px] font-semibold text-white">{lead.status}</p></div>
        </div>

        <div className="mt-7 space-y-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.17em] text-[#8293aa]">Contact & presence</p>
          <div className="rounded-lg border border-[#233247] bg-[#091828] divide-y divide-[#233247]">
            <DetailRow icon={<span className="font-display text-[12px] font-bold text-[#d4af37]">{lead.contactName ? lead.contactName.slice(0, 1).toUpperCase() : '?'}</span>} value={lead.contactName || 'No contact name'} />
            <DetailRow icon={<Phone size={14} />} value={lead.phone || 'No phone'} href={lead.phone ? `tel:${lead.phone}` : undefined} />
            <DetailRow icon={<Mail size={14} />} value={lead.email || 'No email'} href={lead.email ? `mailto:${lead.email}` : undefined} />
            <DetailRow icon={<MapPin size={14} />} value={lead.location || 'No location'} />
            <DetailRow icon={<Globe size={14} />} value={lead.website || 'No website'} href={lead.website || undefined} external />
            {lead.googleMapsUrl && <DetailRow icon={<MapPin size={14} />} value="Open Google Maps profile" href={lead.googleMapsUrl} external />}
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#233247] bg-[#091828] p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#71839a]"><CalendarClock size={11} /> Last contact</p><p className="mt-2 text-[11px] text-[#dbe4ed]">{formatLeadDate(lead.lastContactDate)}</p></div>
          <div className="rounded-lg border border-[#284456] bg-[#0e2731] p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#42c7a8]"><CalendarClock size={11} /> Next follow-up</p><p className="mt-2 text-[11px] text-[#cae1dc]">{formatLeadDate(lead.nextFollowUpDate)}</p></div>
        </div>

        <div className="mt-7">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.17em] text-[#8293aa]">Notes</p>
          <div className="mt-3 rounded-lg border border-[#233247] bg-[#091828] p-4 text-[11px] leading-5 text-[#b7c5d4]">{lead.notes || 'No notes added yet.'}</div>
        </div>

        <div className="mt-7 flex gap-2 border-t border-[#233247] pt-5">
          <button onClick={onEdit} className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0d1a2b] px-3.5 py-2.5 text-[11px] font-semibold text-[#b6c3d1] hover:border-[#d4af37] hover:text-white" data-testid="button-edit-lead"><Pencil size={13} /> Edit lead</button>
          <button onClick={onDelete} className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-[#633840] bg-[#2b1723] px-3.5 py-2.5 text-[11px] font-semibold text-[#f09a8f] hover:border-[#e28c76]" data-testid="button-delete-lead"><Trash2 size={13} /> Delete</button>
        </div>
      </aside>
    </div>
  );
}

function DetailRow({ icon, value, href, external = false }: { icon: React.ReactNode; value: string; href?: string; external?: boolean }) {
  const content = <><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#d4af3715] text-[#d4af37]">{icon}</span><span className="min-w-0 flex-1 truncate">{value}</span>{href && <ExternalLink size={12} className="shrink-0 text-[#71839a]" />}</>;
  return href ? <a className="flex items-center gap-3 px-3 py-3 text-[11px] text-[#c7d3df] hover:bg-white/[.025] hover:text-white" href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{content}</a> : <div className="flex items-center gap-3 px-3 py-3 text-[11px] text-[#c7d3df]">{content}</div>;
}