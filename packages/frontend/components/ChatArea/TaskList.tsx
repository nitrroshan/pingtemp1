import React, { useMemo, useState } from 'react';
import { ListTodo, ChevronDown, ChevronRight, Loader2, CheckCircle2, Circle, Clock, AlertCircle, Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Task, TaskStatus } from '../../types';

interface TaskListProps {
  tasks: Task[];
  agentName: string;
  /**
   * 'plan'  → manager view: every task in the plan, grouped by role, with dependency hints.
   * 'agent' → individual agent view: only this agent's tasks, grouped by status.
   */
  scope: 'plan' | 'agent';
  /** All plan tasks — used in 'plan' scope to resolve dependency labels. */
  allTasks?: Task[];
  onSelectTask?: (taskId: string) => void;
  selectedTaskId?: string | null;
  /** Manual-mode dispatch trigger; when supplied a Start ▶ icon appears on hover for ready rows. */
  onStartTask?: (taskId: string) => void;
  /** When true, ready tasks dispatch automatically — hide the Start icon. */
  autoExecuteEnabled?: boolean;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  ready: 1,
  pending: 2,
  failed: 3,
  completed: 4,
};

function statusIcon(status: TaskStatus) {
  switch (status) {
    case 'in_progress':
      return <Loader2 size={12} className="text-amber-500 animate-spin shrink-0" />;
    case 'completed':
      return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
    case 'failed':
      return <AlertCircle size={12} className="text-red-500 shrink-0" />;
    case 'ready':
      return <Circle size={12} className="text-blue-500 shrink-0" />;
    case 'pending':
    default:
      return <Clock size={12} className="text-muted-foreground shrink-0" />;
  }
}

function TaskRow({
  task,
  showRole,
  dependencyLabel,
  onClick,
  selected,
  onStart,
}: {
  task: Task;
  showRole?: boolean;
  dependencyLabel?: string | null;
  onClick?: () => void;
  selected?: boolean;
  /** When supplied and task is ready, render a Start ▶ icon that appears on hover. */
  onStart?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors',
        'hover:bg-accent/60',
        selected ? 'bg-accent/80' : 'bg-transparent',
        task.status === 'completed' && 'opacity-60'
      )}
    >
      {statusIcon(task.status)}
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-xs truncate',
            task.status === 'completed'
              ? 'line-through text-muted-foreground'
              : 'text-foreground'
          )}
        >
          {task.title}
        </div>
        {(showRole && task.assignedRole) || dependencyLabel ? (
          <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1.5">
            {showRole && task.assignedRole && (
              <span className="text-muted-foreground/90">{task.assignedRole}</span>
            )}
            {dependencyLabel && (
              <>
                {showRole && task.assignedRole && <span>·</span>}
                <span className="italic">waiting on {dependencyLabel}</span>
              </>
            )}
          </div>
        ) : null}
      </div>
      {onStart && task.status === 'ready' && (
        <span
          role="button"
          aria-label="Start task"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onStart(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onStart(); }
          }}
          className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-primary/15 text-primary cursor-pointer"
        >
          <Play size={12} />
        </span>
      )}
    </button>
  );
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      </button>
      {open && <div className="p-1 space-y-0.5">{children}</div>}
    </div>
  );
}

function EmptyState({ scope, agentName }: { scope: 'plan' | 'agent'; agentName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-56 text-muted-foreground gap-2">
      <ListTodo size={22} className="opacity-40" />
      <p className="text-xs">
        {scope === 'plan'
          ? 'No tasks yet — chat with the manager to plan some work.'
          : `Nothing assigned to ${agentName} yet.`}
      </p>
    </div>
  );
}

const TaskList: React.FC<TaskListProps> = ({
  tasks,
  agentName,
  scope,
  allTasks,
  onSelectTask,
  selectedTaskId,
  onStartTask,
  autoExecuteEnabled,
}) => {
  const startHandler = onStartTask && !autoExecuteEnabled
    ? (id: string) => () => onStartTask(id)
    : undefined;
  // Build dependency label resolver (id → title)
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    (allTasks ?? tasks).forEach(t => m.set(t.id, t.title));
    return m;
  }, [allTasks, tasks]);

  // Group by role (plan view) — sorted with active roles first
  const byRole = useMemo(() => {
    if (scope !== 'plan') return [];
    const groups = new Map<string, Task[]>();
    tasks.forEach(t => {
      const role = t.assignedRole || 'unassigned';
      if (!groups.has(role)) groups.set(role, []);
      groups.get(role)!.push(t);
    });
    // Sort each group by status priority
    groups.forEach(arr =>
      arr.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))
    );
    return Array.from(groups.entries()).sort(([, a], [, b]) => {
      const aActive = a.some(t => t.status === 'in_progress' || t.status === 'ready') ? 0 : 1;
      const bActive = b.some(t => t.status === 'in_progress' || t.status === 'ready') ? 0 : 1;
      return aActive - bActive;
    });
  }, [tasks, scope]);

  // Group by status (agent view)
  const byStatus = useMemo(() => {
    if (scope !== 'agent') return { active: [], queued: [], done: [] };
    const active: Task[] = [];
    const queued: Task[] = [];
    const done: Task[] = [];
    tasks.forEach(t => {
      if (t.status === 'in_progress' || t.status === 'ready') active.push(t);
      else if (t.status === 'pending') queued.push(t);
      else done.push(t); // completed | failed
    });
    return { active, queued, done };
  }, [tasks, scope]);

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center max-w-3xl mx-auto w-full p-4">
        <EmptyState scope={scope} agentName={agentName} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-3 scrollbar-thin">
      {scope === 'plan' ? (
        <>
          {byRole.map(([role, items]) => {
            const active = items.filter(t => t.status === 'in_progress' || t.status === 'ready').length;
            const done = items.filter(t => t.status === 'completed').length;
            return (
              <Section
                key={role}
                title={role}
                count={items.length}
                defaultOpen={active > 0 || done < items.length}
              >
                {items.map(task => {
                  const blockingDep = (task.dependencies ?? []).find(depId => {
                    const dep = (allTasks ?? tasks).find(t => t.id === depId);
                    return dep && dep.status !== 'completed';
                  });
                  const depLabel =
                    task.status === 'pending' && blockingDep
                      ? titleById.get(blockingDep) ?? blockingDep
                      : null;
                  return (
                    <TaskRow
                      key={task.id}
                      task={task}
                      showRole={false}
                      dependencyLabel={depLabel}
                      onClick={onSelectTask ? () => onSelectTask(task.id) : undefined}
                      selected={selectedTaskId === task.id}
                      onStart={startHandler ? startHandler(task.id) : undefined}
                    />
                  );
                })}
              </Section>
            );
          })}
        </>
      ) : (
        <>
          {byStatus.active.length > 0 && (
            <Section title="Active" count={byStatus.active.length}>
              {byStatus.active.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showRole={false}
                  onClick={onSelectTask ? () => onSelectTask(task.id) : undefined}
                  selected={selectedTaskId === task.id}
                  onStart={startHandler ? startHandler(task.id) : undefined}
                />
              ))}
            </Section>
          )}
          {byStatus.queued.length > 0 && (
            <Section title="Queued" count={byStatus.queued.length} defaultOpen={byStatus.active.length === 0}>
              {byStatus.queued.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showRole={false}
                  onClick={onSelectTask ? () => onSelectTask(task.id) : undefined}
                  selected={selectedTaskId === task.id}
                  onStart={startHandler ? startHandler(task.id) : undefined}
                />
              ))}
            </Section>
          )}
          {byStatus.done.length > 0 && (
            <Section title="Done" count={byStatus.done.length} defaultOpen={false}>
              {byStatus.done.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showRole={false}
                  onClick={onSelectTask ? () => onSelectTask(task.id) : undefined}
                  selected={selectedTaskId === task.id}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
};

export default TaskList;
