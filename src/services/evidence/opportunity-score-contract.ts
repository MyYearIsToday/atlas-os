export interface OpportunityScoreInputs {
  customerIntent: number; businessValue: number; profileWeakness: number; competitorGap: number;
  publicContact: number; whatsappReadiness: number; ownerAccessibility: number; activity: number;
  routeEfficiency: number; dataConfidence: number;
}
export const opportunityScoreWeights = {
  customerIntent: 20, businessValue: 15, profileWeakness: 15, competitorGap: 15,
  publicContact: 10, whatsappReadiness: 10, ownerAccessibility: 5, activity: 5,
  routeEfficiency: 3, dataConfidence: 2
} as const;
