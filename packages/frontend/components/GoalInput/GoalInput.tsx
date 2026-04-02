/**
 * GoalInput — goal submission UI
 *
 * "What do you want to build?" → submit → planner starts
 * Redesigned with zinc/shadcn design system.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Target, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

interface GoalInputProps {
  onSubmit: (goal: string) => void;
  disabled?: boolean;
  placeholder?: string;
  sessionState?: string | null;
}

const EXAMPLE_GOALS = [
  "Build a REST API with authentication",
  "Create a marketing analysis report for Q2",
  "Design a React dashboard with real-time charts",
];

const STATUS: Record<string, { label: string; color: string }> = {
  planning:         { label: 'Planner is creating a plan…', color: 'text-yellow-400' },
  executing:        { label: 'Tasks are executing…',       color: 'text-blue-400' },
  awaiting_approval:{ label: 'Plan ready — check below',   color: 'text-orange-400' },
  completed:        { label: 'Session completed',           color: 'text-emerald-400' },
};

export const GoalInput: React.FC<GoalInputProps> = ({
  onSubmit,
  disabled = false,
  placeholder = 'What do you want to build?',
  sessionState,
}) => {
  const [goal, setGoal] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [goal, adjustHeight]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setGoal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const status = sessionState ? STATUS[sessionState] : null;
  const isWorking = sessionState === 'executing' || sessionState === 'planning';
  const canSubmit = goal.trim().length > 0 && !disabled;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
          <Target size={14} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Set a Goal</h2>
        </div>
        {status && (
          <span className={cn('text-xs font-medium', status.color)}>
            {status.label}
          </span>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit}>
        <div className={cn(
          'rounded-xl border bg-card transition-colors',
          canSubmit ? 'border-primary/40' : 'border-border',
          disabled && 'opacity-60'
        )}>
          <textarea
            ref={textareaRef}
            value={goal}
            onChange={e => { setGoal(e.target.value); adjustHeight(); }}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Waiting for current session…' : placeholder}
            disabled={disabled}
            rows={2}
            className="w-full bg-transparent px-3.5 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none leading-relaxed min-h-[56px]"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Sparkles size={11} />
              <span className="text-[10px]">Enter to submit · Shift+Enter for newline</span>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className="h-7 text-xs"
            >
              {isWorking ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Submit
            </Button>
          </div>
        </div>
      </form>

      {/* Example goals */}
      {!goal && !sessionState && (
        <div className="mt-3 flex flex-col gap-1">
          {EXAMPLE_GOALS.map((eg, i) => (
            <button
              key={i}
              onClick={() => setGoal(eg)}
              className="text-left text-xs px-3 py-1.5 rounded-lg bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer border border-transparent hover:border-border"
            >
              {eg}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default GoalInput;
