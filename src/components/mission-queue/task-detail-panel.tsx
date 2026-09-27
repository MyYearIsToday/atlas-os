import { CalendarClock, Check, Clock3, Info, RotateCcw, User, X } from 'lucide-react';

import { ApprovalBadge } from './task-card';
import {
  formatTaskDate,
  nextActionLabel,
  resolveClientDealValue,
  resolveClientLabel,
  type Task,
} from '@/services/mission-queue';

const money = (value: number) => `GH₵ ${value.toLocaleString('en-GH')}`;

interface TaskDetailPanelProps {
  task: Task;
  agentName: string;
  onClose: () => void;
  onAdvance: () => void;
  onSendBack: () => void;
}

export function TaskDetailPanel({ task, agentName, onClose, onAdvance, onSendBack }: TaskDetailPanelProps) {
  const clientLabel = resolveClientLabel(task.clientId);
  const dealValue = resolveClientDealValue(task.clientId);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#020812]/65 backdrop-blur-sm" onClick={onClose}>
      <aside className="scrollbar h-full w-full max-w-lg overflow-y-auto border-l border-[#2c3c52] bg-[#0b1f3a] p-5 sm:p-7" onClick={(event) => event.stopPropagation()} aria-label={`${task.title} task details`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#d4af37]">Task detail</p>
            <h3 className="mt-2 font-display text-[19px] font-semibold leading-6 tracking-[-.03em] text-white">{task.title}</h3>
            <p className="mt-1 text-[11px] text-[#8798ad]">{agentName} · {clientLabel}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-[#71839a] hover:bg-white/[.06] hover:text-white" aria-label="Close task details" data-testid="button-close-task-detail"><X size={18} /></button>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Priority</p><p className="mt-2 truncate font-display text-[14px] font-semibold text-white">{task.priority}</p></div>
          <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Status</p><p className="mt-2 truncate font-mono text-[10px] font-semibold text-white">{task.status}</p></div>
          <div className="rounded-lg border border-[#2a3c54] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Approval</p><div className="mt-2"><ApprovalBadge level={task.approvalRequired} /></div></div>
        </div>

        <div className="mt-7 space-y-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.17em] text-[#8293aa]">Description</p>
          <div className="rounded-lg border border-[#233247] bg-[#091828] p-4 text-[11px] leading-5 text-[#b7c5d4]">{task.description}</div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#233247] bg-[#091828] p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#71839a]"><CalendarClock size={11} /> Due date</p><p className="mt-2 text-[11px] text-[#dbe4ed]">{formatTaskDate(task.dueDate)}</p></div>
          <div className="rounded-lg border border-[#233247] bg-[#091828] p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#71839a]"><Clock3 size={11} /> Created</p><p className="mt-2 text-[11px] text-[#dbe4ed]">{formatTaskDate(task.createdAt)}</p></div>
          <div className="rounded-lg border border-[#233247] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Estimated cost</p><p className="mt-2 text-[11px] text-[#dbe4ed]">{money(task.estimatedCost)}</p></div>
          <div className="rounded-lg border border-[#233247] bg-[#091828] p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Estimated time</p><p className="mt-2 text-[11px] text-[#dbe4ed]">{task.estimatedTime}</p></div>
        </div>

        {task.clientId && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#233247] bg-[#091828] p-3 text-[11px] text-[#a7b5c5]">
            <User size={13} className="text-[#71839a]" /> Linked client deal value: <span className="font-mono text-[#d4af37]">{money(dealValue)}</span>
          </div>
        )}

        {task.status === 'Completed' && (
          <div className="mt-7 flex items-start gap-2 rounded-lg border border-[#233247] bg-[#091828] p-4 text-[11px] leading-5 text-[#a7b5c5]">
            <Info size={14} className="mt-0.5 shrink-0 text-[#71839a]" />
            <span>
              Completed {task.completedAt ? formatTaskDate(task.completedAt) : ''}. Sprint 3 does not connect real AI
              execution, so no generated deliverable exists for this task yet — this is a status record, not an
              AI-produced result.
            </span>
          </div>
        )}

        <div className="mt-7 flex gap-2 border-t border-[#233247] pt-5">
          {task.status === 'Waiting Approval' ? (
            <>
              <button onClick={onAdvance} className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d]" data-testid="button-approve-task"><Check size={13} /> Approve &amp; complete</button>
              <button onClick={onSendBack} className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0d1a2b] px-3.5 py-2.5 text-[11px] font-semibold text-[#b6c3d1] hover:border-[#d4af37] hover:text-white" data-testid="button-sendback-task"><RotateCcw size={13} /> Send back</button>
            </>
          ) : task.status !== 'Completed' ? (
            <button onClick={onAdvance} className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d]" data-testid="button-advance-task">
              {nextActionLabel(task)}
            </button>
          ) : (
            <span className="flex-1 rounded-lg border border-[#233247] bg-[#0d1a2b] px-3.5 py-2.5 text-center font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Task complete</span>
          )}
        </div>
      </aside>
    </div>
  );
}
