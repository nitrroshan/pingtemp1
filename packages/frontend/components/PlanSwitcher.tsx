/**
 * PlanSwitcher — popover for switching between plans.
 *
 * Shown in the top bar when a plan is active. Click plan name → popover
 * with recent plans, search, and actions.
 *
 * Pattern: Linear's project switcher / Notion's page switcher.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, Plus, FileText, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import type { PlanSummary } from './GoalScreen/PlanList';

interface PlanSwitcherProps {
  plans: PlanSummary[];
  activePlanId: string | null;
  planName?: string;
  sessionState?: string | null;
  onSelectPlan: (planId: string) => void;
  onNewGoal: () => void;
}

const STATUS_ICON: Record<string, string> = {
  active: '🟢',
  completed: '✅',
  paused: '⏸️',
  unknown: '⏳',
};

export const PlanSwitcher: React.FC<PlanSwitcherProps> = ({
  plans,
  activePlanId,
  planName,
  sessionState,
  onSelectPlan,
  onNewGoal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return plans;
    const q = search.toLowerCase();
    return plans.filter(p => p.goal.toLowerCase().includes(q));
  }, [plans, search]);

  const activePlans = filtered.filter(p => p.status === 'active');
  const recentPlans = filtered.filter(p => p.status !== 'active');

  if (!activePlanId) return null;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-foreground hover:bg-accent transition-colors cursor-pointer max-w-[280px]"
      >
        <FileText size={13} className="text-muted-foreground shrink-0" />
        <span className="truncate font-medium">{planName ?? 'Plan'}</span>
        {sessionState === 'executing' && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
        )}
        <ChevronDown size={12} className="text-muted-foreground shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-popover border border-border rounded-lg shadow-xl z-50">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted text-sm">
              <Search size={13} className="text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search plans…"
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Plans */}
          <div className="max-h-64 overflow-auto p-1.5">
            {activePlans.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active</div>
                {activePlans.map(plan => (
                  <PlanRow key={plan.planId} plan={plan} isActive={plan.planId === activePlanId} onClick={() => { onSelectPlan(plan.planId); setIsOpen(false); }} />
                ))}
              </>
            )}
            {recentPlans.length > 0 && (
              <>
                <div className="px-2 py-1 mt-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent</div>
                {recentPlans.map(plan => (
                  <PlanRow key={plan.planId} plan={plan} isActive={plan.planId === activePlanId} onClick={() => { onSelectPlan(plan.planId); setIsOpen(false); }} />
                ))}
              </>
            )}
            {filtered.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">No plans found</div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t border-border p-1.5">
            <button
              onClick={() => { onNewGoal(); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            >
              <Plus size={12} />
              New goal
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function PlanRow({ plan, isActive, onClick }: { plan: PlanSummary; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer text-left',
        isActive ? 'bg-primary/10 text-primary' : 'text-popover-foreground hover:bg-accent'
      )}
    >
      <span className="shrink-0 text-[10px]">{STATUS_ICON[plan.status] ?? '⏳'}</span>
      <span className="truncate flex-1">{plan.goal}</span>
      {plan.taskCount != null && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {plan.completedCount ?? 0}/{plan.taskCount}
        </span>
      )}
    </button>
  );
}
