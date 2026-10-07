import { randomUUID } from "node:crypto";
import type { AIProvider } from "../../workforce/provider-interface";
import type { AIJobRequest } from "../../workforce/provider-types";
import type { ConfidenceLevel, VerificationStatus } from "../evidence/evidence";
import { validateTarget } from "../evidence/website-collector";

export type MultimodalSourceType = "image" | "video" | "audio" | "document" | "web";
export type VisualObservationCategory = "branding" | "storefront" | "menu" | "promotion" | "product_service" | "contact" | "other";

/** Model observations are deliberately separate from EvidenceRecord and never enter verification/scoring by themselves. */
export interface MultimodalObservation {
  observationId: string;
  businessId: string;
  observation: string;
  category: VisualObservationCategory;
  sourceType: MultimodalSourceType;
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  sourceReference: string;
  createdAt: string;
}

export interface MultimodalMediaInput {
  businessId: string;
  sourceType: MultimodalSourceType;
  sourceReference: string;
  mimeType: string;
  dataUrl: string;
  label?: string;
}

export type MultimodalAnalysisResult =
  | { status: "ANALYZED"; observations: MultimodalObservation[] }
  | { status: "UNSUPPORTED_MEDIA" | "INVALID_INPUT" | "PROVIDER_UNAVAILABLE" | "MALFORMED_OUTPUT"; observations: [] };

export interface MultimodalIntelligence {
  analyze(input: MultimodalMediaInput): Promise<MultimodalAnalysisResult>;
}

export interface MultimodalIntelligenceOptions {
  now?: () => Date;
  idFactory?: () => string;
}

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_DATA_URL_CHARS = 180_000;
const MAX_MODEL_OUTPUT_CHARS = 12_000;
const CATEGORIES = new Set<VisualObservationCategory>(["branding", "storefront", "menu", "promotion", "product_service", "contact", "other"]);
const CONFIDENCE = new Set<ConfidenceLevel>(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
const SENSITIVE_QUERY_KEY = /(token|auth|key|secret|signature|(^|_)sig(nature)?($|_)|password|credential)/i;

function safeSourceReference(value: string): string | null {
  try {
    const validated = validateTarget(value);
    if (!validated.ok) return null;
    const url = validated.url;
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parseModelOutput(text: string): Array<{ observation: string; category: VisualObservationCategory; confidence: ConfidenceLevel }> | null {
  if (!text || text.length > MAX_MODEL_OUTPUT_CHARS) return null;
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try { value = JSON.parse(json); } catch { return null; }
  if (!value || typeof value !== "object" || !Array.isArray((value as { observations?: unknown }).observations)) return null;
  const items = (value as { observations: unknown[] }).observations;
  if (items.length > 8) return null;
  const parsed: Array<{ observation: string; category: VisualObservationCategory; confidence: ConfidenceLevel }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.observation !== "string" || record.observation.trim().length < 4 || record.observation.length > 500) return null;
    parsed.push({
      observation: record.observation.trim(),
      category: CATEGORIES.has(record.category as VisualObservationCategory) ? record.category as VisualObservationCategory : "other",
      confidence: CONFIDENCE.has(record.confidence as ConfidenceLevel) ? record.confidence as ConfidenceLevel : "UNKNOWN",
    });
  }
  return parsed;
}

/**
 * Small Atlas adapter over the existing AIProvider seam. The provider must be the
 * existing workforce provider; image parts then flow through its established
 * media router, capability filtering, executor, and server-side provider keys.
 */
export class MultimodalIntelligenceService implements MultimodalIntelligence {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly provider: AIProvider, options: MultimodalIntelligenceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async analyze(input: MultimodalMediaInput): Promise<MultimodalAnalysisResult> {
    if (!input || input.sourceType !== "image") return { status: "UNSUPPORTED_MEDIA", observations: [] };
    if (typeof input.businessId !== "string" || !input.businessId || typeof input.sourceReference !== "string" || typeof input.mimeType !== "string" || typeof input.dataUrl !== "string" || input.dataUrl.length > MAX_DATA_URL_CHARS) {
      return { status: "INVALID_INPUT", observations: [] };
    }
    const sourceReference = safeSourceReference(input.sourceReference);
    const mimeType = input.mimeType.toLowerCase().split(";")[0].trim();
    const dataMatch = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+=*)$/i.exec(input.dataUrl);
    if (!sourceReference || !IMAGE_MIME_TYPES.has(mimeType) || !dataMatch || dataMatch[1].toLowerCase() !== mimeType) {
      return { status: "INVALID_INPUT", observations: [] };
    }
    if (this.provider.id !== "workforce") return { status: "PROVIDER_UNAVAILABLE", observations: [] };

    const request: AIJobRequest = {
      workerRole: "analyst",
      task: "Inspect this publicly collected business image. Return JSON only as {\"observations\":[{\"observation\":\"...\",\"category\":\"branding|storefront|menu|promotion|product_service|contact|other\",\"confidence\":\"HIGH|MEDIUM|LOW|UNKNOWN\"}]}. Describe only visible content; do not infer current business facts or verification.",
      priority: 2,
      confidenceTarget: 0.5,
      budgetLimitUsd: 0.1,
      maxTokens: 700,
      temperature: 0.1,
      timeoutMs: 30_000,
      lineageId: `atlas-multimodal:${input.businessId}`,
      taskType: "image",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Business context: ${input.businessId}. Image label: ${(typeof input.label === "string" ? input.label : "public website image").slice(0, 180)}. Record visible details as observations only.` },
          { type: "image_url", image_url: { url: input.dataUrl } },
        ],
      }],
    };

    try {
      const result = await this.provider.execute(request);
      if (result.failed) return { status: "PROVIDER_UNAVAILABLE", observations: [] };
      const parsed = parseModelOutput(result.text);
      if (!parsed) return { status: "MALFORMED_OUTPUT", observations: [] };
      const createdAt = this.now().toISOString();
      return {
        status: "ANALYZED",
        observations: parsed.map((item) => ({
          observationId: this.idFactory(),
          businessId: input.businessId,
          observation: item.observation,
          category: item.category,
          sourceType: "image",
          confidence: item.confidence,
          verificationStatus: "UNVERIFIED" satisfies VerificationStatus,
          sourceReference,
          createdAt,
        })),
      };
    } catch {
      // Provider errors can include request details. Return a fixed code rather than echoing them.
      return { status: "PROVIDER_UNAVAILABLE", observations: [] };
    }
  }
}
