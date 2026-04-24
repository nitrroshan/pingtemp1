/**
 * PlanTaskList — compact task list for the sidebar (plan-scoped).
 *
 * Shows current plan's tasks with status icons, role badge, and elapsed time.
 * Clicking a task selects it (lifts selection to App for DetailPanel).
 *
 * Feature-gated: when VITE_ENABLE_PLAN_SIDEBAR is off, sidebar keeps
 * the existing 4-nav-item layout. This component is only rendered when on.
 */

import React from 'react';
import { CheckCircle2, Circle, Clock, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Task } from '../../types';
import { TaskTimeLabel } from './TaskTimeLabel';
import { TaskProgressBar } from './TaskProgressBar';

interface PlanTaskListProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  planName?: string;
  sessionState?: string | null;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed:   <CheckCircle2 size={13} className="text-emerald-500" />,
  in_progress: <Loader2 size={13} className="text-blue-400 animate-spin" />,
  ready:       <Circle size={13} className="text-blue-400" />,
  pending:     <Clock size={13} className="text-muted-foreground" />,
  failed:      <XCircle size={13} className="text-red-400" />,
  blocked:     <AlertTriangle size={13} className="text-amber-400" />,
};

export const PlanTaskList: React.FC<PlanTaskListProps> = ({
  tasks,
  selectedTaskId,
  onSelectTask,
  planName,
  sessionState,
}) => {
  if (tasks.length === 0 && sessionState !== 'planning') {
    return null;
  }

  return (
    <div className="flex flex-col">
      {/* Plan header */}
      {planName && (
        <div className="px-2.5 py-1.5 flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Plan</span>
          <span className="text-[10px] text-muted-foreground truncate flex-1">{planName}</span>
          {sessionState === 'executing' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </div>
      )}

      {/* Task rows */}
      {sessionState === 'planning' && tasks.length === 0 && (
        <div className="px-2.5 py-2 text-[10px] text-muted-foreground flex items-center gap-2">
          <Loader2 size={11} className="animate-spin" />
          Creating plan…
        </div>
      )}

      <div className="space-y-0.5 px-1">
        {tasks.map(task => (
          <button
            key={task.id}
            onClick={() => onSelectTask(task.id)}
            className={cn(
              'w-full flex flex-col gap-0 rounded-md text-left transition-colors cursor-pointer',
              selectedTaskId === task.id
                ? 'bg-primary/10 text-primary'
                : 'text-foreground/80 hover:bg-accent'
            )}
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="shrink-0">{STATUS_ICON[task.status] ?? STATUS_ICON.pending}</span>
              <span className="text-xs truncate flex-1">{task.title}</span>
              {task.assignedRole && (
                <span className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wide shrink-0">
                  {task.assignedRole.slice(0, 4)}
                </span>
              )}
              <TaskTimeLabel status={task.status} createdAt={task.createdAt} />
            </div>
            <TaskProgressBar status={task.status} />
          </button>
        ))}
      </div>
    </div>
  );
};
