import type { ApprovalLevel } from "../services/mission-queue";
import { defaultFinanceApprovalPolicy, type FinanceApprovalPolicy } from "../services/finance/approval-policy";
import type { ApprovalCheck } from "./orchestration-types";

/**
 * Approval Gateway.
 *
 * Atlas's Approval Engine today is enforced by convention and data, not a
 * single callable "engine" module: `Task.approvalRequired` (Sprint 3) and
 * `FinanceApprovalPolicy` (Finance Ledger) both express the same three-tier
 * rule from ATLAS.md § Approval Engine, but nothing before this file could
 * be asked "is this allowed?" as a function call. This gateway is that
 * first callable decision point — it does not invent a new approval model,
 * it reads the existing `ApprovalLevel` type and the existing finance
 * policy categories and applies the one rule ATLAS.md already states:
 * Auto runs; Approval Required and CEO Only require a human decision that
 * already happened elsewhere (the Approval Center, a CEO sign-off) before
 * this gateway will report `allowed: true`. It never grants an approval
 * itself.
 */

export function resolveFinanceApprovalLevel(
  category: string,
  policy: FinanceApprovalPolicy = defaultFinanceApprovalPolicy,
): ApprovalLevel {
  if (policy.ceoOnlyCategories.includes(category)) return "CEO Only";
  if (policy.approvalCategories.includes(category)) return "Approval Required";
  return "Auto";
}

export interface ApprovalContext {
  level: ApprovalLevel;
  /** True only if a human has already approved this specific action elsewhere (Approval Center, CEO sign-off). Never set true by the gateway itself. */
  approvedByHuman: boolean;
  /** True only if the CEO specifically has approved it — required for CEO Only actions. */
  approvedByCeo: boolean;
}

export function checkApproval(context: ApprovalContext): ApprovalCheck {
  if (context.level === "Auto") {
    return { level: context.level, allowed: true, reason: "Auto-tier action; no human approval required." };
  }
  if (context.level === "CEO Only") {
    return {
      level: context.level,
      allowed: context.approvedByCeo,
      reason: context.approvedByCeo
        ? "CEO approval recorded."
        : "Blocked — CEO Only action requires explicit CEO approval before the orchestrator may proceed.",
    };
  }
  // Approval Required
  return {
    level: context.level,
    allowed: context.approvedByHuman,
    reason: context.approvedByHuman
      ? "Human approval recorded."
      : "Blocked — this action is prepared, not executed, until a human approves it.",
  };
}
