/**
 * PlanViewerPage — full-screen plan management UI
 *
 * Route: /plans
 *
 * Two-panel master-detail:
 *   Left (320px):  Plan list for selected team
 *   Center:        Task list/board for selected plan
 *   Right (320px): DetailPanel slide-over on task click (reuses existing component)
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft, ListTodo, LayoutGrid, ChevronDown, ChevronRight,
  RefreshCw, Bot, Circle, CheckCircle2, XCircle, Clock, Ban,
  Loader2, Play,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { Agent, Task, TaskStatus } from '../../types';
import type { PlanSummary } from '../GoalScreen/PlanList';
import { useGoalSessionStore } from '../../stores/goalSessionStore';
import { DetailPanel } from '../DetailPanel/DetailPanel';
import type { OrchestrationEvent } from '../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'board';

interface PlanViewerPageProps {
  teams: Agent[];
  selectedTeamId: string | null;
  allTasks: Task[];
  activePlanId: string | null;
  orchestrationLogs: OrchestrationEvent[];
  sessionState: string | null;
  autoExecuteEnabled: boolean;
  onBack: () => void;
  onSelectTeam: (teamId: string) => void;
  onOpenPlanChat: (teamId: string, planId: string) => void;
  onStartTask?: (taskId: string) => void;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus | string, { icon: React.ReactNode; color: string; label: string }> = {
  ready:       { icon: <Circle size={14} />,       color: 'text-blue-500',   label: 'Ready' },
  pending:     { icon: <Clock size={14} />,        color: 'text-muted-foreground', label: 'Pending' },
  in_progress: { icon: <Loader2 size={14} className="animate-spin" />, color: 'text-amber-500', label: 'In Progress' },
  completed:   { icon: <CheckCircle2 size={14} />, color: 'text-emerald-500', label: 'Completed' },
  failed:      { icon: <XCircle size={14} />,      color: 'text-red-500',    label: 'Failed' },
  discarded:   { icon: <Ban size={14} />,          color: 'text-muted-foreground', label: 'Discarded' },
};

const PLAN_STATUS_ICON: Record<string, string> = {
  active: '🟢', completed: '✅', paused: '⏸️', unknown: '⏳',
};

// ─── Plan Card (left panel) ─────────────────────────────────────────────────

function PlanCard({
  plan, isActive, onClick,
}: {
  plan: PlanSummary; isActive: boolean; onClick: () => void;
}) {
  const progress = plan.taskCount ? ((plan.completedCount ?? 0) / plan.taskCount) * 100 : 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-3 rounded-lg border transition-colors cursor-pointer',
        isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-border hover:bg-accent/50'
      )}
    >
      <p className="text-sm text-foreground line-clamp-2">{plan.goal}</p>
      <div className="flex items-center gap-2 mt-2">
        {plan.taskCount != null && (
          <>
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {plan.completedCount ?? 0}/{plan.taskCount}
            </span>
          </>
        )}
        <span className="text-[10px]">{PLAN_STATUS_ICON[plan.status] ?? '⏳'}</span>
      </div>
    </button>
  );
}

// ─── Role Group (list view) ─────────────────────────────────────────────────

function RoleGroup({
  role, tasks, selectedTaskId, onSelectTask, onStartTask, autoExecuteEnabled,
}: {
  role: string;
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onStartTask?: (taskId: string) => void;
  autoExecuteEnabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const completed = tasks.filter(t => t.status === 'completed').length;

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-card/30">
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/40 transition-colors cursor-pointer"
      >
        {isOpen ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{role}</span>
        <span className="text-[10px] text-muted-foreground">({tasks.length})</span>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">{completed}/{tasks.length}</span>
      </button>
      {isOpen && (
        <div className="px-1 pb-1 space-y-0.5">
          {tasks.map(task => {
            const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
            const isSelected = task.id === selectedTaskId;
            return (
              <button
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors text-left cursor-pointer',
                  isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-accent/60'
                )}
              >
                <span className={cfg.color}>{cfg.icon}</span>
                <span className="flex-1 text-xs text-foreground truncate">{task.title}</span>
                {task.status === 'ready' && !autoExecuteEnabled && onStartTask && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStartTask(task.id); }}
                    className="p-0.5 rounded text-blue-500 hover:bg-blue-500/10 transition-colors cursor-pointer"
                    title="Start task"
                  >
                    <Play size={11} />
                  </button>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Board View ─────────────────────────────────────────────────────────────

const BOARD_COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'ready',       label: 'Ready',       color: 'border-blue-500/40' },
  { status: 'in_progress', label: 'In Progress', color: 'border-amber-500/40' },
  { status: 'completed',   label: 'Completed',   color: 'border-emerald-500/40' },
  { status: 'failed',      label: 'Failed',      color: 'border-red-500/40' },
];

function TaskBoardView({
  tasks, selectedTaskId, onSelectTask, roleFilter,
}: {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  roleFilter: string | null;
}) {
  const filtered = roleFilter ? tasks.filter(t => t.assignedRole === roleFilter) : tasks;

  return (
    <div className="flex gap-3 p-3 overflow-x-auto h-full">
      {BOARD_COLUMNS.map(col => {
        const colTasks = filtered.filter(t => t.status === col.status);
        // Include pending in ready column (dimmed)
        const pendingTasks = col.status === 'ready' ? filtered.filter(t => t.status === 'pending') : [];
        return (
          <div key={col.status} className={cn('flex flex-col w-56 shrink-0 rounded-lg border-t-2', col.color, 'bg-card/30')}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold text-foreground">{col.label}</span>
              <span className="text-[10px] text-muted-foreground">{colTasks.length + pendingTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {colTasks.map(task => (
                <button
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className={cn(
                    'w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer',
                    task.id === selectedTaskId ? 'border-primary/40 bg-primary/5' : 'border-border/40 hover:bg-accent/50'
                  )}
                >
                  <p className="text-xs text-foreground line-clamp-2">{task.title}</p>
                  {task.assignedRole && (
                    <span className="text-[10px] text-muted-foreground mt-1 inline-block">{task.assignedRole}</span>
                  )}
                </button>
              ))}
              {pendingTasks.map(task => (
                <button
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className={cn(
                    'w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer opacity-50',
                    task.id === selectedTaskId ? 'border-primary/40 bg-primary/5' : 'border-border/40 hover:bg-accent/50'
                  )}
                >
                  <p className="text-xs text-foreground line-clamp-2">{task.title}</p>
                  {task.assignedRole && (
                    <span className="text-[10px] text-muted-foreground mt-1 inline-block">{task.assignedRole}</span>
                  )}
                </button>
              ))}
              {colTasks.length === 0 && pendingTasks.length === 0 && (
                <div className="text-[10px] text-muted-foreground/50 text-center py-4">No tasks</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Agents Bar ─────────────────────────────────────────────────────────────

function AgentsBar({
  tasks, activeRole, onSelectRole,
}: {
  tasks: Task[];
  activeRole: string | null;
  onSelectRole: (role: string | null) => void;
}) {
  const roles = useMemo(() => {
    const map = new Map<string, { total: number; working: number; completed: number; failed: number }>();
    for (const t of tasks) {
      const role = t.assignedRole ?? 'unassigned';
      const entry = map.get(role) ?? { total: 0, working: 0, completed: 0, failed: 0 };
      entry.total++;
      if (t.status === 'in_progress') entry.working++;
      if (t.status === 'completed') entry.completed++;
      if (t.status === 'failed') entry.failed++;
      map.set(role, entry);
    }
    return Array.from(map.entries()).map(([role, stats]) => ({ role, ...stats }));
  }, [tasks]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-card/50 shrink-0 overflow-x-auto">
      <button
        onClick={() => onSelectRole(null)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap',
          activeRole === null ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        )}
      >
        All ({tasks.length})
      </button>
      {roles.map(({ role, total, working, completed, failed }) => {
        const statusColor = failed > 0 ? 'bg-red-500' : working > 0 ? 'bg-amber-500 animate-pulse' : completed === total ? 'bg-emerald-500' : 'bg-muted-foreground/40';
        return (
          <button
            key={role}
            onClick={() => onSelectRole(activeRole === role ? null : role)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap',
              activeRole === role ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', statusColor)} />
            <Bot size={11} />
            {role}
            <span className="text-[10px] text-muted-foreground/70">({completed}/{total})</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function PlanViewerPage({
  teams, selectedTeamId, allTasks, activePlanId, orchestrationLogs,
  sessionState, autoExecuteEnabled,
  onBack, onSelectTeam, onOpenPlanChat, onStartTask,
}: PlanViewerPageProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(activePlanId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('ping:planviewer:view') as ViewMode) || 'list';
  });
  const [roleFilter, setRoleFilter] = useState<string | null>(null);

  // Load plans from goalSessionStore (server-backed)
  const storePlans = useGoalSessionStore(s => s.plans);
  const plans = useMemo(() => {
    if (!selectedTeamId) return [];
    return storePlans.map(p => ({
      planId: p.planId ?? p.goalId,
      goal: p.title,
      goalId: p.goalId,
      createdAt: p.createdAt,
      status: (p.state === 'done' ? 'completed' : p.state === 'executing' ? 'active' : 'unknown') as PlanSummary['status'],
      taskCount: p.taskCount,
      completedCount: p.completedCount,
    }));
  }, [selectedTeamId, storePlans]);

  // Auto-select first plan if none selected
  const effectivePlanId = selectedPlanId ?? plans[0]?.planId ?? null;

  // Group tasks by role
  const tasksByRole = useMemo(() => {
    const map = new Map<string, Task[]>();
    const filtered = roleFilter ? allTasks.filter(t => t.assignedRole === roleFilter) : allTasks;
    for (const task of filtered) {
      const role = task.assignedRole ?? 'unassigned';
      const list = map.get(role) ?? [];
      list.push(task);
      map.set(role, list);
    }
    return map;
  }, [allTasks, roleFilter]);

  const selectedTask = selectedTaskId ? allTasks.find(t => t.id === selectedTaskId) ?? null : null;
  const selectedPlan = effectivePlanId ? plans.find(p => p.planId === effectivePlanId) : null;

  const completedCount = allTasks.filter(t => t.status === 'completed').length;

  const handleSelectView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('ping:planviewer:view', mode);
  }, []);

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(prev => prev === taskId ? null : taskId);
  }, []);

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 h-11 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <span className="text-muted-foreground/40">·</span>
        <h1 className="text-sm font-semibold text-foreground">Plans</h1>

        {selectedTeam && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-xs text-muted-foreground">{selectedTeam.name}</span>
          </>
        )}

        <div className="flex-1" />

        {effectivePlanId && selectedTeamId && (
          <button
            onClick={() => onOpenPlanChat(selectedTeamId, effectivePlanId)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            Open in Chat
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Plan List */}
        <div className="w-72 border-r border-border shrink-0 flex flex-col">
          <div className="px-3 py-2 border-b border-border/60 shrink-0">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              All Plans
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {plans.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <ListTodo size={20} className="opacity-30" />
                <span className="text-xs">No plans yet</span>
              </div>
            ) : (
              plans.map(plan => (
                <PlanCard
                  key={plan.planId}
                  plan={plan}
                  isActive={plan.planId === effectivePlanId}
                  onClick={() => { setSelectedPlanId(plan.planId); setSelectedTaskId(null); setRoleFilter(null); }}
                />
              ))
            )}
          </div>
        </div>

        {/* Center: Task Detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {effectivePlanId && selectedPlan ? (
            <>
              {/* Plan header */}
              <div className="px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground line-clamp-2">{selectedPlan.goal}</h2>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {completedCount}/{allTasks.length} tasks · {tasksByRole.size} roles
                      {sessionState && sessionState !== 'idle' && (
                        <span className="ml-2 text-amber-500">{sessionState.replace('_', ' ')}</span>
                      )}
                    </p>
                  </div>

                  {/* View toggle */}
                  <div className="flex items-center border border-border rounded-md shrink-0">
                    <button
                      onClick={() => handleSelectView('list')}
                      className={cn(
                        'p-1.5 transition-colors cursor-pointer rounded-l-md',
                        viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                      )}
                      title="List view"
                    >
                      <ListTodo size={14} />
                    </button>
                    <button
                      onClick={() => handleSelectView('board')}
                      className={cn(
                        'p-1.5 transition-colors cursor-pointer rounded-r-md',
                        viewMode === 'board' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                      )}
                      title="Board view"
                    >
                      <LayoutGrid size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Task content */}
              <div className="flex-1 overflow-y-auto">
                {allTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                    <ListTodo size={24} className="opacity-30" />
                    <span className="text-xs">No tasks in this plan</span>
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="p-3 space-y-2">
                    {Array.from(tasksByRole.entries()).map(([role, tasks]) => (
                      <RoleGroup
                        key={role}
                        role={role}
                        tasks={tasks}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={handleSelectTask}
                        onStartTask={onStartTask}
                        autoExecuteEnabled={autoExecuteEnabled}
                      />
                    ))}
                  </div>
                ) : (
                  <TaskBoardView
                    tasks={allTasks}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={handleSelectTask}
                    roleFilter={roleFilter}
                  />
                )}
              </div>

              {/* Agents bar */}
              <AgentsBar tasks={allTasks} activeRole={roleFilter} onSelectRole={setRoleFilter} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <ListTodo size={28} className="opacity-20" />
              <span className="text-sm">Select a plan to view tasks</span>
            </div>
          )}
        </div>

        {/* Right: DetailPanel (task detail on click) */}
        <AnimatePresence>
          {selectedTask && (
            <DetailPanel
              logs={orchestrationLogs}
              activeAgents={[]}
              allTasks={allTasks}
              currentPlanName={selectedPlan?.goal}
              activePlanId={effectivePlanId}
              agentName={selectedTask.assignedRole ?? undefined}
              isManager={false}
              onClose={() => setSelectedTaskId(null)}
              selectedTask={selectedTask}
              onSelectTask={handleSelectTask}
              onStartTask={onStartTask}
              autoExecuteEnabled={autoExecuteEnabled}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default PlanViewerPage;
