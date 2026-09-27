export const OPPORTUNITY_SCORE_VERSION="opportunity-v1.0" as const;
export const OPPORTUNITY_WEIGHTS={visibilityWeakness:20,competitiveGap:20,commercialValue:15,conversionReadiness:15,demandIntent:10,evidenceQuality:10,executionFeasibility:10} as const;
export const OPPORTUNITY_MAX=Object.values(OPPORTUNITY_WEIGHTS).reduce((a,b)=>a+b,0);
if(OPPORTUNITY_MAX!==100) throw new Error("Opportunity weights must total 100");
