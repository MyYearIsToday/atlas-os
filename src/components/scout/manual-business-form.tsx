import { useState } from 'react';
import { Save } from 'lucide-react';

import type { ManualBusinessInput } from '@/services/scout/manual-entry';
import { postManualBusiness, type ManualEntryResponse } from '@/services/scout/manual-entry-client';

const inputClass = 'w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none transition-colors placeholder:text-[#667990] focus:border-[#d4af37]';
const labelClass = 'mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]';
const buttonClass = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d] active:translate-y-0';

const emptyForm: Required<{ [K in keyof ManualBusinessInput]: string }> = {
  businessName: '', category: '', address: '', latitude: '', longitude: '', website: '', phone: '', source: '', notes: '',
};

export function ManualBusinessForm() {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ManualEntryResponse | null>(null);

  const update = (key: keyof typeof emptyForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const errorFor = (key: string) => (result && !result.ok ? result.errors.find((error) => error.field === key)?.message : undefined);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await postManualBusiness(form);
      setResult(response);
      if (response.ok) setForm(emptyForm);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof emptyForm, label: string, props: { required?: boolean; placeholder?: string; type?: string; span?: boolean } = {}) => (
    <label className={props.span ? 'sm:col-span-2' : undefined}>
      <span className={labelClass}>{label}{props.required ? ' *' : ''}</span>
      <input required={props.required} type={props.type ?? 'text'} className={inputClass} value={form[key]} onChange={(event) => update(key, event.target.value)} placeholder={props.placeholder} data-testid={`input-manual-${key}`} />
      {errorFor(key) && <span className="mt-1 block text-[10px] text-[#e5736a]">{errorFor(key)}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="form-manual-business">
      <div className="grid gap-3 sm:grid-cols-2">
        {field('businessName', 'Business name', { required: true, placeholder: 'e.g. Golden Bean Café', span: true })}
        {field('category', 'Category', { required: true, placeholder: 'catering.restaurant' })}
        {field('address', 'Address', { required: true, placeholder: 'Osu, Accra' })}
        {field('latitude', 'Latitude', { placeholder: '5.6037' })}
        {field('longitude', 'Longitude', { placeholder: '-0.1870' })}
        {field('website', 'Website', { placeholder: 'https://' })}
        {field('phone', 'Phone', { type: 'tel', placeholder: '+233...' })}
        {field('source', 'Source', { placeholder: 'Where did you find it?', span: true })}
        <label className="sm:col-span-2"><span className={labelClass}>Notes</span><textarea rows={3} className={`${inputClass} resize-y`} value={form.notes} onChange={(event) => update('notes', event.target.value)} data-testid="input-manual-notes" />{errorFor('notes') && <span className="mt-1 block text-[10px] text-[#e5736a]">{errorFor('notes')}</span>}</label>
      </div>
      <button type="submit" disabled={saving} className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-50`} data-testid="button-submit-manual-business"><Save size={14} /> {saving ? 'Submitting...' : 'Submit to Scout'}</button>
      {result && (
        <p className={`text-[11px] ${result.ok ? 'text-[#42c7a8]' : 'text-[#e5736a]'}`} role="status" data-testid="text-manual-result">
          {result.ok
            ? `${result.action === 'CREATED' ? 'Added' : 'Updated existing business'} · duplicate check: ${result.duplicateStatus} · dispatch: ${result.dispatch}`
            : result.message ?? 'Please fix the highlighted fields.'}
        </p>
      )}
    </form>
  );
}
