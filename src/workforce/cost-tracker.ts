import { money } from "../services/finance/money";
import type { OperationalLedger } from "../services/finance/ledger";
import type { FinancialTransaction, ProductId } from "../services/finance/finance-types";
import type { CostRecord, AIProviderResult } from "./provider-types";
import type { WorkforceConfig } from "./workforce-config";

/**
 * Every AI execution becomes a real transaction in the *existing* ledger —
 * this module does not build a parallel cost ledger. Cost is converted to
 * bigint cents via `money()` (never a floating-point field on the ledger
 * itself), and the transaction category is "AI_COST" so it is visible in
 * `profitLoss()` as an operating expense, distinct from direct client
 * costs. TradeSpark attribution requires the same explicit opt-in as every
 * other TradeSpark-adjacent report (`config.featureFlags.
 * attributeAiCostsToTradeSpark`), defaulting to `MapSpark`'s shared pool
 * otherwise — AI spend is never silently folded into TradeSpark or vice
 * versa.
 */

export function buildCostRecord(result: AIProviderResult, model: string, promptTokens: number | null, completionTokens: number | null, worker: CostRecord["worker"], lineageId: string): CostRecord {
  return {
    provider: result.provider,
    model,
    promptTokens,
    completionTokens,
    estimatedCostUsd: result.failed ? 0 : result.estimatedCostUsd,
    worker,
    timestamp: new Date().toISOString(),
    lineageId,
  };
}

export function costRecordToTransaction(record: CostRecord, config: WorkforceConfig, createdBy = "atlas-orchestrator"): FinancialTransaction {
  const productId: ProductId = config.featureFlags.attributeAiCostsToTradeSpark ? "TradeSpark" : "Atlas_Shared";
  const cents = BigInt(Math.round(record.estimatedCostUsd * 100));

  return {
    transactionId: `ai-cost-${record.lineageId}`,
    transactionType: "EXPENSE",
    transactionDate: record.timestamp.slice(0, 10),
    recordedAt: record.timestamp,
    amount: money(cents, "USD", 2),
    direction: "OUTFLOW",
    status: "POSTED",
    category: "AI_COST",
    productId,
    description: `AI worker cost — ${record.worker} via ${record.provider}/${record.model}`,
    evidenceRefs: [`lineage:${record.lineageId}`],
    verificationStatus: "VERIFIED",
    approvalStatus: "NOT_REQUIRED",
    createdBy,
    updatedAt: record.timestamp,
  };
}

/** Posts an AI cost record to the existing ledger. Returns null (and posts nothing) for a $0 record from a failed execution — a failure has no real cost to attribute. */
export function recordAiCost(record: CostRecord, ledger: OperationalLedger, config: WorkforceConfig, createdBy?: string): FinancialTransaction | null {
  if (record.estimatedCostUsd <= 0) return null;
  const transaction = costRecordToTransaction(record, config, createdBy);
  return ledger.post(transaction, createdBy ?? "atlas-orchestrator");
}
