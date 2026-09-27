import type { FinancialTransaction, Money, ProfitLossReport, CashFlowReport } from "./finance-types";
import { money, add, subtract } from "./money";

/**
 * Reformatted for readability during integration review (logic unchanged
 * from the source patch, apart from the TradeSpark isolation fix below —
 * see DECISION_LOG.md, 2026-09-17).
 */

export interface ReportPeriod {
  start: string;
  end: string;
  timezone: string;
  currency: string;
  includedStatuses: FinancialTransaction["status"][];
}

const zero = (currency: string): Money => money(0n, currency, 2);

function sum(transactions: FinancialTransaction[], predicate: (t: FinancialTransaction) => boolean, currency: string): Money {
  return transactions.filter(predicate).reduce((total, t) => add(total, t.amount), zero(currency));
}

/**
 * Excludes TradeSpark transactions by default. Per the Constitution
 * ("TradeSpark must remain isolated. Do not mix trading activity with
 * operating revenue" — ATLAS.md § Atlas Products), operating reports must
 * never silently fold trading activity into MapSpark/ContentSpark/LeadSpark
 * results. Passing `includeTradeSpark: true` requires the caller to have
 * made that inclusion decision explicitly — it is never the default.
 */
function excludeTradeSparkByDefault(transactions: FinancialTransaction[], includeTradeSpark: boolean): FinancialTransaction[] {
  if (includeTradeSpark) return transactions;
  return transactions.filter((t) => t.productId !== "TradeSpark");
}

export function profitLoss(
  transactions: FinancialTransaction[],
  period: ReportPeriod,
  options: { includeTradeSpark?: boolean } = {},
): ProfitLossReport {
  const inPeriod = excludeTradeSparkByDefault(
    transactions.filter((t) => t.transactionDate >= period.start && t.transactionDate <= period.end && period.includedStatuses.includes(t.status)),
    options.includeTradeSpark ?? false,
  );

  const revenue = sum(inPeriod, (t) => t.transactionType === "REVENUE", period.currency);
  const directCosts = sum(inPeriod, (t) => t.transactionType === "EXPENSE" && t.category === "DIRECT_COST", period.currency);
  const operatingExpenses = sum(inPeriod, (t) => t.transactionType === "EXPENSE" && t.category !== "DIRECT_COST", period.currency);
  const grossProfit = subtract(revenue, directCosts);

  const limitations = ["Excludes transactions outside the selected period/statuses and any unallocated shared costs."];
  if (!(options.includeTradeSpark ?? false)) {
    limitations.push("Excludes TradeSpark transactions by default — operating results are isolated from trading activity per Atlas Constitution.");
  }

  return {
    period: period as never,
    revenue,
    directCosts,
    grossProfit,
    operatingExpenses,
    operatingResult: subtract(grossProfit, operatingExpenses),
    limitations,
  };
}

/**
 * Connects Finance to CRM: revenue and direct costs attributed to a specific
 * client (via `FinancialTransaction.clientId`, the same loose-reference
 * pattern used by Mission Queue's `clientId` in Sprint 3/4A). Required by
 * the "Client → Deal → Revenue → Costs → Contribution" integration rule.
 */
export function clientProfitability(
  transactions: FinancialTransaction[],
  clientId: string,
  period: ReportPeriod,
): import("./finance-types").ClientProfitability {
  const inPeriod = excludeTradeSparkByDefault(
    transactions.filter(
      (t) => t.clientId === clientId && t.transactionDate >= period.start && t.transactionDate <= period.end && period.includedStatuses.includes(t.status),
    ),
    false,
  );

  const revenue = sum(inPeriod, (t) => t.transactionType === "REVENUE", period.currency);
  const directCost = sum(inPeriod, (t) => t.transactionType === "EXPENSE" && t.category === "DIRECT_COST", period.currency);
  const contribution = subtract(revenue, directCost);
  const contributionMarginPercent = revenue.minorUnits > 0n
    ? Number((contribution.minorUnits * 10000n) / revenue.minorUnits) / 100
    : null;

  return {
    clientId,
    period: period as never,
    revenue,
    directCost,
    contribution,
    contributionMarginPercent,
    limitations: ["Excludes shared/unallocated operating expenses — this is direct contribution, not fully-loaded profit."],
  };
}

export function cashFlow(
  transactions: FinancialTransaction[],
  period: ReportPeriod,
  openingCash: Money,
  options: { includeTradeSpark?: boolean } = {},
): CashFlowReport {
  const inPeriod = excludeTradeSparkByDefault(
    transactions.filter((t) => t.transactionDate >= period.start && t.transactionDate <= period.end && period.includedStatuses.includes(t.status)),
    options.includeTradeSpark ?? false,
  );

  const inflows = sum(inPeriod, (t) => t.direction === "INFLOW", period.currency);
  const outflows = sum(inPeriod, (t) => t.direction === "OUTFLOW", period.currency);
  const netMovement = subtract(inflows, outflows);

  const limitations = ["Cash position requires complete included accounts and reconciled records."];
  if (!(options.includeTradeSpark ?? false)) {
    limitations.push("Excludes TradeSpark transactions by default — see Atlas Constitution's TradeSpark isolation rule.");
  }

  return {
    period: period as never,
    openingCash,
    inflows,
    outflows,
    netMovement,
    closingCash: add(openingCash, netMovement),
    limitations,
  };
}
