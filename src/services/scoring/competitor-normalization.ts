export type NumericNormalization = "bounded" | "logarithmic" | "binary" | "percentage";
export function normalizeBounded(value:number|null,min:number,max:number):number|null { if(value===null || !Number.isFinite(value)) return null; if(max<=min) throw new Error("Invalid normalization range"); return Math.max(0,Math.min(1,(value-min)/(max-min))); }
export function normalizeLogarithmic(value:number|null,cap=100):number|null { if(value===null || !Number.isFinite(value) || value<0) return null; return Math.log1p(Math.min(value,cap))/Math.log1p(cap); }
export function normalizeBinary(value:boolean|null):number|null { return value===null ? null : value ? 1 : 0; }
export function normalizePercentage(value:number|null):number|null { return normalizeBounded(value,0,100); }
export function compare(target:number|null,competitor:number|null):{gap:number|null; direction:"target_ahead"|"target_behind"|"parity"|"unknown"} { if(target===null || competitor===null) return {gap:null,direction:"unknown"}; const gap=target-competitor; return {gap,direction:Math.abs(gap)<.05?"parity":gap>0?"target_ahead":"target_behind"}; }
