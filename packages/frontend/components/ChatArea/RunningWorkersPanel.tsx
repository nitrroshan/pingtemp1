/**
 * RunningWorkersPanel — Shows active workers for a role at the top of ChatAgent R1 Chat.
 * 
 * Only active (in_progress) tasks shown, sorted last-started first.
 * Three states: collapsed (32px) → compact (≤3 rows) → full view overlay.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight, X } from 'lucide-react';
import type { Task } from '../../types';

interface RunningWorkersPanelProps {
  tasks: Task[];
  role: string;
  onJumpToTask: (taskId: string) => void;
}

function formatElapsed(createdAt?: number): string {
  if (!createdAt) return '';
  const ms = Date.now() - createdAt;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '< 1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export const RunningWorkersPanel: React.FC<RunningWorkersPanelProps> = ({
  tasks,
  role,
  onJumpToTask,
}) => {
  const [state, setState] = useState<'collapsed' | 'compact' | 'full'>('compact');

  // Only active workers, sorted last-started first
  const activeTasks = tasks
    .filter(t => t.assignedRole?.toLowerCase() === role.toLowerCase() && t.status === 'in_progress')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (activeTasks.length === 0) return null;

  // Collapsed: single line
  if (state === 'collapsed') {
    return (
      <button
        onClick={() => setState('compact')}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/30 border-b border-border cursor-pointer transition-colors w-full"
      >
        <ChevronRight size={12} />
        <span className="text-emerald-400 font-medium">▶ {activeTasks.length} active</span>
        <span className="text-muted-foreground ml-auto text-[10px]">expand</span>
      </button>
    );
  }

  // Full view overlay
  if (state === 'full') {
    return (
      <div className="border-b border-border bg-card/80 backdrop-blur-sm" style={{ maxHeight: '50vh' }}>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Active Workers ({activeTasks.length})
          </span>
          <button
            onClick={() => setState('compact')}
            className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(50vh - 32px)' }}>
          {activeTasks.map(task => (
            <WorkerRow key={task.id} task={task} onJump={onJumpToTask} />
          ))}
        </div>
      </div>
    );
  }

  // Compact: max 3 rows
  const visibleTasks = activeTasks.slice(0, 3);
  const remaining = activeTasks.length - 3;

  return (
    <div className="border-b border-border bg-muted/20">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Active ({activeTasks.length})
        </span>
        <div className="flex items-center gap-1">
          {activeTasks.length > 3 && (
            <button
              onClick={() => setState('full')}
              className="text-[9px] text-primary hover:underline cursor-pointer"
            >
              full
            </button>
          )}
          <button
            onClick={() => setState('collapsed')}
            className="text-[9px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            hide
          </button>
        </div>
      </div>
      {visibleTasks.map(task => (
        <WorkerRow key={task.id} task={task} onJump={onJumpToTask} />
      ))}
      {remaining > 0 && (
        <button
          onClick={() => setState('full')}
          className="w-full text-center text-[9px] text-muted-foreground py-1 hover:text-foreground cursor-pointer border-t border-border/50"
        >
          {remaining} more…
        </button>
      )}
    </div>
  );
};

function WorkerRow({ task, onJump }: { task: Task; onJump: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 hover:bg-accent/50 group text-xs">
      <span className="text-emerald-400">▶</span>
      <span className="truncate flex-1 text-foreground/80">{task.title || task.id}</span>
      <span className="text-[9px] text-muted-foreground shrink-0">{formatElapsed(task.createdAt)}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onJump(task.id); }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-opacity"
        title="Jump to task stream"
      >
        <ArrowRight size={11} />
      </button>
    </div>
  );
}
