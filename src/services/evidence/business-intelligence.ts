import type { EvidenceRecord } from "./evidence";

export interface BusinessIntelligence {
  id: string;
  canonicalName: string;
  aliases: string[];
  category?: string;
  categories: string[];
  businessType?: string;
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN" | "CONFLICT";
  address?: string;
  latitude?: number;
  longitude?: number;
  neighborhood?: string;
  serviceArea?: string[];
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  notes?: string;
  socialLinks: string[];
  /** Operator-supplied intake context (unverified; never treated as evidence). */
  contactName?: string;
  city?: string;
  country?: string;
  goals?: string[];
  relationship?: string;
  intakeSource?: string;
  googleProfileUrl?: string;
  hours?: Record<string, string>;
  services: string[];
  products: string[];
  sourceReferences: string[];
  evidenceReferences: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BusinessObservation {
  businessId: string;
  field: string;
  value: unknown;
  evidence: EvidenceRecord;
}
