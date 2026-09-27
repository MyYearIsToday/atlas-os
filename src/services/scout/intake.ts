export interface ScoutIntake { businessId?:string; discoveredBusiness:unknown; duplicateStatus:"NONE"|"POSSIBLE_DUPLICATE"|"HUMAN_REVIEW"; evidenceRefs:string[]; sourceRefs:string[]; }
export function intakeRequiresReview(input:ScoutIntake):boolean{return input.duplicateStatus!=="NONE";}
