import { useMemo, useState } from 'react';
import { Filter, Plus, Search, SlidersHorizontal, X } from 'lucide-react';

import { PageIntro } from '@/components/atlas-shell';
import { LeadCard } from '@/components/crm/lead-card';
import { LeadDetailPanel } from '@/components/crm/lead-detail-panel';
import { LeadForm } from '@/components/crm/lead-form';
import {
  crmStages,
  type Lead,
  type LeadInput,
  type LeadStatus,
  useCrmLeads,
} from '@/services/crm';

const cardClass = 'card-glow rounded-xl border border-[#233247] bg-[#0d1a2b]/90';
const buttonClass = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d] active:translate-y-0';
const ghostButton = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0d1a2b] px-3.5 py-2.5 text-[11px] font-semibold text-[#b6c3d1] transition-colors hover:border-[#d4af37] hover:text-white';
const money = (value: number) => `GH₵ ${value.toLocaleString('en-GH')}`;

export function CrmPage() {
  const { leads, createLead, updateLead, deleteLead } = useCrmLeads();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | LeadStatus>('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'overdue' | 'scheduled'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null | undefined>(undefined);

  const categories = useMemo(() => ['All', ...Array.from(new Set(leads.map((lead) => lead.businessCategory).filter(Boolean))).sort()], [leads]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const haystack = [
        lead.businessName,
        lead.businessCategory,
        lead.location,
        lead.contactName,
        lead.phone,
        lead.email,
        lead.website,
        lead.notes,
      ].join(' ').toLowerCase();
      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
      const matchesStatus = statusFilter === 'All' || lead.status === statusFilter;
      const matchesCategory = categoryFilter === 'All' || lead.businessCategory === categoryFilter;
      const today = new Date().toISOString().slice(0, 10);
      const matchesFollowUp = followUpFilter === 'all'
        || (followUpFilter === 'overdue' && lead.nextFollowUpDate < today && !['Won', 'Lost'].includes(lead.status))
        || (followUpFilter === 'scheduled' && lead.nextFollowUpDate > today && !['Won', 'Lost'].includes(lead.status));
      return matchesQuery && matchesStatus && matchesCategory && matchesFollowUp;
    });
  }, [categoryFilter, followUpFilter, leads, query, statusFilter]);

  const openCreate = () => {
    setSelectedLead(null);
    setEditingLead(null);
  };

  const openEdit = (lead: Lead) => {
    setSelectedLead(null);
    setEditingLead(lead);
  };

  const saveLead = async (input: LeadInput) => {
    if (editingLead) {
      const updated = await updateLead(editingLead.id, input);
      setEditingLead(undefined);
      setSelectedLead(updated);
    } else {
      const created = await createLead(input);
      setEditingLead(undefined);
      setSelectedLead(created);
    }
  };

  const removeLead = async () => {
    if (!selectedLead) return;
    const confirmed = window.confirm(`Delete ${selectedLead.businessName} from the CRM?`);
    if (!confirmed) return;
    await deleteLead(selectedLead.id);
    setSelectedLead(null);
  };

  const changeStatus = async (lead: Lead, status: LeadStatus) => {
    const updated = await updateLead(lead.id, { status });
    if (selectedLead?.id === updated.id) setSelectedLead(updated);
  };

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageIntro
        eyebrow="Revenue engine"
        title="CRM pipeline"
        description="One local-first workspace for every MapSpark conversation, follow-up, and opportunity."
        action={<button className={buttonClass} onClick={openCreate} data-testid="button-add-lead"><Plus size={14} /> Add lead</button>}
      />

      <div className="mb-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0c1a2c] px-3 py-2.5 sm:max-w-md">
            <Search size={15} className="text-[#71839a]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search business, contact, email, notes..." className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#667990]" data-testid="input-search-leads" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#71839a]">{filtered.length} of {leads.length} leads</span>
            <button className={filtersOpen ? buttonClass : ghostButton} onClick={() => setFiltersOpen((open) => !open)} data-testid="button-toggle-lead-filters"><Filter size={13} /> <span className="hidden sm:inline">Filter</span></button>
          </div>
        </div>

        {filtersOpen && (
          <div className={`${cardClass} flex flex-col gap-3 p-4 sm:flex-row sm:items-end`} data-testid="panel-lead-filters">
            <label className="flex-1"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Status</span><select className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All' | LeadStatus)} data-testid="select-filter-status"><option>All</option>{crmStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <label className="flex-1"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Category</span><select className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} data-testid="select-filter-category">{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="flex-1"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Follow-up</span><select className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" value={followUpFilter} onChange={(event) => setFollowUpFilter(event.target.value as typeof followUpFilter)} data-testid="select-filter-follow-up"><option value="all">All leads</option><option value="scheduled">Scheduled</option><option value="overdue">Overdue</option></select></label>
            <button className={`${ghostButton} shrink-0`} onClick={() => { setQuery(''); setStatusFilter('All'); setCategoryFilter('All'); setFollowUpFilter('all'); }} data-testid="button-clear-lead-filters"><X size={13} /> Clear</button>
          </div>
        )}
      </div>

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#233247] bg-[#0c192a] px-4 py-3">
        <SlidersHorizontal size={15} className="text-[#d4af37]" />
        <p className="text-[11px] text-[#a7b5c5]">Pipeline health</p>
        <span className="ml-auto font-mono text-[10px] text-[#42c7a8]">{leads.filter((lead) => lead.status === 'Won').length} won</span>
        <span className="font-mono text-[10px] text-[#d4af37]">{money(leads.filter((lead) => lead.status !== 'Lost').reduce((sum, lead) => sum + lead.estimatedDealValue, 0))} open value</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {crmStages.map((stage) => {
          const stageLeads = filtered.filter((lead) => lead.status === stage);
          const total = stageLeads.reduce((sum, lead) => sum + lead.estimatedDealValue, 0);
          return (
            <section key={stage} className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${stage === 'Won' ? 'bg-[#16a085]' : stage === 'Lost' ? 'bg-[#d65c63]' : 'bg-[#d4af37]'}`} /><h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#acbac9]">{stage}</h3></div>
                <span className="rounded bg-[#192a3e] px-1.5 py-0.5 font-mono text-[9px] text-[#71839a]">{stageLeads.length}</span>
              </div>
              <p className="mb-3 font-mono text-[10px] text-[#61758d]">{money(total)}</p>
              <div className="space-y-2.5">
                {stageLeads.map((lead) => <LeadCard key={lead.id} lead={lead} onOpen={setSelectedLead} onStatusChange={(status) => void changeStatus(lead, status)} />)}
                {stageLeads.length === 0 && <div className="rounded-lg border border-dashed border-[#2a3b51] p-7 text-center"><p className="font-mono text-[9px] text-[#5f738b]">No leads</p></div>}
              </div>
            </section>
          );
        })}
      </div>

      {selectedLead && <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} onEdit={() => openEdit(selectedLead)} onDelete={() => void removeLead()} />}
      {editingLead !== undefined && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020812]/70 p-4 backdrop-blur-sm"><div className={`${cardClass} w-full max-w-2xl p-5 sm:p-7`} role="dialog" aria-modal="true"><LeadForm lead={editingLead} onSave={saveLead} onCancel={() => setEditingLead(undefined)} /></div></div>}
    </div>
  );
}