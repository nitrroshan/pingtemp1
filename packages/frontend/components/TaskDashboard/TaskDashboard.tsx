/**
 * TaskDashboard — real-time task status panel
 *
 * Shows all tasks across all agents with:
 * - Colored status chips (ready / in-progress / completed / failed)
 * - Progress percentage
 * - Per-role grouping
 * - Quick actions (start, complete, cancel)
 */

import React, { useMemo } from 'react';
import {
  Play, Loader2, CheckCircle, AlertCircle, Clock, GitBranch,
  BarChart3, ChevronDown, ChevronRight
} from 'lucide-react';
import type { Task, TaskStatus } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Status config
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus, {
  label: string;
  icon: React.ElementType;
  chip: string;
  row: string;
  animate?: boolean;
}> = {
  ready: {
    label: 'Ready',
    icon: Play,
    chip: 'bg-green-900/40 border-green-700/60 text-green-400',
    row: 'border-l-green-500',
  },
  pending: {
    label: 'Pending',
    icon: Clock,
    chip: 'bg-yellow-900/30 border-yellow-700/50 text-yellow-400',
    row: 'border-l-yellow-600',
  },
  in_progress: {
    label: 'Running',
    icon: Loader2,
    chip: 'bg-blue-900/40 border-blue-700/60 text-blue-400',
    row: 'border-l-blue-500',
    animate: true,
  },
  completed: {
    label: 'Done',
    icon: CheckCircle,
    chip: 'bg-teal-900/30 border-teal-700/50 text-teal-400',
    row: 'border-l-teal-600',
  },
  failed: {
    label: 'Failed',
    icon: AlertCircle,
    chip: 'bg-red-900/30 border-red-700/50 text-red-400',
    row: 'border-l-red-600',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface StatusChipProps {
  status: TaskStatus;
  hasDependencies?: boolean;
}

const StatusChip: React.FC<StatusChipProps> = ({ status, hasDependencies }) => {
  const isBlocked = status === 'pending' && hasDependencies;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = isBlocked ? GitBranch : cfg.icon;
  const label = isBlocked ? 'Blocked' : cfg.label;
  const chip = isBlocked
    ? 'bg-orange-900/30 border-orange-700/50 text-orange-400'
    : cfg.chip;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${chip}`}>
      <Icon size={10} className={cfg.animate && !isBlocked ? 'animate-spin' : ''} />
      {label}
    </span>
  );
};

interface ProgressBarProps {
  completed: number;
  total: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ completed, total }) => {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-nexus-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-nexus-cyan transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface TaskDashboardProps {
  /** Flat list of all tasks (from all agents) */
  allTasks: Task[];
  onStartTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  onCancelTask?: (taskId: string) => void;
}

export const TaskDashboard: React.FC<TaskDashboardProps> = ({
  allTasks,
  onStartTask,
  onCompleteTask,
  onCancelTask,
}) => {
  const [expandedRoles, setExpandedRoles] = React.useState<Set<string>>(new Set());

  const toggleRole = (role: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  };

  // Group tasks by assignedRole
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      const role = t.assignedRole ?? 'unassigned';
      if (!map.has(role)) map.set(role, []);
      map.get(role)!.push(t);
    }
    return map;
  }, [allTasks]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { ready: 0, pending: 0, in_progress: 0, completed: 0, failed: 0 };
    for (const t of allTasks) {
      if (t.status in c) c[t.status as TaskStatus]++;
    }
    return c;
  }, [allTasks]);

  if (allTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
        <BarChart3 size={28} className="opacity-40" />
        <p className="text-sm">No tasks yet. Submit a goal to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map(s => (
          counts[s] > 0 && (
            <div key={s} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${STATUS_CONFIG[s].chip}`}>
              {counts[s]} {STATUS_CONFIG[s].label}
            </div>
          )
        ))}
      </div>

      {/* Overall progress */}
      <ProgressBar completed={counts.completed} total={allTasks.length} />

      {/* Per-role groups */}
      <div className="flex flex-col gap-3">
        {Array.from(grouped.entries()).map(([role, roleTasks]) => {
          const isExpanded = expandedRoles.has(role);
          const roleCompleted = roleTasks.filter(t => t.status === 'completed').length;
          const roleInProgress = roleTasks.filter(t => t.status === 'in_progress').length;

          return (
            <div key={role} className="rounded-xl border border-nexus-800 bg-nexus-900/50 overflow-hidden">
              {/* Role header */}
              <button
                onClick={() => toggleRole(role)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-nexus-800/40 transition-colors text-left"
              >
                {isExpanded
                  ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />
                  : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />
                }
                <span className="text-sm font-medium text-slate-200 capitalize flex-1">{role}</span>
                <div className="flex items-center gap-2">
                  {roleInProgress > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-700/50 text-blue-400 flex items-center gap-1">
                      <Loader2 size={9} className="animate-spin" />
                      {roleInProgress} running
                    </span>
                  )}
                  <span className="text-xs text-slate-500">{roleCompleted}/{roleTasks.length}</span>
                </div>
              </button>

              {/* Task rows */}
              {isExpanded && (
                <div className="border-t border-nexus-800">
                  {roleTasks.map(task => {
                    const hasDeps = Boolean(task.dependencies?.length);
                    const rowCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;

                    return (
                      <div
                        key={task.id}
                        className={`flex items-center gap-3 px-4 py-2.5 border-l-2 ${rowCfg.row} border-b border-nexus-800/60 last:border-b-0 hover:bg-nexus-800/20 transition-colors`}
                      >
                        <StatusChip status={task.status} hasDependencies={hasDeps} />

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate">{task.title}</p>
                          {task.description && (
                            <p className="text-[11px] text-slate-500 truncate">{task.description}</p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {task.status === 'ready' && onStartTask && (
                            <button
                              onClick={() => onStartTask(task.id)}
                              className="px-2 py-1 text-[11px] font-medium text-green-400 bg-green-900/30 hover:bg-green-900/50 border border-green-800/50 rounded transition-colors"
                            >
                              Start
                            </button>
                          )}
                          {task.status === 'in_progress' && (
                            <>
                              {onCompleteTask && (
                                <button
                                  onClick={() => onCompleteTask(task.id)}
                                  className="px-2 py-1 text-[11px] font-medium text-teal-400 bg-teal-900/30 hover:bg-teal-900/50 border border-teal-800/50 rounded transition-colors"
                                >
                                  Done
                                </button>
                              )}
                              {onCancelTask && (
                                <button
                                  onClick={() => onCancelTask(task.id)}
                                  className="px-2 py-1 text-[11px] font-medium text-red-400 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 rounded transition-colors"
                                >
                                  Cancel
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TaskDashboard;
