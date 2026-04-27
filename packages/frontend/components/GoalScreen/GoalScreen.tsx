/**
 * GoalScreen — "What do you want to build?" landing page.
 *
 * Shown at `/` and `/teams/{teamId}` when no plan is active.
 * Centered layout, no sidebar.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { PlanList } from './PlanList';
import { RepoPicker } from './RepoPicker';
import type { Agent } from '../../types';

type GoalScreenProps = {
  teams: Agent[];
  activeTeamId: string | null;
  activePlanId: string | null;
  onSelectTeam: (teamId: string) => void;
  onSubmitGoal: (teamId: string, goal: string, repoUrl?: string, repoBranch?: string) => void;
  onSelectPlan: (planId: string) => void;
  onNavigateToTeams: () => void;
  onSignOut: () => void;
};

const EXAMPLES = [
  'Build a REST API for a notes app with auth and search',
  'Create a marketing analysis report for Q2',
  'Design a React dashboard with real-time charts',
];

export const GoalScreen: React.FC<GoalScreenProps> = ({
  teams,
  activeTeamId,
  activePlanId,
  onSelectTeam,
  onSubmitGoal,
  onSelectPlan,
  onNavigateToTeams,
  onSignOut,
}) => {
  const [goal, setGoal] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('main');
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedTeam = teams.find(t => t.id === activeTeamId);
  // Each goal gets its own planner (GoalManager) — never block submission
  const isSubmitting = false;

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [goal, adjustHeight]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isTeamDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsTeamDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isTeamDropdownOpen]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || !activeTeamId || !repoUrl.trim() || !repoBranch.trim() || isSubmitting) return;
    onSubmitGoal(activeTeamId, trimmed, repoUrl.trim(), repoBranch.trim());
    setGoal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar — minimal */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
            <defs>
              <linearGradient id="gs-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0ea5e9" />
                <stop offset="50%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="96" height="96" rx="22" fill="#0c1425" />
            <circle cx="50" cy="50" r="6" fill="white" opacity="0.95" />
            <circle cx="50" cy="50" r="24" stroke="url(#gs-grad)" strokeWidth="3" strokeLinecap="round" strokeDasharray="38 16" opacity="0.7" />
            <circle cx="50" cy="50" r="42" stroke="url(#gs-grad)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="60 20" opacity="0.9" />
          </svg>
          <span className="text-sm font-semibold text-foreground">Ping</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNavigateToTeams}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Manage Teams
          </button>
          <button
            onClick={onSignOut}
            className="text-xs text-muted-foreground hover:text-red-400 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex items-start justify-center overflow-auto pt-[12vh] pb-16 px-4">
        <div className="w-full max-w-xl">
          {/* Heading */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              What would you like to build?
            </h1>
            <p className="text-sm text-muted-foreground">
              Describe your goal and Ping will create a plan with tasks for your team.
            </p>
          </div>

          {/* Chat box — textarea + team selector + submit inside */}
          <form onSubmit={handleSubmit}>
            <div className={cn(
              'rounded-xl border bg-card overflow-hidden',
              'focus-within:ring-2 focus-within:ring-primary/40 transition-all',
              isSubmitting && 'opacity-60',
            )}>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Build a REST API for a notes app with auth and search..."
                disabled={isSubmitting}
                rows={3}
                className={cn(
                  'w-full px-4 pt-3 pb-2 bg-transparent text-foreground text-sm resize-none',
                  'placeholder:text-muted-foreground/60 focus:outline-none',
                  'min-h-[80px]',
                  isSubmitting && 'cursor-not-allowed',
                )}
              />

              {/* Bottom bar — team + submit only */}
              <div className="flex items-center gap-2 px-3 pb-3">
                {/* Team selector pill */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsTeamDropdownOpen(v => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-border/50 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
                  >
                    <span>{selectedTeam ? selectedTeam.name : 'Select team'}</span>
                    <ChevronDown size={12} />
                  </button>

                  {isTeamDropdownOpen && teams.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 max-h-48 overflow-auto">
                      {teams.map(team => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            onSelectTeam(team.id);
                            setIsTeamDropdownOpen(false);
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer',
                            team.id === activeTeamId
                              ? 'bg-primary/10 text-primary'
                              : 'text-popover-foreground hover:bg-accent',
                          )}
                        >
                          {team.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Submit button */}
                <Button
                  type="submit"
                  size="sm"
                  disabled={!goal.trim() || !activeTeamId || !repoUrl.trim() || !repoBranch.trim() || isSubmitting}
                  className="shrink-0 gap-1.5 h-7 px-3 text-xs"
                >
                  {isSubmitting ? (
                    <>
                      <Sparkles size={12} className="animate-pulse" />
                      Planning…
                    </>
                  ) : (
                    <>
                      <Send size={12} />
                      Start
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Repo + Branch — outside the chat box */}
            <div className="flex items-center gap-2 mt-3">
              <RepoPicker
                value={repoUrl}
                branch={repoBranch}
                onChange={(url, branch) => {
                  setRepoUrl(url);
                  setRepoBranch(branch);
                }}
                style={{ flex: 1 }}
              />
            </div>
          </form>

          {/* Example goals — below repo, only when textarea is empty */}
          {!goal && (
            <div className="flex flex-wrap gap-2 mt-3">
              {EXAMPLES.map(ex => (
                <button
                  key={ex}
                  onClick={() => setGoal(ex)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Recent plans */}
          <PlanList
            teamId={activeTeamId}
            activePlanId={activePlanId}
            onSelectPlan={onSelectPlan}
          />
        </div>
      </div>
    </div>
  );
};
