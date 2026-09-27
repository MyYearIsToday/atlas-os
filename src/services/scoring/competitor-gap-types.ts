import type { ConfidenceLevel, ObservabilityState } from "../evidence/evidence";

// Reuses the canonical confidence/observability model from Sprint 4A
// (src/services/evidence/evidence.ts) rather than redefining it — see
// DECISION_LOG.md, 2026-09-17, "duplicate confidence/observability types."
export type EvidenceConfidence = ConfidenceLevel;
export type { ObservabilityState };
export type GapDimension = "profile" | "category" | "reviews" | "review_replies" | "services" | "photos" | "website" | "conversion" | "local_trust" | "activity";
export type GapDirection = "target_ahead" | "target_behind" | "parity" | "unknown";
export type CompetitorStatus = "EXPLICIT" | "CANDIDATE" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";

export interface CompetitorReference { businessId:string; status:CompetitorStatus; category?:string; distanceMeters?:number; relevanceScore?:number; evidenceRefs:string[]; confidence:EvidenceConfidence; }
export interface CompetitorSet { id:string; targetBusinessId:string; competitors:CompetitorReference[]; selectionMethod:"scout"|"human"|"client"|"provider"; generatedAt:string; }
export interface CompetitorGap { id:string; targetBusinessId:string; competitorBusinessId:string; dimension:GapDimension; targetValue:number|null; competitorValue:number|null; normalizedGap:number|null; direction:GapDirection; evidenceRefs:string[]; confidence:EvidenceConfidence; observability:ObservabilityState; explanation:string; observedAt:string; formulaVersion:"competitor-gap-v1.0"; }
export interface BenchmarkDimension { dimension:GapDimension; targetScore:number|null; competitorMedian:number|null; competitorBest:number|null; gap:number|null; confidence:EvidenceConfidence; evidenceCoverage:number; }
export interface CompetitorBenchmark { id:string; targetBusinessId:string; competitorCount:number; benchmarkDimensions:BenchmarkDimension[]; overallGap:number|null; evidenceCoverage:number; generatedAt:string; version:"competitor-gap-v1.0"; }
