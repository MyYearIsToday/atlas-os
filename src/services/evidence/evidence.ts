export type EvidenceSourceType =
  | "official_website"
  | "osm"
  | "directory"
  | "client_provided"
  | "authorized_connector"
  | "manual_observation"
  | "public_business_page"
  | "other_permitted_source";

export type EvidenceType =
  | "direct_observation"
  | "owner_provided"
  | "authorized_connector"
  | "structured_data"
  | "directory_record"
  | "osm_record"
  | "manual_field_observation"
  | "inference"
  | "conflict"
  | "unknown";

export type ConfidenceLevel = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type ObservabilityState = "OBSERVED_PRESENT" | "OBSERVED_ABSENT" | "NOT_OBSERVABLE" | "CONFLICTING";
export type VerificationStatus = "UNVERIFIED" | "HUMAN_VERIFIED" | "REJECTED";

export interface EvidenceRecord {
  evidenceId: string;
  businessId: string;
  field: string;
  value: unknown;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  observedAt: string;
  retrievedAt: string;
  evidenceType: EvidenceType;
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  collector: "scout_ai" | "human_scout" | "connector" | "website_http";
  notes?: string;
  expiresAt?: string;
  humanReviewRequired: boolean;
  observability: ObservabilityState;
}
