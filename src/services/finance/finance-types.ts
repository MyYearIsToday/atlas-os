export type Currency="GHS"|"USD"|"EUR"|"GBP"|string;
export type TransactionType="REVENUE"|"EXPENSE"|"REFUND"|"TRANSFER"|"INVESTMENT"|"OWNER_CONTRIBUTION"|"OWNER_WITHDRAWAL"|"ADJUSTMENT";
export type Direction="INFLOW"|"OUTFLOW"|"INTERNAL";
export type TransactionStatus="DRAFT"|"PENDING_APPROVAL"|"APPROVED"|"POSTED"|"RECONCILED"|"VOIDED"|"REVERSED";
export type ProductId="MapSpark"|"ContentSpark"|"LeadSpark"|"TradeSpark"|"Atlas_Shared"|string;
export type ApprovalStatus="NOT_REQUIRED"|"PENDING"|"APPROVED"|"REJECTED"|"CEO_ONLY";
export type VerificationStatus="VERIFIED"|"PARTIAL"|"UNVERIFIED"|"CONFLICT";
export interface Money { minorUnits:bigint; currency:Currency; scale:number; }
export interface MoneyConversion { original:Money; rate:string; converted:Money; rateSource:string; rateTimestamp:string; }
export interface FinancialEvidence { evidenceId:string; source:string; sourceUrl?:string; reference?:string; observedAt?:string; confidence:"VERIFIED"|"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"; verificationStatus:VerificationStatus; }
export interface Account { accountId:string; code:string; name:string; type:"ASSET"|"LIABILITY"|"EQUITY"|"REVENUE"|"DIRECT_COST"|"OPERATING_EXPENSE"|"TRADING"; parentAccountId?:string; productId?:ProductId; active:boolean; }
export interface JournalLine { accountId:string; amount:Money; debit:boolean; productId?:ProductId; clientId?:string; missionId?:string; }
export interface JournalEntry { journalEntryId:string; transactionId:string; lines:JournalLine[]; postedAt?:string; }
export interface FinancialTransaction { transactionId:string; transactionType:TransactionType; transactionDate:string; recordedAt:string; amount:Money; conversion?:MoneyConversion; direction:Direction; status:TransactionStatus; category:string; subcategory?:string; productId?:ProductId; clientId?:string; missionId?:string; employeeId?:string; vendor?:string; paymentMethod?:string; accountSource?:string; accountDestination?:string; description:string; reference?:string; evidenceRefs:string[]; verificationStatus:VerificationStatus; approvalStatus:ApprovalStatus; createdBy:string; updatedAt:string; notes?:string; reversalOfTransactionId?:string; journalEntry?:JournalEntry; }
export interface RecurringExpense { recurringExpenseId:string; vendor:string; amount:Money; frequency:"DAILY"|"WEEKLY"|"MONTHLY"|"QUARTERLY"|"YEARLY"; startDate:string; endDate?:string; category:string; productAllocation?:AllocationRule; nextDueDate:string; active:boolean; evidenceRefs:string[]; }
export interface Budget { budgetId:string; period:{start:string;end:string}; category:string; productId?:ProductId; plannedAmount:Money; approvalStatus:ApprovalStatus; }
export interface AllocationRule { method:"EQUAL"|"REVENUE_BASED"|"USAGE_BASED"|"MANUAL"; methodologyVersion:string; period:{start:string;end:string}; sourceDataRefs:string[]; approvalStatus:ApprovalStatus; }
export interface ReconciliationRecord { reconciliationId:string; transactionId:string; externalReference?:string; externalAmount?:Money; status:"UNMATCHED"|"MATCHED"|"PARTIAL"|"CONFLICT"|"RECONCILED"; evidenceRefs:string[]; notes?:string; }
export interface FinancialSnapshot { snapshotId:string; period:{start:string;end:string;timezone:string}; methodologyVersion:string; generatedAt:string; generatedBy:string; transactionCutoff:string; metrics:Record<string,unknown>; evidenceCoverage:number; confidence:"VERIFIED"|"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"; limitations:string[]; }
export interface AuditTrailEntry { auditId:string; entityType:string; entityId:string; actorId:string; action:string; occurredAt:string; oldValue?:unknown; newValue?:unknown; reason:string; evidenceRefs:string[]; }
export interface FinancialReportPeriod { start:string; end:string; timezone:string; currency:Currency; includedStatuses:TransactionStatus[]; }
export interface ProfitLossReport { period:FinancialReportPeriod; revenue:Money; directCosts:Money; grossProfit:Money; operatingExpenses:Money; operatingResult:Money; limitations:string[]; }
export interface CashFlowReport { period:FinancialReportPeriod; openingCash:Money; inflows:Money; outflows:Money; netMovement:Money; closingCash:Money; limitations:string[]; }
export interface ClientProfitability { clientId:string; period:FinancialReportPeriod; revenue:Money; directCost:Money; contribution:Money; contributionMarginPercent:number|null; allocatedOperatingProfit?:Money; limitations:string[]; }
export interface AIUsageCost { usageId:string; provider:string; modelOrTool:string; usageQuantity:number; estimatedCost?:Money; actualCost?:Money; missionId?:string; productId?:ProductId; clientId?:string; employeeId?:string; timestamp:string; evidenceRefs:string[]; verificationStatus:VerificationStatus; }
