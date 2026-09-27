import type { ConfidenceLevel, ObservabilityState } from "../evidence/evidence";

// Reuses the canonical confidence/observability model from Sprint 4A rather
// than redefining it — see DECISION_LOG.md, 2026-09-17.
export type OpportunityConfidence = ConfidenceLevel;
export type OpportunityState = ObservabilityState;
export interface OpportunityScoreComponent { key:string; rawValue:number|null; maxValue:number; normalizedValue:number|null; weight:number; weightedContribution:number|null; evidenceRefs:string[]; confidence:OpportunityConfidence; observability:OpportunityState; explanation:string; }
export interface Opportunity { id:string; dimension:string; title:string; description:string; impact:"low"|"medium"|"high"; effort:"low"|"medium"|"high"; priority:number; evidenceRefs:string[]; confidence:OpportunityConfidence; recommendedAction:string; }
export interface OpportunityBlocker { id:string; title:string; reason:string; evidenceRefs:string[]; confidence:OpportunityConfidence; }
export interface OpportunityQuickWin { id:string; opportunityId:string; title:string; action:string; impact:"low"|"medium"|"high"; effort:"low"|"medium"|"high"; priority:number; evidenceRefs:string[]; confidence:OpportunityConfidence; }
export interface OpportunityScoreConfidence { overall:OpportunityConfidence; numeric:number; evidenceCoverage:number; freshnessScore:number; sourceReliabilityScore:number; conflictPenalty:number; humanVerificationScore:number; competitorCoverage:number; explanation:string; }
export interface OpportunityScore { id:string; version:"opportunity-v1.0"; businessId:string; overallScore:number|null; components:OpportunityScoreComponent[]; confidence:OpportunityScoreConfidence; evidenceCoverage:number; keyOpportunities:Opportunity[]; blockers:OpportunityBlocker[]; quickWins:OpportunityQuickWin[]; evidenceRefs:string[]; generatedAt:string; }
