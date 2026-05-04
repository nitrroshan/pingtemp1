/**
 * PlanList — shows recent plans for the active team.
 *
 * v1.0: reads from sessionStorage (no backend goals endpoint yet).
 * v2.0: will use GET /api/v2/teams/{id}/goals when that endpoint ships.
 */

import React, { useMemo } from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import { useGoalSessionStore } from '../../stores/goalSessionStore';

export type PlanSummary = {
  goalId: string;
  goal: string;
  createdAt: number;
  status: 'active' | 'completed' | 'paused' | 'unknown';
  taskCount?: number;
  completedCount?: number;
};

type PlanListProps = {
  teamId: string | null;
  activeGoalId: string | null;
  onSelectGoal: (goalId: string) => void;
};

const STATUS_ICON: Record<string, string> = {
  active: '🟢',
  completed: '✅',
  paused: '⏸️',
  unknown: '⏳',
};

export const PlanList: React.FC<PlanListProps> = ({ teamId, activeGoalId, onSelectGoal }) => {
  const storePlans = useGoalSessionStore(s => s.plans);

  const plans = useMemo(() => {
    if (!teamId) return [];
    // Map from types.ts PlanSummary (title, state) to PlanList PlanSummary (goal, status)
    return storePlans.map(p => ({
      goalId: p.goalId,
      goal: p.title,
      createdAt: p.createdAt,
      status: (p.state === 'done' ? 'completed' : p.state === 'executing' ? 'active' : 'unknown') as PlanSummary['status'],
      taskCount: p.taskCount,
      completedCount: p.completedCount,
    }));
  }, [teamId, storePlans]);

  if (!teamId || plans.length === 0) {
    return null;
  }

  return (
    <div className="w-full mt-6">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
        Recent Plans
      </h3>
      <div className="space-y-1.5">
        {plans.map(plan => (
          <button
            key={plan.goalId}
            onClick={() => onSelectGoal(plan.goalId)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer group flex items-center gap-3 ${
              plan.goalId === activeGoalId
                ? 'border-primary/40 bg-primary/5'
                : 'border-border hover:bg-accent/50 hover:border-border/80'
            }`}
          >
            <FileText size={16} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">{plan.goal}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {plan.taskCount != null
                  ? `${plan.completedCount ?? 0}/${plan.taskCount} tasks`
                  : 'No tasks yet'
                }
                {' · '}
                {STATUS_ICON[plan.status] ?? '⏳'} {plan.status}
              </p>
            </div>
            <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};
