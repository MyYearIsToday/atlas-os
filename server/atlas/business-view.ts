/**
 * Read-only join of the server's persisted workflow records per business, keyed by the stable business id:
 * business (Scout/manual) -> score + audit (opportunity intelligence) -> prospect (lead lifecycle)
 * -> missions (server queue, task.clientId) -> approvals (object ids of those missions/prospects).
 * Pure function over existing in-memory/hydrated state; it creates and mutates nothing.
 */
interface BizLike { id: string; canonicalName: string; category?: string; address?: string; phone?: string; website?: string; status?: string; createdAt?: string; sourceReferences?: string[] }
interface TaskLike { taskId: string; title: string; assignedAI?: string; clientId: string | null; status: string; approvalRequired?: string; createdAt?: string; completedAt?: string | null; missionType?: string }
interface ProspectLike { prospectId: string; businessId: string; state: string; updatedAt?: string }
interface ApprovalLike { approvalId: string; objectType: string; objectId: string; outcome: string; actor: string; at: string }

export interface BusinessViewInput {
  businesses: Iterable<BizLike>;
  scores: Map<string, { overallScore: number | null; confidence?: unknown }>;
  audits: Map<string, { generatedAt?: string }>;
  tasks: TaskLike[];
  prospects: Iterable<ProspectLike>;
  approvals: Iterable<ApprovalLike>;
  outputs: Map<string, unknown>;
}

export function buildBusinessView(input: BusinessViewInput) {
  const prospectsByBiz = new Map<string, ProspectLike[]>();
  for (const p of input.prospects) prospectsByBiz.set(p.businessId, [...(prospectsByBiz.get(p.businessId) ?? []), p]);
  const approvals = [...input.approvals];
  return [...input.businesses].map((b) => {
    const missions = input.tasks.filter((t) => t.clientId === b.id);
    const prospects = prospectsByBiz.get(b.id) ?? [];
    const relatedIds = new Set([...missions.map((m) => m.taskId), ...prospects.map((p) => p.prospectId)]);
    const score = input.scores.get(b.id);
    return {
      businessId: b.id,
      name: b.canonicalName,
      category: b.category ?? null,
      address: b.address ?? null,
      source: b.sourceReferences?.[0] ?? null,
      createdAt: b.createdAt ?? null,
      opportunity: { scored: !!score, score: score?.overallScore ?? null, scoreWithheld: !!score && score.overallScore === null, auditAt: input.audits.get(b.id)?.generatedAt ?? null },
      lead: prospects.map((p) => ({ prospectId: p.prospectId, state: p.state, updatedAt: p.updatedAt ?? null })),
      missions: missions.map((m) => ({ taskId: m.taskId, title: m.title, assignedAI: m.assignedAI ?? null, status: m.status, approvalRequired: m.approvalRequired ?? null, missionType: m.missionType ?? null, createdAt: m.createdAt ?? null, completedAt: m.completedAt ?? null, hasOutput: input.outputs.has(m.taskId) })),
      approvals: approvals.filter((a) => relatedIds.has(a.objectId)).map((a) => ({ approvalId: a.approvalId, objectType: a.objectType, objectId: a.objectId, outcome: a.outcome, actor: a.actor, at: a.at })),
    };
  });
}
