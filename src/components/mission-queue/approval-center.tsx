import { Lock, ShieldAlert, Zap } from 'lucide-react';

import { TaskCard } from './task-card';
import type { AgentId } from '@/agents';
import type { ApprovalLevel, Task } from '@/services/mission-queue';

const cardClass = 'card-glow rounded-xl border border-[#233247] bg-[#0d1a2b]/90';

const columns: { level: ApprovalLevel; icon: typeof Zap; accent: string; caption: string }[] = [
  { level: 'Auto', icon: Zap, accent: '#42c7a8', caption: 'Atlas can execute these without CEO intervention.' },
  { level: 'Approval Required', icon: ShieldAlert, accent: '#d4af37', caption: 'AI can prepare these, but you must approve before execution or delivery.' },
  { level: 'CEO Only', icon: Lock, accent: '#e28c76', caption: 'These must never be executed automatically — CEO authorization only.' },
];

interface ApprovalCenterProps {
  tasks: Task[];
  agentNames: Record<AgentId, string>;
  onOpen: (task: Task) => void;
}

export function ApprovalCenter({ tasks, agentNames, onOpen }: ApprovalCenterProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {columns.map(({ level, icon: Icon, accent, caption }) => {
        const levelTasks = tasks.filter((task) => task.approvalRequired === level && task.status !== 'Completed');
        return (
          <section key={level} className={`${cardClass} p-4`} data-testid={`approval-column-${level.toLowerCase().replace(/\s+/g, '-')}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}18`, color: accent }}><Icon size={15} /></span>
              <div className="min-w-0">
                <h3 className="font-display text-[13px] font-semibold text-white">{level}</h3>
                <p className="font-mono text-[9px] text-[#71839a]">{levelTasks.length} open</p>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-4 text-[#8798ad]">{caption}</p>
            <div className="mt-4 space-y-2.5">
              {levelTasks.map((task) => (
                <TaskCard key={task.taskId} task={task} agentName={agentNames[task.assignedAI]} onOpen={onOpen} />
              ))}
              {levelTasks.length === 0 && (
                <div className="rounded-lg border border-dashed border-[#2a3b51] p-7 text-center">
                  <p className="font-mono text-[9px] text-[#5f738b]">Nothing waiting here</p>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
