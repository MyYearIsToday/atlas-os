import type { AuditTrailEntry, FinancialTransaction } from "./finance-types";
export class OperationalLedger { private records=new Map<string,FinancialTransaction>(); private audit:AuditTrailEntry[]=[];
  post(t:FinancialTransaction,actorId:string):FinancialTransaction { if(t.status!=="POSTED")throw new Error("Only approved POSTED transactions may be posted"); if(this.records.has(t.transactionId))throw new Error("duplicate transaction"); this.records.set(t.transactionId,structuredClone(t)); this.audit.push({auditId:crypto.randomUUID(),entityType:"FinancialTransaction",entityId:t.transactionId,actorId,action:"POST",occurredAt:new Date().toISOString(),newValue:t,reason:"Initial posting",evidenceRefs:t.evidenceRefs}); return structuredClone(t); }
  reverse(originalId:string,reversal:FinancialTransaction,actorId:string):FinancialTransaction { const original=this.records.get(originalId);if(!original)throw new Error("original transaction not found");if(reversal.reversalOfTransactionId!==originalId)throw new Error("reversal reference mismatch");const posted=this.post(reversal,actorId);this.records.set(originalId,{...original,status:"REVERSED",updatedAt:new Date().toISOString()});return posted; }
  get(id:string):FinancialTransaction|undefined{return this.records.get(id)?structuredClone(this.records.get(id)!):undefined;}
  list():FinancialTransaction[]{return [...this.records.values()].map((t) => structuredClone(t));}
  auditTrail():AuditTrailEntry[]{return structuredClone(this.audit);}
}
