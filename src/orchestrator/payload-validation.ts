import type { OrchestrationEvent, OrchestrationEventType } from "./orchestration-types";

/**
 * Structural validation only — checks that the fields a real service call
 * actually needs are present and the right shape. It never fills in a
 * missing field with a guessed value; a payload that's missing something
 * required is rejected, not patched.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function fail(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}
const ok: ValidationResult = { valid: true, errors: [] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function validatePayload<T extends OrchestrationEventType>(event: OrchestrationEvent<T>): ValidationResult {
  const p = event.payload as any;

  switch (event.type) {
    case "BusinessDiscovered": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (p.discoveredBusiness === undefined) errors.push("discoveredBusiness is required");
      if (!["NONE", "POSSIBLE_DUPLICATE", "HUMAN_REVIEW"].includes(p.duplicateStatus)) errors.push("duplicateStatus must be NONE | POSSIBLE_DUPLICATE | HUMAN_REVIEW");
      return errors.length ? fail(...errors) : ok;
    }
    case "EvidenceUpdated": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (!p.opportunityInput || !Array.isArray(p.opportunityInput.components)) errors.push("opportunityInput.components must be an array");
      if (p.opportunityInput && p.opportunityInput.components?.length === 0) errors.push("opportunityInput.components cannot be empty — do not synthesize a score with no components");
      return errors.length ? fail(...errors) : ok;
    }
    case "ScoreCalculated": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (!p.opportunityScore) errors.push("opportunityScore is required");
      if (!p.auditInput) errors.push("auditInput is required");
      else if (!Array.isArray(p.auditInput.recommendations) || !Array.isArray(p.auditInput.quickWins)) errors.push("auditInput.recommendations and quickWins must be arrays");
      return errors.length ? fail(...errors) : ok;
    }
    case "AuditGenerated": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (!isNonEmptyString(p.auditId)) errors.push("auditId is required");
      if (!Array.isArray(p.recommendations)) errors.push("recommendations must be an array");
      if (!Array.isArray(p.quickWins)) errors.push("quickWins must be an array");
      return errors.length ? fail(...errors) : ok;
    }
    case "MissionCreated": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (!isNonEmptyString(p.taskId)) errors.push("taskId is required");
      return errors.length ? fail(...errors) : ok;
    }
    case "MissionCompleted": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (!isNonEmptyString(p.taskId)) errors.push("taskId is required");
      if (!Array.isArray(p.transactions)) errors.push("transactions must be an array");
      if (!p.period || !isNonEmptyString(p.period.start) || !isNonEmptyString(p.period.end)) errors.push("period.start and period.end are required");
      return errors.length ? fail(...errors) : ok;
    }
    case "PaymentRecorded": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.transactionId)) errors.push("transactionId is required");
      if (!p.snapshotInput || typeof p.snapshotInput !== "object") errors.push("snapshotInput is required");
      return errors.length ? fail(...errors) : ok;
    }
    case "WorkflowBlocked": {
      const errors: string[] = [];
      if (!isNonEmptyString(p.businessId)) errors.push("businessId is required");
      if (!isNonEmptyString(p.reason)) errors.push("reason is required");
      return errors.length ? fail(...errors) : ok;
    }
    default:
      return fail(`Unknown event type "${String(event.type)}"`);
  }
}
