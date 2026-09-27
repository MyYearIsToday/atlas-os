import { agentActivityLine } from './task-card';
import type { AgentId } from '@/agents';
import type { AgentActivity } from '@/services/mission-queue';

const agentAccent: Record<string, string> = {
  scout: '#d4af37',
  builder: '#16a085',
  operator: '#7c9cff',
  closer: '#e98b6d',
  finance: '#b69cff',
};

interface FleetStatusProps {
  agents: AgentActivity[];
  activeAgentId: AgentId | null;
  onSelectAgent: (agentId: AgentId | null) => void;
}

export function FleetStatus({ agents, activeAgentId, onSelectAgent }: FleetStatusProps) {
  return (
    <div className="scrollbar mb-5 flex gap-3 overflow-x-auto pb-1" data-testid="fleet-status-strip">
      {agents.map((agent) => {
        const accent = agentAccent[agent.agentId] ?? '#d4af37';
        const selected = activeAgentId === agent.agentId;
        return (
          <button
            key={agent.agentId}
            onClick={() => onSelectAgent(selected ? null : agent.agentId)}
            className={`min-w-[192px] shrink-0 rounded-xl border p-3.5 text-left transition-colors ${selected ? 'border-[#d4af37] bg-[#15243a]' : 'border-[#233247] bg-[#0d1a2b]/90 hover:border-[#3a4e68]'}`}
            data-testid={`button-fleet-${agent.agentId}`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg font-display text-[10px] font-bold" style={{ backgroundColor: `${accent}20`, color: accent }}>
                  {agent.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="text-[11px] font-medium text-[#e0e7ef]">{agent.name}</span>
              </span>
              <span className={`h-2 w-2 rounded-full ${agent.isWorking ? 'bg-[#42c7a8]' : 'bg-[#4c5f77]'}`} title={agent.isWorking ? 'Working' : 'Idle'} />
            </div>
            <p className="mt-2 truncate text-[10px] text-[#8798ad]">{agentActivityLine(agent)}</p>
            <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#61748d]">
              <span>Queue {agent.queueLength}</span>
              <span>{agent.completedToday} done today</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
