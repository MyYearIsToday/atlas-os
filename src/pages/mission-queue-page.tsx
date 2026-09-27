import { useMemo, useState } from 'react';
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react';

import { PageIntro } from '@/components/atlas-shell';
import { ApprovalCenter } from '@/components/mission-queue/approval-center';
import { FleetStatus } from '@/components/mission-queue/fleet-status';
import { TaskCard } from '@/components/mission-queue/task-card';
import { TaskDetailPanel } from '@/components/mission-queue/task-detail-panel';
import { agentRegistry, type AgentId } from '@/agents';
import {
  type ApprovalLevel,
  deriveAgentActivity,
  type Task,
  type TaskPriority,
  type TaskStatus,
  taskPriorities,
  taskStatuses,
  approvalLevels,
  useMissionQueue,
} from '@/services/mission-queue';

const cardClass = 'card-glow rounded-xl border border-[#233247] bg-[#0d1a2b]/90';
const buttonClass = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3.5 py-2.5 text-[11px] font-semibold text-[#0b1f3a] transition-transform hover:-translate-y-0.5 hover:bg-[#e1bf4d] active:translate-y-0';
const ghostButton = 'focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0d1a2b] px-3.5 py-2.5 text-[11px] font-semibold text-[#b6c3d1] transition-colors hover:border-[#d4af37] hover:text-white';

const agentNames = Object.fromEntries(
  (Object.keys(agentRegistry) as AgentId[]).map((id) => [id, agentRegistry[id].name]),
) as Record<AgentId, string>;

const priorityRank: Record<TaskPriority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export function MissionQueuePage() {
  const { tasks, advanceTask, sendBackForRevision } = useMissionQueue();
  const [view, setView] = useState<'queue' | 'approval'>('queue');
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'All' | TaskPriority>('All');
  const [approvalFilter, setApprovalFilter] = useState<'All' | ApprovalLevel>('All');
  const [agentFilter, setAgentFilter] = useState<'All' | AgentId>('All');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const agentActivity = useMemo(() => deriveAgentActivity(tasks), [tasks]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const haystack = [task.title, task.description, agentNames[task.assignedAI]].join(' ').toLowerCase();
        const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
        const matchesPriority = priorityFilter === 'All' || task.priority === priorityFilter;
        const matchesApproval = approvalFilter === 'All' || task.approvalRequired === approvalFilter;
        const matchesAgentFilter = agentFilter === 'All' || task.assignedAI === agentFilter;
        const matchesActiveAgent = !activeAgent || task.assignedAI === activeAgent;
        return matchesQuery && matchesPriority && matchesApproval && matchesAgentFilter && matchesActiveAgent;
      })
      .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || a.dueDate.localeCompare(b.dueDate));
  }, [activeAgent, agentFilter, approvalFilter, priorityFilter, query, tasks]);

  const openTask = (task: Task) => setSelectedTask(task);
  const closeTask = () => setSelectedTask(null);

  const handleAdvance = async () => {
    if (!selectedTask) return;
    const updated = await advanceTask(selectedTask.taskId);
    setSelectedTask(updated);
  };

  const handleSendBack = async () => {
    if (!selectedTask) return;
    const updated = await sendBackForRevision(selectedTask.taskId);
    setSelectedTask(updated);
  };

  const awaitingApproval = tasks.filter((task) => task.status === 'Waiting Approval').length;

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageIntro
        eyebrow="Atlas Brain · Sprint 3"
        title="Mission Queue"
        description="Every job Atlas's AI employees are working, in one structured, approval-aware queue. Local development data — no AI execution or real task results connected yet."
      />

      <FleetStatus agents={agentActivity} activeAgentId={activeAgent} onSelectAgent={setActiveAgent} />

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#233247] bg-[#0c192a] px-4 py-3">
        <SlidersHorizontal size={15} className="text-[#d4af37]" />
        <p className="text-[11px] text-[#a7b5c5]">Queue health</p>
        <span className="ml-auto font-mono text-[10px] text-[#d4af37]">{awaitingApproval} awaiting your approval</span>
      </div>

      <div className="mb-5 flex items-center gap-2">
        <button className={view === 'queue' ? buttonClass : ghostButton} onClick={() => setView('queue')} data-testid="button-view-queue">Queue</button>
        <button className={view === 'approval' ? buttonClass : ghostButton} onClick={() => setView('approval')} data-testid="button-view-approval-center">
          Approval Center{awaitingApproval > 0 && <span className="ml-1 rounded bg-[#0b1f3a]/40 px-1.5 py-0.5 font-mono text-[9px]">{awaitingApproval}</span>}
        </button>
      </div>

      <div className="mb-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#2a3c54] bg-[#0c1a2c] px-3 py-2.5 sm:max-w-md">
            <Search size={15} className="text-[#71839a]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks, description, AI employee..." className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#667990]" data-testid="input-search-tasks" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#71839a]">{filtered.length} of {tasks.length} tasks</span>
            <button className={filtersOpen ? buttonClass : ghostButton} onClick={() => setFiltersOpen((open) => !open)} data-testid="button-toggle-task-filters"><Filter size={13} /> <span className="hidden sm:inline">Filter</span></button>
          </div>
        </div>

        {filtersOpen && (
          <div className={`${cardClass} flex flex-col gap-3 p-4 sm:flex-row sm:items-end`} data-testid="panel-task-filters">
            <label className="flex-1"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Priority</span><select className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'All' | TaskPriority)} data-testid="select-filter-priority"><option>All</option>{taskPriorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
            <label className="flex-1"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">Approval</span><select className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" value={approvalFilter} onChange={(event) => setApprovalFilter(event.target.value as 'All' | ApprovalLevel)} data-testid="select-filter-approval"><option>All</option>{approvalLevels.map((level) => <option key={level}>{level}</option>)}</select></label>
            <label className="flex-1"><span className="mb-1.5 block font-mono text-[9px] uppercase tracking-wider text-[#71839a]">AI employee</span><select className="w-full rounded-lg border border-[#2a3c54] bg-[#091625] px-3 py-2.5 text-[11px] text-white outline-none focus:border-[#d4af37]" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value as 'All' | AgentId)} data-testid="select-filter-agent"><option value="All">All</option>{(Object.keys(agentRegistry) as AgentId[]).map((id) => <option key={id} value={id}>{agentNames[id]}</option>)}</select></label>
            <button className={`${ghostButton} shrink-0`} onClick={() => { setQuery(''); setPriorityFilter('All'); setApprovalFilter('All'); setAgentFilter('All'); }} data-testid="button-clear-task-filters"><X size={13} /> Clear</button>
          </div>
        )}
      </div>

      {view === 'queue' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {taskStatuses.map((status: TaskStatus) => {
            const statusTasks = filtered.filter((task) => task.status === status);
            return (
              <section key={status} className="min-w-0">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${status === 'Completed' ? 'bg-[#16a085]' : status === 'Waiting Approval' ? 'bg-[#e28c76]' : 'bg-[#d4af37]'}`} /><h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#acbac9]">{status}</h3></div>
                  <span className="rounded bg-[#192a3e] px-1.5 py-0.5 font-mono text-[9px] text-[#71839a]">{statusTasks.length}</span>
                </div>
                <div className="space-y-2.5">
                  {statusTasks.map((task) => <TaskCard key={task.taskId} task={task} agentName={agentNames[task.assignedAI]} onOpen={openTask} />)}
                  {statusTasks.length === 0 && <div className="rounded-lg border border-dashed border-[#2a3b51] p-7 text-center"><p className="font-mono text-[9px] text-[#5f738b]">No tasks</p></div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <ApprovalCenter tasks={filtered} agentNames={agentNames} onOpen={openTask} />
      )}

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          agentName={agentNames[selectedTask.assignedAI]}
          onClose={closeTask}
          onAdvance={() => void handleAdvance()}
          onSendBack={() => void handleSendBack()}
        />
      )}
    </div>
  );
}
