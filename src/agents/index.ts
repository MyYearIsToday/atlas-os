export type AgentId =
  | 'scout'
  | 'builder'
  | 'operator'
  | 'closer'
  | 'finance';

export interface AgentTask {
  id: string;
  agentId: AgentId;
  title: string;
  status: 'queued' | 'running' | 'complete' | 'blocked';
  createdAt: string;
}

export const agentRegistry: Record<AgentId, { name: string; purpose: string }> = {
  scout: { name: 'Scout AI', purpose: 'Market intelligence and opportunity discovery' },
  builder: { name: 'Builder AI', purpose: 'Audit production and client deliverables' },
  operator: { name: 'Operator AI', purpose: 'Systems, routing, and delivery operations' },
  closer: { name: 'Closer AI', purpose: 'Revenue conversations and proposal movement' },
  finance: { name: 'Finance AI', purpose: 'Cash visibility and financial controls' },
};