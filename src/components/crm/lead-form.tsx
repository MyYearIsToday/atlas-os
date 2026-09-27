import { useEffect, useState } from 'react';
import { CalendarDays, Save, X } from 'lucide-react';

import {
  crmStages,
  emptyLead,
  type Lead,
  type LeadInput,
  type LeadStatus,
} from '@/services/crm';

interface LeadFormProps {
  lead?: Lead | null;
  onSave: (input: LeadInput) => Promise<void> | void;
  onCancel: () => void;
}

const inputClass = 'w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none transition-colors placeholder:text-[#667990] focus:border-[#d4af37]';
const labelClass = 'mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]';

function fieldValue(lead: Lead | null | undefined): LeadInput {
  if (!lead) return emptyLead;
  const { id: _id, ...values } = lead;
  return values;
}

export function LeadForm({ lead, onSave, onCancel }: LeadFormProps) {
  const [form, setForm] = useState<LeadInput>(() => fieldValue(lead));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(fieldValue(lead));
  }, [lead]);

  const update = <K extends keyof LeadInput>(key: K, value: LeadInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.businessName.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...form,
        businessName: form.businessName.trim(),
        businessCategory: form.businessCategory.trim() || 'Uncategorized',
        estimatedDealValue: Number(form.estimatedDealValue) || 0,
        visibilityScore: Math.min(100, Math.max(0, Number(form.visibilityScore) || 0)),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex max-h-[calc(100dvh-2rem)] flex-col" data-testid={lead ? 'form-edit-lead' : 'form-create-lead'}>
      <div className="flex items-start justify-between gap-4 border-b border-[#233247] pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#d4af37]">{lead ? 'Edit record' : 'New record'}</p>
          <h3 className="mt-1 font-display text-[17px] font-semibold text-white">{lead ? 'Update lead' : 'Add a lead'}</h3>
        </div>
        <button type="button" onClick={onCancel} className="rounded-md p-2 text-[#71839a] hover:bg-white/[.06] hover:text-white" aria-label="Close lead form" data-testid="button-close-lead-form">
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar mt-5 space-y-5 overflow-y-auto pr-1">
        <section>
          <p className="mb-3 font-mono text-[9px] uppercase tracking-[.16em] text-[#42c7a8]">Business profile</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className={labelClass}>Business name *</span><input required className={inputClass} value={form.businessName} onChange={(event) => update('businessName', event.target.value)} placeholder="e.g. Golden Bean Café" data-testid="input-lead-business-name" /></label>
            <label><span className={labelClass}>Category</span><input className={inputClass} value={form.businessCategory} onChange={(event) => update('businessCategory', event.target.value)} placeholder="Restaurant" data-testid="input-lead-category" /></label>
            <label><span className={labelClass}>Location</span><input className={inputClass} value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="Osu, Accra" data-testid="input-lead-location" /></label>
            <label><span className={labelClass}>Contact name</span><input className={inputClass} value={form.contactName} onChange={(event) => update('contactName', event.target.value)} placeholder="Decision maker" data-testid="input-lead-contact-name" /></label>
            <label><span className={labelClass}>Phone</span><input type="tel" className={inputClass} value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+233..." data-testid="input-lead-phone" /></label>
            <label><span className={labelClass}>Email</span><input type="email" className={inputClass} value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="hello@business.com" data-testid="input-lead-email" /></label>
            <label><span className={labelClass}>Website</span><input type="url" className={inputClass} value={form.website} onChange={(event) => update('website', event.target.value)} placeholder="https://" data-testid="input-lead-website" /></label>
            <label className="sm:col-span-2"><span className={labelClass}>Google Maps URL</span><input type="url" className={inputClass} value={form.googleMapsUrl} onChange={(event) => update('googleMapsUrl', event.target.value)} placeholder="https://maps.google.com/..." data-testid="input-lead-maps-url" /></label>
          </div>
        </section>

        <section>
          <p className="mb-3 font-mono text-[9px] uppercase tracking-[.16em] text-[#42c7a8]">Revenue signal</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={labelClass}>Lead status</span><select className={inputClass} value={form.status} onChange={(event) => update('status', event.target.value as LeadStatus)} data-testid="select-lead-form-status">{crmStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <label><span className={labelClass}>Visibility score</span><input type="number" min="0" max="100" className={inputClass} value={form.visibilityScore} onChange={(event) => update('visibilityScore', Number(event.target.value))} data-testid="input-lead-visibility-score" /></label>
            <label><span className={labelClass}>Estimated deal value (GH₵)</span><input type="number" min="0" className={inputClass} value={form.estimatedDealValue} onChange={(event) => update('estimatedDealValue', Number(event.target.value))} data-testid="input-lead-deal-value" /></label>
            <label><span className={labelClass}>Last contact date</span><span className="relative block"><CalendarDays size={14} className="pointer-events-none absolute right-3 top-3 text-[#71839a]" /><input type="date" className={`${inputClass} pr-9`} value={form.lastContactDate} onChange={(event) => update('lastContactDate', event.target.value)} data-testid="input-lead-last-contact" /></span></label>
            <label className="sm:col-span-2"><span className={labelClass}>Next follow-up date</span><span className="relative block"><CalendarDays size={14} className="pointer-events-none absolute right-3 top-3 text-[#d4af37]" /><input type="date" className={`${inputClass} pr-9`} value={form.nextFollowUpDate} onChange={(event) => update('nextFollowUpDate', event.target.value)} data-testid="input-lead-follow-up" /></span></label>
          </div>
        </section>

        <label><span className={labelClass}>Notes</span><textarea rows={4} className={`${inputClass} resize-y`} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Context, objections, next action..." data-testid="input-lead-notes" /></label>
      </div>

      <div className="mt-5 flex gap-2 border-t border-[#233247] pt-4">
        <button type="button" onClick={onCancel} className={`${inputClass} flex-1 text-[#b6c3d1]`} data-testid="button-cancel-lead-form">Cancel</button>
        <button type="submit" disabled={saving || !form.businessName.trim()} className={`${buttonClass} flex-1 disabled:cursor-not-allowed disabled:opacity-50`} data-testid="button-save-lead">
          <Save size={14} /> {saving ? 'Saving...' : lead ? 'Save changes' : 'Create lead'}
        </button>
      </div>
    </form>
  );
}

const buttonClass = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d] active:translate-y-0';