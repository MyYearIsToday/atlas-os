import { useEffect, useState } from 'react';
import { PageIntro } from '@/components/atlas-shell';

type FeedbackView = { id: string; workerId: string; stageId: string; type: string; title: string; observation: string; reasoning: string; businessImpact: string; affectedStages: string[]; evidenceRefs: string[]; basis: string; confidence: string; researchQuestions: string[]; recommendedSpecialist?: string; status: string; resolution?: string; handoffId?: string; investigationIds?: string[]; planChangeIds?: string[]; missionTaskIds?: string[]; notes?: string[]; proposedAction?: { kind: string; detail: string } };
type CompletionView = { state: string; reasons: string[]; unresolved: Array<{ kind: string; ref: string; detail: string }>; plannerNote?: string; assessedBy: string; at: string };
type StageView = { id: string; title: string; status: string; staleBecause?: string | null; priorVersions?: number; error?: string | null };
type VersionView = { id: string; round: number; archivedAt: string; reason: string; kind: string; planChangeId: string | null; sourceDigest: Array<{ id: string; decision?: string }>; stages: Record<string, { status: string; output: unknown; sourceRefs?: string[] }> };
type PlanView = { id: string; at: string; decision: string; reason: string; evaluated?: boolean; trigger?: { kind: string; ids: string[]; feedbackIds?: string[]; investigationIds?: string[] }; feedbackVerdicts?: Array<{ feedbackId: string; verdict: string; reason: string }>; revised: string[]; stale: string[]; tasks: Array<{ title: string; assignedAI: string; status: string; error?: string }> };
type DossierView = { businessId: string; status: string; researchRound?: number; stages: StageView[]; planLog: PlanView[]; history: VersionView[]; revisionLog: Array<{ id: string; stage: string; at: string; reason: string; planChangeId?: string }>; revisions?: Record<string, { reason: string; pending: boolean; count: number }>; feedback?: FeedbackView[]; completion?: CompletionView | null; investigations: Array<{ id: string; handoffId?: string; planChangeId?: string; feedbackId?: string; question: string; finding?: string; stopReason?: string; concluded?: boolean; approvedSourceIds?: string[] }>; handoffs?: Array<{ id: string; investigationId?: string; feedbackId?: string; planChangeId?: string; from: string; fromEmployee?: string; kind: string; detail: string; status: string; resolution?: string }>; pipelineLink?: { crm: { status: string; stage: string; businessName: string; note: string }; client: { status: string; reason: string }; contentStack: { status: string; note: string; items: Array<{ title: string; channel: string; approval: string }> } } | null };

export function DossierHistoryPage() {
  const [businessId, setBusinessId] = useState(() => new URLSearchParams(window.location.search).get('business') ?? '');
  const [items, setItems] = useState<Array<{ businessId: string; businessName?: string; dossier?: { status?: string } | null }>>([]);
  const [dossier, setDossier] = useState<DossierView | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/scout/candidates').then(async (r) => {
      if (!r.ok) return;
      const body = await r.json() as { items?: Array<{ businessId: string; name?: string; dossier?: { status?: string } | null }> };
      setItems((body.items ?? []).map((item) => ({ businessId: item.businessId, businessName: item.name, dossier: item.dossier })));
    }).catch(() => undefined);
  }, []);

  async function load(id: string) {
    const clean = id.trim();
    if (!clean) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/atlas/dossiers/${encodeURIComponent(clean)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setDossier(null); setError((body as { error?: { message?: string } }).error?.message ?? 'No dossier for that business.'); return; }
      const view = body as DossierView;
      setDossier(view);
      setVersionId(view.history?.[0]?.id ?? null);
    } catch {
      setError('The dossier service is not reachable from this page.');
    } finally { setLoading(false); }
  }

  async function decide(feedbackId: string, decision: 'accept' | 'dismiss' | 'reevaluate') {
    if (!dossier) return;
    try {
      const r = await fetch(`/api/atlas/dossiers/${encodeURIComponent(dossier.businessId)}/feedback/${encodeURIComponent(feedbackId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      if (!r.ok) { const body = await r.json().catch(() => ({})) as { message?: string }; setError(body.message ?? 'That decision could not be recorded.'); return; }
      const body = await r.json().catch(() => ({})) as { evaluated?: boolean };
      await load(dossier.businessId);
      if (decision === 'reevaluate' && body.evaluated === false) setError('The planner could not evaluate it just now. The item stays open and can be asked again.');
    } catch { setError('The dossier service is not reachable from this page.'); }
  }
  const openFeedback = (dossier?.feedback ?? []).filter((f) => ['deferred', 'open', 'awaiting_reevaluation', 'investigating'].includes(f.status));
  const version = dossier?.history.find((item) => item.id === versionId) ?? dossier?.history.at(-1) ?? null;

  return (
    <div>
      <PageIntro eyebrow="Dossier" title="Research history" description="Earlier profiles, audits, competitor and market analysis, SWOT, growth, PR, campaigns and plans stay attached to the decision that replaced them. Nothing here sends, publishes or spends." />
      <form className="mb-4 flex max-w-3xl flex-col gap-3 rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void load(businessId); }}>
        <label className="flex-1 text-[12px] text-[#9aabbf]">Business id
          <input value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="mt-1 w-full rounded-md border border-[#2a3d55] bg-[#07111f] px-3 py-2 text-[13px] text-white" placeholder="business id" data-testid="input-dossier-business" />
        </label>
        <button className="self-end rounded-md bg-[#d4af37] px-4 py-2 text-[13px] font-semibold text-[#0b1f3a]" type="submit" data-testid="button-load-dossier">{loading ? 'Loading' : 'Open dossier'}</button>
      </form>
      {items.length > 0 && (
        <div className="mb-4 flex max-w-3xl flex-wrap gap-2">
          {items.slice(0, 12).map((item) => (
            <button key={item.businessId} type="button" className="rounded-md border border-[#2a3d55] px-2 py-1 text-[12px] text-[#d5deea]" onClick={() => { setBusinessId(item.businessId); void load(item.businessId); }}>
              {item.businessName ?? item.businessId}{item.dossier?.status ? ` · ${item.dossier.status}` : ''}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mb-4 text-[13px] text-[#e07a7a]" role="alert">{error}</p>}
      {dossier && (
        <div className="grid max-w-6xl gap-4 lg:grid-cols-[280px_1fr]">
          <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4">
            <h2 className="text-[13px] font-semibold text-white">Current sections</h2>
            <p className="mt-1 text-[11px] text-[#89a]">{dossier.status}{dossier.researchRound ? ` · round ${dossier.researchRound}` : ''}</p>
            <ul className="mt-3 space-y-2">
              {dossier.stages.map((stage) => (
                <li key={stage.id} className="text-[12px] text-[#d5deea]">
                  <span className="text-white">{stage.title}</span>
                  <span className="mt-0.5 block text-[#89a]">{stage.status}{stage.priorVersions ? ` · ${stage.priorVersions} earlier` : ''}{stage.staleBecause ? ` · stale: ${stage.staleBecause}` : ''}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="space-y-4">
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4" data-testid="section-completion">
              <h2 className="text-[13px] font-semibold text-white">Is the work complete?</h2>
              {!dossier.completion && <p className="mt-2 text-[12px] text-[#89a]">Not assessed yet. It is judged when every section has run.</p>}
              {dossier.completion && (
                <div className="mt-2 text-[12px] text-[#d5deea]">
                  <p><span className="text-[#d4af37]">{dossier.completion.state.replace(/_/g, ' ')}</span> <span className="text-[#89a]">· {dossier.completion.assessedBy} · {dossier.completion.at.slice(0, 16).replace('T', ' ')}</span></p>
                  {dossier.completion.plannerNote && <p className="mt-1">Planner: {dossier.completion.plannerNote}</p>}
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[#c5d0dc]">{dossier.completion.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {dossier.completion.unresolved.length > 0 && <ul className="mt-2 space-y-1 text-[#e0b66a]">{dossier.completion.unresolved.map((u, i) => <li key={i}>{u.kind} {u.ref}: {u.detail}</li>)}</ul>}
                </div>
              )}
            </section>
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4" data-testid="section-worker-feedback">
              <h2 className="text-[13px] font-semibold text-white">Worker discoveries and challenges</h2>
              {(dossier.feedback ?? []).length === 0 && <p className="mt-2 text-[12px] text-[#89a]">No worker has raised a finding, challenge or research request.</p>}
              <ul className="mt-3 space-y-3 text-[12px] text-[#d5deea]">
                {(dossier.feedback ?? []).map((f) => (
                  <li key={f.id}>
                    <span className="text-[#d4af37]">{f.status.replace('_', ' ')}</span> <span className="text-white">{f.id} · {f.type.replace('_', ' ')}</span> from {f.workerId} on {f.stageId} · {f.basis}, {f.confidence} confidence: {f.title}
                    <span className="mt-1 block text-[#c5d0dc]">{f.observation}</span>
                    <span className="mt-1 block text-[#89a]">Why it matters: {f.reasoning} Impact: {f.businessImpact}{f.affectedStages.length ? ` Affects ${f.affectedStages.join(', ')}.` : ''}</span>
                    {f.evidenceRefs.length > 0 && <span className="mt-1 block text-[#89a]">Evidence: {f.evidenceRefs.join(', ')}</span>}
                    {f.researchQuestions.length > 0 && <span className="mt-1 block text-[#89a]">Research requested: {f.researchQuestions.join(' | ')}{f.recommendedSpecialist ? ` (suggests ${f.recommendedSpecialist})` : ''}</span>}
                    {f.resolution && <span className="mt-1 block">Planner decision: {f.resolution}</span>}
                    <span className="mt-1 block text-[11px] text-[#89a]">{[f.handoffId && `handoff ${f.handoffId}`, f.investigationIds?.length && `investigation ${f.investigationIds.join(', ')}`, f.planChangeIds?.length && `plan ${f.planChangeIds.join(', ')}`, f.missionTaskIds?.length && `specialist mission ${f.missionTaskIds.join(', ')}`].filter(Boolean).join(' · ')}</span>
                    {f.notes?.map((n, i) => <span key={i} className="mt-1 block text-[11px] text-[#89a]">{n}</span>)}
                  </li>
                ))}
              </ul>
              {openFeedback.length > 0 && (
                <div className="mt-4 border-t border-[#233247] pt-3">
                  <p className="text-[12px] text-white">Unresolved items</p>
                  <ul className="mt-2 space-y-2 text-[12px] text-[#d5deea]">
                    {openFeedback.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2">
                        <span>{f.id} {f.title}</span>
                        {f.status === 'deferred' && (<>
                          <button type="button" className="rounded border border-[#2a3d55] px-2 py-0.5 text-[11px]" onClick={() => void decide(f.id, 'accept')}>Accept</button>
                          <button type="button" className="rounded border border-[#2a3d55] px-2 py-0.5 text-[11px]" onClick={() => void decide(f.id, 'dismiss')}>Dismiss</button>
                          <button type="button" className="rounded border border-[#2a3d55] px-2 py-0.5 text-[11px]" onClick={() => void decide(f.id, 'reevaluate')}>Ask the planner again</button>
                        </>)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4">
              <h2 className="text-[13px] font-semibold text-white">Why the plan changed</h2>
              {(dossier.planLog ?? []).length === 0 && <p className="mt-2 text-[12px] text-[#89a]">No planner revision has been recorded.</p>}
              <ul className="mt-3 space-y-3">
                {(dossier.planLog ?? []).map((change) => (
                  <li key={change.id} className="text-[12px] text-[#d5deea]">
                    <span className="text-[#d4af37]">{change.decision}</span> {change.reason}
                    {change.evaluated === false && <span className="mt-1 block text-[#e0b66a]">Not evaluated: the planner gave no usable decision.</span>}
                    {(change.feedbackVerdicts ?? []).map((v) => <span key={v.feedbackId} className="mt-1 block text-[#89a]">{v.feedbackId}: {v.verdict}. {v.reason}</span>)}
                    {change.revised.length > 0 && <span className="mt-1 block text-[#89a]">Revised: {change.revised.join(', ')}. Regenerated from that: {change.stale.join(', ') || 'none'}.</span>}
                    {change.tasks.length > 0 && <span className="mt-1 block text-[#89a]">Specialist work: {change.tasks.map((task) => `${task.title} (${task.assignedAI}, ${task.status}${task.error ? `: ${task.error}` : ''})`).join('; ')}</span>}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4">
              <h2 className="text-[13px] font-semibold text-white">Archived versions</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {(dossier.history ?? []).map((item) => (
                  <button key={item.id} type="button" className={`rounded-md border px-2 py-1 text-[12px] ${item.id === version?.id ? 'border-[#d4af37] text-white' : 'border-[#2a3d55] text-[#d5deea]'}`} onClick={() => setVersionId(item.id)}>
                    {item.kind} · {item.archivedAt.slice(0, 16).replace('T', ' ')}
                  </button>
                ))}
              </div>
              {version && (
                <div className="mt-3 text-[12px] text-[#d5deea]">
                  <p>{version.reason}{version.planChangeId ? ` · plan ${version.planChangeId}` : ''}</p>
                  <p className="mt-1 text-[#89a]">{version.sourceDigest.length} source references kept with this version.</p>
                  <ul className="mt-3 space-y-2">
                    {Object.entries(version.stages).map(([id, stage]) => (
                      <li key={id}>
                        <span className="text-white">{id}</span> <span className="text-[#89a]">{stage.status}{stage.sourceRefs?.length ? ` · sources ${stage.sourceRefs.join(', ')}` : ''}</span>
                        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-[#07111f] p-2 text-[11px] text-[#c5d0dc]">{JSON.stringify(stage.output, null, 2)}</pre>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(dossier.revisionLog ?? []).length > 0 && (
                <ul className="mt-3 space-y-2 text-[12px] text-[#d5deea]">
                  {dossier.revisionLog.slice(-12).map((entry) => (
                    <li key={entry.id}><span className="text-white">{entry.stage}</span> {entry.reason} <span className="text-[#89a]">{entry.planChangeId ? `· ${entry.planChangeId}` : ''} {entry.at.slice(0, 16).replace('T', ' ')}</span></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4">
              <h2 className="text-[13px] font-semibold text-white">Handoffs</h2>
              {(dossier.handoffs ?? []).length === 0 && <p className="mt-2 text-[12px] text-[#89a]">No specialist or investigation handoff has been recorded.</p>}
              <ul className="mt-3 space-y-2 text-[12px] text-[#d5deea]">
                {(dossier.handoffs ?? []).map((item) => (
                  <li key={item.id}><span className="text-[#d4af37]">{item.status}</span> {item.from}{item.fromEmployee ? ` → ${item.fromEmployee}` : ''} · {item.kind.replace('_', ' ')}{[item.feedbackId && ` · feedback ${item.feedbackId}`, item.investigationId && ` · investigation ${item.investigationId}`, item.planChangeId && ` · plan ${item.planChangeId}`].filter(Boolean).join('')}. {item.detail}{item.resolution ? <span className="mt-1 block text-[#89a]">{item.resolution}</span> : null}</li>
                ))}
              </ul>
              {dossier.revisions && Object.keys(dossier.revisions).length > 0 && <p className="mt-3 text-[11px] text-[#89a]">Open revisions: {Object.entries(dossier.revisions).filter(([, value]) => value.pending).map(([id]) => id).join(', ') || 'none pending'}.</p>}
            </section>
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4">
              <h2 className="text-[13px] font-semibold text-white">Scout, CRM, clients, content</h2>
              {!dossier.pipelineLink && <p className="mt-2 text-[12px] text-[#89a]">No pipeline suggestion yet. It is written only when the action plan completes, and it does not create a lead, a client, or a published asset.</p>}
              {dossier.pipelineLink && (
                <ul className="mt-3 space-y-2 text-[12px] text-[#d5deea]">
                  <li>Scout record stays the source. Suggested CRM stage: {dossier.pipelineLink.crm.stage} for {dossier.pipelineLink.crm.businessName}. {dossier.pipelineLink.crm.note}</li>
                  <li>Client: {dossier.pipelineLink.client.status}. {dossier.pipelineLink.client.reason}</li>
                  <li>Content stack: {dossier.pipelineLink.contentStack.status}. {dossier.pipelineLink.contentStack.note}</li>
                  {dossier.pipelineLink.contentStack.items.map((item) => <li key={`${item.channel}-${item.title}`}>{item.title} · {item.channel} · {item.approval}</li>)}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-4">
              <h2 className="text-[13px] font-semibold text-white">Investigations</h2>
              {(dossier.investigations ?? []).length === 0 && <p className="mt-2 text-[12px] text-[#89a]">No question-driven investigation has been run.</p>}
              <ul className="mt-3 space-y-2 text-[12px] text-[#d5deea]">
                {(dossier.investigations ?? []).map((item) => (
                  <li key={item.id}>{item.id}: {item.question}{item.finding ? ` — ${item.finding}` : ''}{item.handoffId ? ` · handoff ${item.handoffId}` : ''}{item.planChangeId ? ` · plan ${item.planChangeId}` : ''}{item.feedbackId ? ` · for feedback ${item.feedbackId}` : ''} <span className="text-[#89a]">{item.stopReason ?? ''}</span></li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
