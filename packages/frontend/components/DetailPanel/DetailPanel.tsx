/**
 * DetailPanel — right-side detail panel (320px, optional)
 *
 * Three context-aware modes (each is a focused 2-tab pane):
 *   1. Task-scoped (selectedTask)         → Overview + Logs
 *   2. Plan-scoped  (manager / orchestrator) → Tasks + Activity
 *   3. Agent-scoped (individual agent)    → Skills + Activity
 */

import React, { useState, useMemo } from 'react';
import { X, Activity, ListTodo, FileText, ScrollText, ChevronDown, ChevronRight, Sparkles, MessageCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import EventsView from '../AgentManagerPanel/EventsView';
import SkillSelector from '../SkillSelector';
import { TaskActions } from './TaskActions';
import { DiscussionThread } from '../DiscussionThread/DiscussionThread';
import { useDiscussion } from '../../hooks/useDiscussion';
import type { OrchestrationEvent, ActiveAgentState, Task } from '../../types';
import type { DiscussionThread as DiscussionThreadType } from '../../hooks/useDiscussion';

type DetailMode = 'task' | 'plan' | 'agent';
type PlanTab = 'tasks' | 'activity';
type AgentTab = 'skills' | 'activity';
type TaskTab = 'overview' | 'discussion' | 'logs';

interface DetailPanelProps {
  logs: OrchestrationEvent[];
  activeAgents: ActiveAgentState[];
  allTasks: Task[];
  /** Name of the currently active plan (used to group the global Tasks pane) */
  currentPlanName?: string;
  /** Active plan ID, used as goalId for the discussion sub-tab CRDT doc */
  activeGoalId?: string | null;
  discussionThreads?: DiscussionThreadType[];
  onOpenDiscussion?: (thread: DiscussionThreadType) => void;
  onPinDiscussion?: (thread: DiscussionThreadType) => void;
  agentName?: string;
  agentId?: string;
  teamId?: string;
  /** When true, the active agent is the orchestrator/manager (no parentId). Drives plan- vs agent-scoped panel. */
  isManager?: boolean;
  onClose: () => void;
  /** When set, panel shows task-specific Overview tab first */
  selectedTask?: Task | null;
  onSelectTask?: (taskId: string) => void;
  /** Manual-mode dispatch trigger for ready tasks. */
  onStartTask?: (taskId: string) => void;
  /** When true, ready tasks dispatch automatically (Start button hidden). */
  autoExecuteEnabled?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  ready:       'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  pending:     'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  completed:   'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  failed:      'bg-red-500/20 text-red-600 dark:text-red-400',
};

function TasksTab({
  tasks,
  selectedTask,
  currentPlanName,
  onSelectTask,
  onStartTask,
  autoExecuteEnabled,
}: {
  tasks: Task[];
  selectedTask?: Task | null;
  currentPlanName?: string;
  onSelectTask?: (taskId: string) => void;
  onStartTask?: (taskId: string) => void;
  autoExecuteEnabled?: boolean;
}) {
  // Show selected task detail if one is selected
  if (selectedTask) {
    return (
      <div className="p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{selectedTask.title}</h3>
          {selectedTask.description && (
            <p className="text-xs text-muted-foreground mt-1">{selectedTask.description}</p>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status</span>
            <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[selectedTask.status] ?? 'bg-muted text-muted-foreground'}`}>
              {selectedTask.status}
            </span>
          </div>
          {selectedTask.assignedRole && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Role</span>
              <span className="text-foreground">{selectedTask.assignedRole}</span>
            </div>
          )}
          {selectedTask.dependencies && selectedTask.dependencies.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Depends on:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedTask.dependencies.map(dep => (
                  <span key={dep} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">{dep}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        <TaskActions
          task={selectedTask}
          autoExecuteEnabled={autoExecuteEnabled}
          onStart={onStartTask}
        />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-xs">
        <ListTodo size={20} className="opacity-30" />
        <span>No active plans</span>
      </div>
    );
  }

  return <PlanGroupedTasks tasks={tasks} currentPlanName={currentPlanName} onSelectTask={onSelectTask} />;
}

function PlanGroupedTasks({
  tasks,
  currentPlanName,
  onSelectTask,
}: {
  tasks: Task[];
  currentPlanName?: string;
  onSelectTask?: (taskId: string) => void;
}) {
  // Group all tasks under the active plan (single-plan model today; ready for multi-plan later)
  const planLabel = currentPlanName?.trim() || 'Current Plan';
  const [open, setOpen] = useState(true);

  const stats = useMemo(() => {
    const done = tasks.filter(t => t.status === 'completed').length;
    const active = tasks.filter(t => t.status === 'in_progress' || t.status === 'ready').length;
    return { done, total: tasks.length, active };
  }, [tasks]);

  return (
    <div className="p-2 space-y-2">
      <div className="border border-border/60 rounded-lg overflow-hidden bg-card/30">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/40 transition-colors"
        >
          {open ? (
            <ChevronDown size={12} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground" />
          )}
          <span className="text-[11px] font-semibold text-foreground truncate">{planLabel}</span>
          <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
            {stats.done}/{stats.total}
            {stats.active > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-amber-500">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                running
              </span>
            )}
          </span>
        </button>
        {open && (
          <div className="p-1 space-y-0.5">
            {tasks.map(task => (
              <button
                key={task.id}
                onClick={onSelectTask ? () => onSelectTask(task.id) : undefined}
                className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-accent/60 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{task.title}</div>
                  {task.assignedRole && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{task.assignedRole}</div>
                  )}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[task.status] ?? 'bg-muted text-muted-foreground'}`}>
                  {task.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsEmpty({ agentName }: { agentName?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-xs px-4 text-center">
      <Sparkles size={20} className="opacity-30" />
      <span className="font-medium text-foreground/70">{agentName ?? 'Agent'} skills</span>
      <span className="text-[10px] text-muted-foreground/70">Select an agent to manage its skills.</span>
    </div>
  );
}

const PLAN_TABS: { id: PlanTab; label: string; icon: React.ReactNode }[] = [
  { id: 'tasks',    label: 'Tasks',    icon: <ListTodo size={13} /> },
  { id: 'activity', label: 'Activity', icon: <Activity size={13} /> },
];

const AGENT_TABS: { id: AgentTab; label: string; icon: React.ReactNode }[] = [
  { id: 'skills',   label: 'Skills',   icon: <Sparkles size={13} /> },
  { id: 'activity', label: 'Activity', icon: <Activity size={13} /> },
];

const TASK_TABS: { id: TaskTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',   label: 'Overview',   icon: <FileText size={13} /> },
  { id: 'discussion', label: 'Discussion', icon: <MessageCircle size={13} /> },
  { id: 'logs',       label: 'Logs',       icon: <ScrollText size={13} /> },
];

function TaskLogsTab({ logs, taskId }: { logs: OrchestrationEvent[]; taskId: string }) {
  // Filter logs that mention this task (best-effort: check message content for taskId)
  const filtered = logs.filter(l =>
    l.message?.includes(taskId) || l.agentId?.includes(taskId) || false
  );
  const display = filtered.length > 0 ? filtered : logs.slice(-20); // fallback: last 20

  return <EventsView logs={display} />;
}

/**
 * TaskDiscussionTab — wires the per-task CRDT discussion thread.
 * Doc name follows the convention `{teamId}/{goalId}/{taskId}/discussion`.
 * Uses activeGoalId as goalId since that's our single-plan-per-team model today.
 */
function TaskDiscussionTab({
  teamId,
  goalId,
  task,
}: {
  teamId: string;
  goalId: string;
  task: Task;
}) {
  const { blocks, decisions, config, status, postBlock } = useDiscussion({
    teamId,
    goalId,
    taskId: task.id,
  });

  if (status === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        connecting…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2 px-4 text-center">
        <MessageCircle size={20} className="opacity-30" />
        <span>Discussion server unreachable.</span>
      </div>
    );
  }

  return (
    <DiscussionThread
      blocks={blocks}
      decisions={decisions}
      config={config}
      title={task.title}
      subtitle={task.assignedRole ? `Assigned to ${task.assignedRole}` : undefined}
      onPost={postBlock}
      compact
    />
  );
}

export function DetailPanel({ logs, activeAgents, allTasks, currentPlanName, activeGoalId, discussionThreads, onOpenDiscussion, onPinDiscussion, agentName, agentId, teamId, isManager, onClose, selectedTask, onSelectTask, onStartTask, autoExecuteEnabled }: DetailPanelProps) {
  const isTaskScoped = !!selectedTask;
  const mode: DetailMode = isTaskScoped ? 'task' : (isManager ? 'plan' : 'agent');

  const [taskTab, setTaskTab] = useState<TaskTab>('overview');
  const [planTab, setPlanTab] = useState<PlanTab>('tasks');
  const [agentTab, setAgentTab] = useState<AgentTab>('skills');

  // Reset task sub-tab when a different task is selected
  React.useEffect(() => {
    if (selectedTask) setTaskTab('overview');
  }, [selectedTask?.id]);

  // Header label per mode
  const headerLabel =
    mode === 'task'  ? selectedTask!.title :
    mode === 'plan'  ? (currentPlanName?.trim() || 'Plan') :
                       (agentName || 'Agent');

  return (
    <motion.div
      className="w-80 border-l border-border bg-background flex flex-col shrink-0"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wider truncate">
          {headerLabel}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer shrink-0"
          aria-label="Close detail panel"
        >
          <X size={14} />
        </button>
      </div>

      {mode === 'task' && (
        /* ── Task-scoped: Overview / Discussion / Logs ── */
        <>
          <TabRow tabs={TASK_TABS} active={taskTab} onChange={setTaskTab} />
          <div className="flex-1 overflow-hidden relative">
            {taskTab === 'overview' && (
              <div className="absolute inset-0 overflow-y-auto">
                <TasksTab tasks={allTasks} selectedTask={selectedTask} currentPlanName={currentPlanName} onSelectTask={onSelectTask} onStartTask={onStartTask} autoExecuteEnabled={autoExecuteEnabled} />
              </div>
            )}
            {taskTab === 'discussion' && (
              <div className="absolute inset-0 flex flex-col">
                {teamId && activeGoalId ? (
                  <TaskDiscussionTab teamId={teamId} goalId={activeGoalId} task={selectedTask!} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2 px-4 text-center">
                    <MessageCircle size={20} className="opacity-30" />
                    <span>Discussion requires an active plan.</span>
                  </div>
                )}
              </div>
            )}
            {taskTab === 'logs' && (
              <div className="absolute inset-0 overflow-y-auto">
                <TaskLogsTab logs={logs} taskId={selectedTask!.id} />
              </div>
            )}
          </div>
        </>
      )}

      {mode === 'plan' && (
        /* ── Plan-scoped (manager): Tasks / Activity ── */
        <>
          <TabRow tabs={PLAN_TABS} active={planTab} onChange={setPlanTab} />
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {planTab === 'tasks' && (
                <motion.div key="tasks" className="absolute inset-0 overflow-y-auto"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <TasksTab tasks={allTasks} currentPlanName={currentPlanName} onSelectTask={onSelectTask} onStartTask={onStartTask} autoExecuteEnabled={autoExecuteEnabled} />
                </motion.div>
              )}
              {planTab === 'activity' && (
                <motion.div key="activity" className="absolute inset-0"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <EventsView logs={logs} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {mode === 'agent' && (
        /* ── Agent-scoped: Skills / Activity ── */
        <>
          <TabRow tabs={AGENT_TABS} active={agentTab} onChange={setAgentTab} />
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {agentTab === 'skills' && (
                <motion.div key="skills" className="absolute inset-0 overflow-y-auto"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  {agentId && teamId ? (
                    <SkillSelector agentId={agentId} teamId={teamId} onClose={onClose} />
                  ) : (
                    <SettingsEmpty agentName={agentName} />
                  )}
                </motion.div>
              )}
              {agentTab === 'activity' && (
                <motion.div key="activity" className="absolute inset-0"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <EventsView logs={agentId ? logs.filter(l => l.agentId === agentId) : logs} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}

/** Shared 2-tab row used by all three modes */
function TabRow<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon: React.ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex border-b border-border shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
            active === tab.id
              ? 'text-primary border-b-2 border-primary -mb-px'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export default DetailPanel;
