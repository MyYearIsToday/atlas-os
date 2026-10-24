import { createHash } from "node:crypto";
import type { BusinessIntelligence } from "../../src/services/evidence/business-intelligence";
import type { Deliverable, Dossier, DossierExecution, PerformanceRecord, StrategyDecision } from "../../src/orchestrator/dossier-types";

/**
 * Connected strategy execution, derived from what the dossier already holds (growth recommendations, campaign plan, competitor and
 * market output, missions). Nothing here calls a model or the network, and nothing is invented: a missing value is "unknown".
 */

type Rec = Record<string, unknown>;
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const refsOf = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const out = (d: Dossier, stage: "growth" | "campaign" | "competitors" | "market" | "profile" | "swot") => (d.stages[stage]?.status === "completed" ? ((d.stages[stage].output ?? {}) as Rec) : null);
const lc = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export const strategyKey = (title: string) => `st_${createHash("sha256").update(lc(title)).digest("hex").slice(0, 10)}`;
export const exec = (d: Dossier): DossierExecution => (d.execution ??= { strategies: [], deliverables: [], performance: [] });

export interface StrategyView { key: string; title: string; area: string; priority: string; rationale: string; basis: string; kind: string; sourceRefs: string[]; quote?: string; decision: "proposed" | "approved" | "declined"; decidedBy?: string; decidedAt?: string; campaigns: string[] }

/** Growth recommendations with their decision and the campaigns that say they address them. */
export function strategies(d: Dossier): StrategyView[] {
  const g = out(d, "growth"); const c = out(d, "campaign");
  const camps = arr(c?.campaigns);
  return arr(g?.recommendations).map((r) => {
    const title = str(r.title); const key = strategyKey(title); const dec = exec(d).strategies.find((s) => s.key === key);
    return { key, title, area: str(r.area), priority: str(r.priority), rationale: str(r.rationale), basis: str(r.basis) || "hypothesis", kind: str(r.kind), sourceRefs: refsOf(r.sourceRefs), ...(r.quote ? { quote: str(r.quote) } : {}),
      decision: (dec?.decision ?? "proposed") as StrategyView["decision"], ...(dec ? { decidedBy: dec.decidedBy, decidedAt: dec.decidedAt } : {}),
      campaigns: camps.filter((k) => refsOf(k.addresses).some((a) => lc(a) === lc(title))).map((k) => str(k.name)) };
  }).filter((s) => s.title);
}

// ---------------------------------------------------------------- comparison, gaps, benchmark

interface Cell { text: string; basis: "verified" | "inference" | "hypothesis" | "unknown" | "observed"; sourceRefs: string[] }
const cell = (v: unknown): Cell => { const o = (v ?? null) as Rec | null; return o && str(o.text) ? { text: str(o.text), basis: (str(o.basis) as Cell["basis"]) || "hypothesis", sourceRefs: refsOf(o.sourceRefs) } : { text: "not established from the sources read", basis: "unknown", sourceRefs: [] }; };
const counted = (list: unknown) => arr(list);

export function buildComparison(b: Pick<BusinessIntelligence, "canonicalName">, d: Dossier) {
  const comp = out(d, "competitors"); const prof = out(d, "profile"); const market = out(d, "market");
  const insp = d.inspection;
  const mine = {
    name: b.canonicalName,
    positioning: prof ? { text: str(prof.brandNotes) || "not established", basis: "hypothesis", sourceRefs: [] } as Cell : cell(null),
    offerings: prof ? ((prof.productsServices as unknown[]) ?? []).map(String) : [],
    pricing: cell(null),
    digitalPresence: { text: `${(insp?.website?.pages ?? []).filter((p) => p.status === "read").length} website page(s) read; ${(insp?.social ?? []).filter((o) => o.access === "full_page" || o.access === "meta_only").length} of ${(insp?.social ?? []).length} social profile(s) readable`, basis: "observed", sourceRefs: [] } as Cell,
    strengths: counted(out(d, "swot")?.strengths).length, weaknesses: counted(out(d, "swot")?.weaknesses).length,
    verifiedClaims: countVerified(out(d, "swot")) + countVerified(prof),
  };
  const rows = arr(comp?.shortlist).map((c) => ({
    name: str(c.name), url: str(c.url), type: str(c.type), whySelected: str(c.whySelected), sourceRefs: refsOf(c.sourceRefs),
    positioning: cell(c.positioning), offerings: refsOf(c.offerings), pricing: cell(c.pricing), digitalPresence: cell(c.digitalPresence), reputation: cell(c.reputation),
    strengths: counted(c.strengths).length, weaknesses: counted(c.weaknesses).length,
    verifiedClaims: [c.positioning, c.pricing, c.digitalPresence, c.reputation, ...arr(c.strengths), ...arr(c.weaknesses)].filter((x) => (x as Rec | null)?.basis === "verified").length,
    evidence: d.sources.filter((s) => s.role === "competitor" && refsOf(c.sourceRefs).includes(s.id)).map((s) => ({ id: s.id, url: s.url, read: s.check?.status === "fetched" })),
  }));
  const gaps = [
    ...arr(comp?.whitespace).map((i) => ({ kind: "whitespace", ...cell(i) })),
    ...arr(market?.opportunities).map((o) => ({ kind: "market opportunity", text: str(o.title) + (str(o.rationale) ? `: ${str(o.rationale)}` : ""), basis: (str(o.basis) as Cell["basis"]) || "hypothesis", sourceRefs: refsOf(o.sourceRefs) })),
    ...refsOf(comp?.gaps).map((t) => ({ kind: "not established", text: t, basis: "unknown" as const, sourceRefs: [] as string[] })),
  ];
  const benchmark = rows.length ? {
    method: "Counts of what Atlas actually recorded per business (offerings listed, strengths/weaknesses identified, claims verified against page text). These are not performance scores.",
    metrics: [{ metric: "offerings listed", you: mine.offerings.length, competitors: rows.map((r) => ({ name: r.name, value: r.offerings.length })) },
      { metric: "claims verified against page text", you: mine.verifiedClaims, competitors: rows.map((r) => ({ name: r.name, value: r.verifiedClaims })) }],
    unavailable: "Follower counts, engagement, traffic, ad spend and revenue were not collected: public pages rarely expose them and Atlas does not estimate them.",
  } : null;
  return { available: !!comp, you: mine, competitors: rows, gaps, benchmark, limits: refsOf(comp?.gaps), conflicts: refsOf(comp?.conflicts), method: str(comp?.method) };
}
const countVerified = (o: Rec | null) => (o ? JSON.stringify(o).split('"basis":"verified"').length - 1 : 0);

// ---------------------------------------------------------------- traceability

export interface MissionLike { taskId: string; status: string; approvalRequired?: string; title?: string }

/** For every recommendation: its evidence, decision, the campaigns/content that address it, and the missions and approvals created from it. Gaps are listed, never papered over. */
export function buildTrace(d: Dossier, missions: MissionLike[]) {
  const src = (id: string) => { const s = d.sources.find((u) => u.id === id); return s ? { id, url: s.url, title: s.title, role: s.role ?? "business", read: s.check?.status === "fetched" } : { id, url: "", title: "unknown source", role: "business", read: false }; };
  const camps = arr(out(d, "campaign")?.campaigns); const content = arr(out(d, "campaign")?.content);
  const mission = (taskId: string) => { const m = missions.find((x) => x.taskId === taskId); return { taskId, status: m?.status ?? "unknown", approval: m?.approvalRequired ?? "unknown" }; };
  const sv = strategies(d); const gaps: string[] = [];
  const chain = sv.map((s) => {
    if (!s.sourceRefs.length) gaps.push(`Recommendation “${s.title}” cites no source: it is a hypothesis.`);
    const campaigns = camps.filter((k) => s.campaigns.includes(str(k.name))).map((k) => ({
      name: str(k.name), sourceRefs: refsOf(k.sourceRefs),
      content: content.map((c, i) => ({ c, i })).filter(({ c }) => lc(str(c.campaign)) === lc(str(k.name))).map(({ c, i }) => ({ index: i, platform: str(c.platform), format: str(c.format), status: str(c.status) })),
    }));
    return { strategy: { key: s.key, title: s.title, decision: s.decision, basis: s.basis, quote: s.quote }, evidence: s.sourceRefs.map(src), campaigns,
      deliverables: exec(d).deliverables.filter((x) => x.strategyKey === s.key).map((x) => ({ id: x.id, kind: x.kind, title: x.title, campaign: x.campaign, contentIndex: x.contentIndex, sourceRefs: x.sourceRefs, ...mission(x.taskId) })) };
  });
  for (const k of camps) if (!sv.some((s) => s.campaigns.includes(str(k.name)))) gaps.push(`Campaign “${str(k.name)}” does not name a recommendation it addresses: it has no strategy link.`);
  for (const [i, c] of content.entries()) if (!camps.some((k) => lc(str(k.name)) === lc(str(c.campaign)))) gaps.push(`Content draft #${i + 1} (${str(c.platform)}) is not tied to a campaign.`);
  return { chain, gaps };
}

// ---------------------------------------------------------------- performance learning foundation

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** What the operator-entered results do and do not show. No causal claims, nothing when data is absent. */
export function learningSummary(d: Dossier) {
  const rec = exec(d).performance; const camps = new Map<string, PerformanceRecord[]>();
  for (const r of rec) camps.set(r.campaign, [...(camps.get(r.campaign) ?? []), r]);
  const campaigns = [...camps].map(([name, list]) => {
    const byMetric = new Map<string, PerformanceRecord[]>();
    for (const r of list) { const k = `${r.metric}|${r.unit ?? ""}`; byMetric.set(k, [...(byMetric.get(k) ?? []), r].sort((a, b) => a.period.from.localeCompare(b.period.from))); }
    return { campaign: name, metrics: [...byMetric.values()].map((l) => { const last = l[l.length - 1], prev = l[l.length - 2];
      const m: { metric: string; unit: string | null; points: number; latest: number; period: { from: string; to: string }; previous?: number; change?: number; note?: string } = { metric: last.metric, unit: last.unit ?? null, points: l.length, latest: last.value, period: last.period };
      if (prev) { m.previous = prev.value; m.change = last.value - prev.value; } else m.note = "one data point: no comparison possible";
      return m; }) };
  });
  return { records: rec.length, campaigns, note: rec.length ? "Figures are exactly what the operator entered. Atlas does not attribute a change to any action: other factors move results too." : "No results have been recorded. Atlas does not estimate or import performance data; enter real results after a campaign has run." };
}

// ---------------------------------------------------------------- actions (all operator-initiated, bounded, internal)

export interface ExecDeps { createMission(m: { title: string; description: string; assignedAI: "builder"; clientId: string }): Promise<{ taskId: string }>; now(): string }
const MAX_DELIVERABLES = 12, MAX_PERFORMANCE = 200;
type Res = { status: number; body: unknown };
const bad = (error: string, status = 400): Res => ({ status, body: { ok: false, error } });
const clip = (s: unknown, n: number) => str(s).replace(/\s+/g, " ").trim().slice(0, n);

export async function executeAction(d: Dossier, b: BusinessIntelligence, body: Rec, deps: ExecDeps): Promise<Res> {
  const actor = typeof body.actor === "string" && /^[\w.:@ -]{1,60}$/.test(body.actor) ? body.actor : "operator";
  const x = exec(d); const action = str(body.action);
  if (action === "strategy_decide") {
    const s = strategies(d).find((v) => v.key === body.strategyKey);
    if (!s) return bad("unknown_strategy", 404);
    if (body.decision !== "approved" && body.decision !== "declined") return bad("invalid_decision");
    x.strategies = x.strategies.filter((v) => v.key !== s.key);
    x.strategies.push({ key: s.key, title: s.title, decision: body.decision, decidedBy: actor, decidedAt: deps.now(), ...(clip(body.reason, 300) ? { reason: clip(body.reason, 300) } : {}) } satisfies StrategyDecision);
    return { status: 200, body: { ok: true, strategyKey: s.key, decision: body.decision } };
  }
  if (action === "deliverable_create") {
    const kind = str(body.kind) as Deliverable["kind"];
    if (!["campaign_brief", "content_draft", "creative_asset"].includes(kind)) return bad("invalid_kind");
    const s = strategies(d).find((v) => v.key === body.strategyKey);
    if (!s) return bad("unknown_strategy", 404);
    if (s.decision !== "approved") return bad("strategy_not_approved", 409);
    const camps = arr(out(d, "campaign")?.campaigns); const content = arr(out(d, "campaign")?.content);
    const camp = camps.find((k) => s.campaigns.includes(str(k.name)) && lc(str(k.name)) === lc(str(body.campaign)));
    if (!camp) return bad("campaign_does_not_address_strategy", 409);
    let idx: number | undefined; let item: Rec | undefined;
    if (kind !== "campaign_brief") {
      idx = Number(body.contentIndex);
      item = Number.isInteger(idx) ? content[idx] : undefined;
      if (!item || lc(str(item.campaign)) !== lc(str(camp.name))) return bad("unknown_content", 404);
      if (kind === "creative_asset" && !str(item.creativeBrief)) return bad("no_creative_brief", 409);
    }
    const dedupe = `${s.key}|${kind}|${lc(str(camp.name))}|${idx ?? ""}`;
    const existing = x.deliverables.find((v) => `${v.strategyKey}|${v.kind}|${lc(v.campaign ?? "")}|${v.contentIndex ?? ""}` === dedupe);
    if (existing) return { status: 200, body: { ok: true, already: true, deliverable: existing } };
    if (x.deliverables.length >= MAX_DELIVERABLES) return bad("too_many_deliverables", 409);
    const refs = [...new Set([...s.sourceRefs, ...refsOf(camp.sourceRefs)])];
    const cites = refs.map((id) => { const u = d.sources.find((v) => v.id === id); return u ? `${id} ${u.url}` : id; }).join("; ") || "none (hypothesis)";
    const label = { campaign_brief: "Campaign brief", content_draft: "Content draft", creative_asset: "Creative asset brief" }[kind];
    const detail = kind === "campaign_brief" ? `Campaign: ${str(camp.name)}\nObjective: ${str(camp.objective)}\nAudience: ${str(camp.audience)}\nMessage: ${str(camp.message)}\nCall to action: ${str(camp.callToAction)}\nChannels: ${refsOf(camp.channels).join(", ")}\nKPIs (baselines unknown unless stated): ${arr(camp.kpis).map((k) => `${str(k.metric)} [${str(k.baseline)}]`).join("; ")}`
      : kind === "content_draft" ? `Platform: ${str(item!.platform)} (${str(item!.format)})\nDraft to refine:\n${str(item!.draft)}\nCall to action: ${str(item!.callToAction)}`
      : `Platform: ${str(item!.platform)}\nCreative brief:\n${str(item!.creativeBrief)}\nRights: no image or brand asset may be used without the owner's permission.`;
    const title = `${label}: ${kind === "campaign_brief" ? str(camp.name) : `${str(camp.name)} · ${str(item!.platform)}`} — ${b.canonicalName}`;
    const task = await deps.createMission({ title, clientId: b.id, assignedAI: "builder", description:
      `INTERNAL DRAFT ONLY. Nothing may be published, sent, posted, booked or spent; every output returns to the operator for approval.\nStrategy (${s.key}): ${s.title}\nWhy: ${s.rationale}\nEvidence: ${cites}\n\n${detail}\n\n(Created by ${actor} from an approved strategy in the dossier for business ${b.id}. Unverified claims stay hypotheses; do not invent offers, prices, awards or testimonials.)` });
    const dv: Deliverable = { id: `D${x.deliverables.length + 1}`, kind, strategyKey: s.key, strategyTitle: s.title, campaign: str(camp.name), ...(idx !== undefined ? { contentIndex: idx } : {}), taskId: task.taskId, title, sourceRefs: refs, createdAt: deps.now(), createdBy: actor };
    x.deliverables.push(dv);
    return { status: 200, body: { ok: true, deliverable: dv } };
  }
  if (action === "performance_record") {
    const campaign = camps(d).find((n) => lc(n) === lc(str(body.campaign)));
    if (!campaign) return bad("unknown_campaign", 404);
    const metric = clip(body.metric, 80); const value = typeof body.value === "number" ? body.value : Number(body.value);
    const from = str(body.from), to = str(body.to);
    if (!metric) return bad("invalid_metric");
    if (!Number.isFinite(value) || value < 0 || value > 1e12 || body.value === "" || body.value === null) return bad("invalid_value");
    if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to || to > deps.now().slice(0, 10)) return bad("invalid_period");
    const dvId = typeof body.deliverableId === "string" ? body.deliverableId : undefined;
    if (dvId && !x.deliverables.some((v) => v.id === dvId)) return bad("unknown_deliverable", 404);
    if (x.performance.length >= MAX_PERFORMANCE) return bad("too_many_records", 409);
    const rec: PerformanceRecord = { id: `P${x.performance.length + 1}`, campaign, ...(dvId ? { deliverableId: dvId } : {}), metric, value, ...(clip(body.unit, 20) ? { unit: clip(body.unit, 20) } : {}), period: { from, to }, origin: "operator_entered", recordedBy: actor, recordedAt: deps.now(), ...(clip(body.note, 300) ? { note: clip(body.note, 300) } : {}) };
    x.performance.push(rec);
    return { status: 200, body: { ok: true, record: rec } };
  }
  return bad("unknown_action");
}
const camps = (d: Dossier) => arr(out(d, "campaign")?.campaigns).map((k) => str(k.name)).filter(Boolean);
