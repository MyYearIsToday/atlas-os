import type { ConfidenceLevel, EvidenceRecord } from "./evidence";

export function confidenceRank(level: ConfidenceLevel): number {
  return { VERIFIED: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 0 }[level];
}

export function confidenceForSource(source: EvidenceRecord["sourceType"]): ConfidenceLevel {
  switch (source) {
    case "client_provided": return "VERIFIED";
    case "official_website": return "HIGH";
    case "osm": return "MEDIUM";
    case "directory": return "MEDIUM";
    case "manual_observation": return "HIGH";
    case "authorized_connector": return "VERIFIED";
    case "public_business_page": return "MEDIUM";
    case "other_permitted_source": return "LOW";
    default: return "UNKNOWN";
  }
}
