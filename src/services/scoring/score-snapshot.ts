export type ScoreType="visibility"|"opportunity"|"competitor_benchmark";
export interface ScoreSnapshot { id:string; businessId:string; scoreType:ScoreType; version:string; score:number|null; confidence:string; evidenceCoverage:number; generatedAt:string; breakdown:Record<string,unknown>; }
export function createSnapshot(input:Omit<ScoreSnapshot,"id">):ScoreSnapshot { return {id:crypto.randomUUID(),...input}; }
