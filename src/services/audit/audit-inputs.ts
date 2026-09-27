import type { MapSparkAudit, AuditFinding, AuditRecommendation, AuditQuickWin } from "./audit-types";
export interface AuditGeneratorInput { business:unknown; evidence:unknown[]; evidenceCoverage:number; visibilityScore:unknown; competitorGaps:unknown[]; competitorBenchmark:unknown|null; opportunityScore:unknown; recommendations:AuditRecommendation[]; quickWins:AuditQuickWin[]; generatedBy:string; methodologyVersion:string; }
export interface AuditGenerationResult { audit:MapSparkAudit; findings:AuditFinding[]; nextAction:MapSparkAudit["nextAction"]; }
