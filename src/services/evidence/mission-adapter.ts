import {
  type MissionQueueRepository,
  type Task,
  type TaskInput,
  type TaskPriority,
  localMissionQueueRepository,
} from "../mission-queue";
import type { BusinessIntelligence } from "./business-intelligence";

/**
 * Establishes the data connection between MapSpark's evidence/Opportunity
 * Score pipeline and the existing Mission Queue (src/services/mission-queue.ts),
 * per Sprint 4A item 15. This does NOT introduce a second mission system —
 * every mission created here is a real Task in the existing repository.
 */

export function missionReason(opportunityScore: number, reasons: string[]): string {
  return `Scout priority ${opportunityScore}/100: ${reasons.join("; ")}`;
}

function priorityForOpportunityScore(score: number): TaskPriority {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

/**
 * Creates a real Scout mission Task for a business the Opportunity Score
 * engine has flagged as worth investigating, via the existing Mission Queue
 * repository. `clientId` is left null — a discovered business is not yet a
 * CRM lead; converting one into a lead is a separate, human-approved step,
 * not something this adapter does automatically.
 */
export async function createScoutMissionForBusiness(
  business: BusinessIntelligence,
  opportunityScore: number,
  reasons: string[],
  repository: MissionQueueRepository = localMissionQueueRepository,
): Promise<Task> {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);

  const input: TaskInput = {
    title: `Scout priority review — ${business.canonicalName}`,
    description: missionReason(opportunityScore, reasons),
    assignedAI: "scout",
    clientId: null,
    priority: priorityForOpportunityScore(opportunityScore),
    approvalRequired: "Auto",
    dueDate: dueDate.toISOString().slice(0, 10),
    estimatedCost: 0,
    estimatedTime: "30 min",
  };

  return repository.create(input);
}
