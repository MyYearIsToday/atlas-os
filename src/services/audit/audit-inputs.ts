import type { MapSparkAudit, AuditFinding, AuditRecommendation, AuditQuickWin } from "./audit-types";
import type { MultimodalObservation } from "../multimodal-intelligence/service";
export interface AuditGeneratorInput { business:unknown; evidence:unknown[]; multimodalObservations?:MultimodalObservation[]; evidenceCoverage:number; visibilityScore:unknown; competitorGaps:unknown[]; competitorBenchmark:unknown|null; opportunityScore:unknown; recommendations:AuditRecommendation[]; quickWins:AuditQuickWin[]; generatedBy:string; methodologyVersion:string; }
export interface AuditGenerationResult { audit:MapSparkAudit; findings:AuditFinding[]; nextAction:MapSparkAudit["nextAction"]; }
