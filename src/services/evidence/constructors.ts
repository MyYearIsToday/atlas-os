import { confidenceForSource } from "./confidence";
import type { BusinessIntelligence } from "./business-intelligence";
import type { DiscoveryCandidate } from "./provider-interfaces";
import type {
  ConfidenceLevel,
  EvidenceRecord,
  EvidenceSourceType,
  EvidenceType,
  ObservabilityState,
  VerificationStatus,
} from "./evidence";

export interface RecordFactoryOptions {
  idFactory?: () => string;
  now?: () => Date;
}

const defaultRecordOptions: Required<RecordFactoryOptions> = {
  idFactory: () => crypto.randomUUID(),
  now: () => new Date(),
};

function recordOptions(options: RecordFactoryOptions = {}): Required<RecordFactoryOptions> {
  return { ...defaultRecordOptions, ...options };
}

function isoNow(options: Required<RecordFactoryOptions>): string {
  return options.now().toISOString();
}

function observabilityForValue(value: unknown): ObservabilityState {
  return value === null || value === undefined || value === "" ? "OBSERVED_ABSENT" : "OBSERVED_PRESENT";
}

export interface EvidenceInput {
  businessId: string;
  field: string;
  value: unknown;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  observedAt?: string;
  retrievedAt?: string;
  evidenceType: EvidenceType;
  confidence?: ConfidenceLevel;
  verificationStatus?: VerificationStatus;
  collector: EvidenceRecord["collector"];
  notes?: string;
  expiresAt?: string;
  humanReviewRequired?: boolean;
  observability?: ObservabilityState;
}

export function createEvidenceRecord(
  input: EvidenceInput,
  options: RecordFactoryOptions = {},
): EvidenceRecord {
  if (!input.businessId.trim()) throw new Error("Evidence requires a businessId");
  if (!input.field.trim()) throw new Error("Evidence requires a field");
  const resolved = recordOptions(options);
  const timestamp = isoNow(resolved);
  return {
    evidenceId: resolved.idFactory(),
    businessId: input.businessId,
    field: input.field,
    value: input.value,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    observedAt: input.observedAt ?? timestamp,
    retrievedAt: input.retrievedAt ?? timestamp,
    evidenceType: input.evidenceType,
    confidence: input.confidence ?? confidenceForSource(input.sourceType),
    verificationStatus: input.verificationStatus ?? "UNVERIFIED",
    collector: input.collector,
    notes: input.notes,
    expiresAt: input.expiresAt,
    humanReviewRequired: input.humanReviewRequired ?? false,
    observability: input.observability ?? observabilityForValue(input.value),
  };
}

export interface BusinessIntelligenceInput {
  id?: string;
  canonicalName: string;
  aliases?: string[];
  category?: string;
  categories?: string[];
  businessType?: string;
  status?: BusinessIntelligence["status"];
  address?: string;
  latitude?: number;
  longitude?: number;
  neighborhood?: string;
  serviceArea?: string[];
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  socialLinks?: string[];
  googleProfileUrl?: string;
  hours?: Record<string, string>;
  services?: string[];
  products?: string[];
  sourceReferences?: string[];
  evidenceReferences?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export function createBusinessIntelligence(
  input: BusinessIntelligenceInput,
  options: RecordFactoryOptions = {},
): BusinessIntelligence {
  if (!input.canonicalName.trim()) throw new Error("Business intelligence requires a canonicalName");
  const resolved = recordOptions(options);
  const timestamp = isoNow(resolved);
  return {
    id: input.id ?? resolved.idFactory(),
    canonicalName: input.canonicalName.trim(),
    aliases: input.aliases ?? [],
    category: input.category,
    categories: input.categories ?? (input.category ? [input.category] : []),
    businessType: input.businessType,
    status: input.status ?? "UNKNOWN",
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    neighborhood: input.neighborhood,
    serviceArea: input.serviceArea,
    phone: input.phone,
    whatsapp: input.whatsapp,
    email: input.email,
    website: input.website,
    socialLinks: input.socialLinks ?? [],
    googleProfileUrl: input.googleProfileUrl,
    hours: input.hours,
    services: input.services ?? [],
    products: input.products ?? [],
    sourceReferences: input.sourceReferences ?? [],
    evidenceReferences: input.evidenceReferences ?? [],
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

export function businessIntelligenceFromCandidate(
  candidate: DiscoveryCandidate,
  options: RecordFactoryOptions & { id?: string } = {},
): BusinessIntelligence {
  if (!candidate.externalId.trim()) throw new Error("Discovery candidate requires an externalId");
  const resolvedId = options.id ?? `${candidate.source}:${candidate.externalId}`;
  return createBusinessIntelligence(
    {
      id: resolvedId,
      canonicalName: candidate.name,
      category: candidate.category,
      categories: candidate.category ? [candidate.category] : [],
      address: candidate.address,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      status: "UNKNOWN",
      sourceReferences: [candidate.sourceUrl ?? candidate.source],
    },
    options,
  );
}

export function evidenceForCandidate(
  business: BusinessIntelligence,
  candidate: DiscoveryCandidate,
  options: RecordFactoryOptions = {},
): EvidenceRecord[] {
  const common = {
    businessId: business.id,
    sourceType: "osm" as const,
    sourceUrl: candidate.sourceUrl,
    evidenceType: "osm_record" as const,
    collector: "scout_ai" as const,
  };
  const evidence: EvidenceRecord[] = [
    createEvidenceRecord({ ...common, field: "canonicalName", value: candidate.name }, options),
  ];
  if (candidate.category) {
    evidence.push(createEvidenceRecord({ ...common, field: "category", value: candidate.category }, options));
  }
  if (candidate.address) {
    evidence.push(createEvidenceRecord({ ...common, field: "address", value: candidate.address }, options));
  }
  if (candidate.latitude !== undefined && candidate.longitude !== undefined) {
    evidence.push(
      createEvidenceRecord(
        {
          ...common,
          field: "coordinates",
          value: { latitude: candidate.latitude, longitude: candidate.longitude },
        },
        options,
      ),
    );
  }
  return evidence;
}