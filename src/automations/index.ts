export interface AutomationDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  cadence: string;
}

export const atlasAutomations: AutomationDefinition[] = [
  {
    id: 'daily-score-refresh',
    name: 'Daily visibility refresh',
    description: 'Recalculate active client scores and flag score drops.',
    enabled: true,
    cadence: 'Every weekday at 06:00',
  },
  {
    id: 'proposal-follow-up',
    name: 'Proposal follow-up queue',
    description: 'Surface proposals without a decision after 48 hours.',
    enabled: true,
    cadence: 'Every 4 hours',
  },
  {
    id: 'finance-reconciliation',
    name: 'Finance reconciliation',
    description: 'Match new revenue and expenses to the operating ledger.',
    enabled: true,
    cadence: 'Daily at 18:00',
  },
];