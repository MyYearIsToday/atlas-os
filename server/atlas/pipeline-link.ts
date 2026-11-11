import type { Dossier, PipelineLink } from "../../src/orchestrator/dossier-types";
import type { BusinessIntelligence } from "../../src/services/evidence/business-intelligence";

/** Read-only bridge from a finished dossier toward CRM, clients and the content stack. It creates nothing and contacts nobody. */
export function buildPipelineLink(b: BusinessIntelligence, d: Dossier): PipelineLink {
  const campaign = d.stages.campaign?.output as { content?: Array<Record<string, unknown>>; campaigns?: Array<Record<string, unknown>> } | null;
  const drafts = (Array.isArray(campaign?.content) ? campaign.content : []).slice(0, 8).map((item) => ({
    title: String(item?.campaign ?? item?.format ?? "Untitled draft").slice(0, 160),
    channel: String(item?.platform ?? "unspecified").slice(0, 80),
    approval: "Approval Required" as const,
  })).filter((item) => item.title.trim().length > 0);
  const names = (Array.isArray(campaign?.campaigns) ? campaign.campaigns : []).map((c) => String(c?.name ?? "")).filter(Boolean).slice(0, 4);
  return {
    scoutBusinessId: b.id,
    crm: {
      status: "suggested",
      stage: "Prospect",
      businessName: b.canonicalName,
      category: b.category ?? null,
      location: b.address ?? null,
      website: b.website ?? null,
      note: "Suggested from the completed Scout dossier. Not written to the CRM board, not contacted, and not given a deal value.",
    },
    client: { status: "not_created", reason: "A dossier does not make a business a client. That happens only after an operator marks a CRM lead won." },
    contentStack: {
      status: drafts.length ? "drafts_only" : "none",
      items: drafts,
      note: names.length ? `Drafts belong to: ${names.join(", ")}. Nothing is approved for use.` : "No campaign draft was recorded.",
    },
  };
}
