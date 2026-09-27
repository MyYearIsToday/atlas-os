import type { MapSparkAudit } from "./audit-types";
export interface AuditRenderer<TArtifact> { render(audit:MapSparkAudit):Promise<TArtifact>; }
export interface AuditPresentationModel { title:string; sections:Array<{key:string;title:string;content:Record<string,unknown>}>; evidenceCoverage:number; confidence:unknown; approvalStatus:string; }
export function toPresentationModel(audit:MapSparkAudit):AuditPresentationModel { return {title:`MapSpark Audit — ${audit.businessId}`,sections:audit.sections.map(s=>({key:s.key,title:s.title,content:s.content})),evidenceCoverage:audit.evidenceCoverage,confidence:audit.confidence,approvalStatus:audit.approvalStatus}; }
