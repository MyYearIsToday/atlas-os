import type { OperationalLedger } from "../services/finance/ledger";
import { toDecimal } from "../services/finance/money";
import type { WorkforceConfig } from "./workforce-config";

/**
 * Sprint 5E — daily AI cost limit enforcement.
 *
 * `dailyCostLimitUsd` existed in config since Sprint 5C/5D but nothing
 * checked it (flagged in PROJECT_STATE.md as a Sprint 5E candidate). This
 * reads today's already-posted `AI_COST` transactions from the *existing*
 * Finance Ledger (`cost-tracker.ts`'s `recordAiCost`) as the source of
 * truth — it does not introduce a second, separate spend counter that
 * could drift from what the ledger actually shows.
 */

export interface BudgetCheck {
  allowed: boolean;
  spentTodayUsd: number;
  limitUsd: number;
  reason?: string;
}

export function checkDailyBudget(ledger: OperationalLedger, config: WorkforceConfig, now = new Date()): BudgetCheck {
  const today = now.toISOString().slice(0, 10);
  const spentTodayUsd = ledger
    .list()
    .filter((t) => t.category === "AI_COST" && t.status === "POSTED" && t.transactionDate === today)
    .reduce((sum, t) => sum + Number(toDecimal(t.amount)), 0);

  const allowed = spentTodayUsd < config.dailyCostLimitUsd;
  return {
    allowed,
    spentTodayUsd,
    limitUsd: config.dailyCostLimitUsd,
    reason: allowed ? undefined : `Daily AI cost limit reached: $${spentTodayUsd.toFixed(2)} spent of $${config.dailyCostLimitUsd} limit.`,
  };
}
