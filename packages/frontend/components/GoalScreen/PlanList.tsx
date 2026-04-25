/**
 * PlanList — shows recent plans for the active team.
 *
 * v1.0: reads from localStorage (no backend goals endpoint yet).
 * v2.0: will use GET /api/v2/teams/{id}/goals when that endpoint ships.
 */

import React, { useMemo } from 'react';
import { FileText, ChevronRight } from 'lucide-react';

export type PlanSummary = {
  planId: string;
  goal: string;
  goalId?: string;
  createdAt: number;
  status: 'active' | 'completed' | 'paused' | 'unknown';
  taskCount?: number;
  completedCount?: number;
};

type PlanListProps = {
  teamId: string | null;
  activePlanId: string | null;
  onSelectPlan: (planId: string) => void;
};

const STATUS_ICON: Record<string, string> = {
  active: '🟢',
  completed: '✅',
  paused: '⏸️',
  unknown: '⏳',
};

function getStoredPlans(teamId: string): PlanSummary[] {
  try {
    const raw = localStorage.getItem(`ping:plans:${teamId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePlan(teamId: string, plan: PlanSummary) {
  const plans = getStoredPlans(teamId);
  const existing = plans.findIndex(p => p.planId === plan.planId);
  if (existing >= 0) {
    plans[existing] = plan;
  } else {
    plans.unshift(plan);
  }
  // Keep max 20 plans
  localStorage.setItem(`ping:plans:${teamId}`, JSON.stringify(plans.slice(0, 20)));
}

export const PlanList: React.FC<PlanListProps> = ({ teamId, activePlanId, onSelectPlan }) => {
  const plans = useMemo(() => {
    if (!teamId) return [];
    return getStoredPlans(teamId);
  }, [teamId]);

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
            key={plan.planId}
            onClick={() => onSelectPlan(plan.planId)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer group flex items-center gap-3 ${
              plan.planId === activePlanId
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
