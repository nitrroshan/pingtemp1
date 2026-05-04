/**
 * SidebarPlanList — Shows all plans when multiple plans exist (Phase 4).
 *
 * Only renders when plans.length >= 2 (single plan = no section needed).
 * Click a plan to switch the active view. Status badges update in real-time
 * via goal:stateChange socket events.
 */

import React from 'react';
import { CheckCircle2, Circle, Clock, Loader2, Pause, AlertCircle, Plus } from 'lucide-react';
import type { PlanSummary } from '../../types';

interface SidebarPlanListProps {
  plans: PlanSummary[];
  activePlanGoalId: string | null;
  onSelectPlan: (goalId: string) => void;
  onNewPlan?: () => void;
}

const STATE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  executing:          { icon: <Loader2 size={12} className="animate-spin" />, color: 'text-emerald-500', label: 'running' },
  queued:             { icon: <Clock size={12} />,        color: 'text-amber-500',   label: 'queued' },
  awaiting_approval:  { icon: <Pause size={12} />,        color: 'text-blue-500',    label: 'approval' },
  gathering:          { icon: <Circle size={12} />,        color: 'text-blue-400',    label: 'planning' },
  researching:        { icon: <Circle size={12} />,        color: 'text-blue-400',    label: 'researching' },
  done:               { icon: <CheckCircle2 size={12} />,  color: 'text-emerald-500', label: 'done' },
  idle:               { icon: <Circle size={12} />,        color: 'text-muted-foreground', label: 'idle' },
};

export function SidebarPlanList({ plans, activePlanGoalId, onSelectPlan, onNewPlan }: SidebarPlanListProps) {
  // Only show when 2+ plans exist
  if (plans.length < 2) return null;

  return (
    <div className="px-2 py-1.5">
      <div className="flex items-center justify-between px-1.5 mb-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Plans
        </span>
        {onNewPlan && (
          <button
            onClick={onNewPlan}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-0.5"
            title="New Plan"
          >
            <Plus size={10} />
            <span>New</span>
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {plans.map((plan) => {
          const config = STATE_CONFIG[plan.state] || STATE_CONFIG.idle;
          const isActive = plan.goalId === activePlanGoalId;

          return (
            <button
              key={plan.goalId}
              onClick={() => onSelectPlan(plan.goalId)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'hover:bg-accent/60 text-muted-foreground'
              }`}
            >
              <span className={config.color}>{config.icon}</span>
              <span className="flex-1 text-xs font-medium truncate">
                {plan.title || plan.goalId}
              </span>
              {plan.taskCount > 0 && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {plan.completedCount}/{plan.taskCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SidebarPlanList;
