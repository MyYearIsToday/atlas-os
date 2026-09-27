import { CalendarClock, ChevronRight, Lock, ShieldAlert, Zap } from 'lucide-react';

import {
  type AgentActivity,
  formatTaskDate,
  isTaskOverdue,
  resolveClientLabel,
  type Task,
} from '@/services/mission-queue';

const money = (value: number) => `GH₵ ${value.toLocaleString('en-GH')}`;

const priorityColor: Record<Task['priority'], string> = {
  Critical: '#e28c76',
  High: '#d4af37',
  Medium: '#6c9ed8',
  Low: '#71839a',
};

export function ApprovalBadge({ level }: { level: Task['approvalRequired'] }) {
  if (level === 'CEO Only') {
    return <span className="flex items-center gap-1 rounded-md bg-[#e28c7618] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#e28c76]"><Lock size={9} /> CEO Only</span>;
  }
  if (level === 'Approval Required') {
    return <span className="flex items-center gap-1 rounded-md bg-[#d4af3718] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#d4af37]"><ShieldAlert size={9} /> Approval</span>;
  }
  return <span className="flex items-center gap-1 rounded-md bg-[#16a08518] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#42c7a8]"><Zap size={9} /> Auto</span>;
}

interface TaskCardProps {
  task: Task;
  agentName: string;
  onOpen: (task: Task) => void;
}

export function TaskCard({ task, agentName, onOpen }: TaskCardProps) {
  const overdue = isTaskOverdue(task);

  return (
    <article
      className="rounded-lg border border-[#26374e] bg-[#101f31] p-3.5 shadow-[0_5px_15px_rgba(0,0,0,.08)] transition-transform hover:-translate-y-0.5 hover:border-[#3a4e68]"
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(task);
      }}
      role="button"
      tabIndex={0}
      data-testid={`card-task-${task.taskId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[12px] font-semibold text-white">{task.title}</p>
          <p className="mt-1 truncate text-[10px] text-[#8798ad]">{agentName} · {resolveClientLabel(task.clientId)}</p>
        </div>
        <span className="shrink-0 rounded-md px-2 py-1 font-mono text-[9px] font-semibold" style={{ backgroundColor: `${priorityColor[task.priority]}18`, color: priorityColor[task.priority] }}>
          {task.priority}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <ApprovalBadge level={task.approvalRequired} />
        <span className="font-mono text-[10px] text-[#71839a]">{task.estimatedTime}</span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[#233247] pt-3">
        <span className={`flex min-w-0 items-center gap-1.5 truncate text-[9px] ${overdue ? 'text-[#e28c76]' : 'text-[#71839a]'}`}>
          <CalendarClock size={11} className="shrink-0" />
          {overdue ? 'Overdue · ' : 'Due '}{formatTaskDate(task.dueDate)}
        </span>
        <span className="font-mono text-[10px] font-semibold text-[#d4af37]">{money(task.estimatedCost)}</span>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 font-mono text-[9px] uppercase tracking-wider text-[#d4af37]">
        View task <ChevronRight size={11} />
      </div>
    </article>
  );
}

export function agentActivityLine(agent: AgentActivity): string {
  if (agent.currentTask) return agent.currentTask.title;
  if (agent.queueLength > 0) return `${agent.queueLength} task${agent.queueLength === 1 ? '' : 's'} queued`;
  return 'No active task';
}
