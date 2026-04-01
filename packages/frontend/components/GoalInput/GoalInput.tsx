/**
 * GoalInput — dedicated goal submission UI
 *
 * "What do you want to build?" → submit → planner starts
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Target } from 'lucide-react';

interface GoalInputProps {
  /** Called when user submits a goal */
  onSubmit: (goal: string) => void;
  /** Disabled while the planner is working */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Current session state — used to show contextual hints */
  sessionState?: string | null;
}

const EXAMPLE_GOALS = [
  "Build a REST API with authentication and user management",
  "Create a marketing analysis report for Q2 2026",
  "Design and implement a React dashboard with real-time charts",
];

export const GoalInput: React.FC<GoalInputProps> = ({
  onSubmit,
  disabled = false,
  placeholder = "What do you want to build?",
  sessionState,
}) => {
  const [goal, setGoal] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [goal]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setGoal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isExecuting = sessionState === 'executing';
  const isPlanning = sessionState === 'planning';
  const isAwaiting = sessionState === 'awaiting_approval';

  const statusMessage = isExecuting
    ? '⚡ Tasks are executing...'
    : isPlanning
    ? '🤔 Planner is creating a plan...'
    : isAwaiting
    ? '📋 Plan ready for approval'
    : null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-nexus-800 rounded-lg text-nexus-cyan">
          <Target size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Set a Goal</h2>
          <p className="text-xs text-slate-500">Describe what you want to accomplish</p>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-800/40 text-xs text-blue-300">
          {statusMessage}
        </div>
      )}

      {/* Input area */}
      <form onSubmit={handleSubmit} className="relative">
        <div className={`
          rounded-xl border transition-colors bg-nexus-900
          ${disabled
            ? 'border-nexus-700 opacity-60'
            : 'border-nexus-700 focus-within:border-nexus-cyan'}
        `}>
          <textarea
            ref={textareaRef}
            value={goal}
            onChange={e => setGoal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Waiting for current task to complete...' : placeholder}
            disabled={disabled}
            rows={2}
            className="
              w-full bg-transparent px-4 pt-3 pb-2 text-sm text-slate-200
              placeholder-slate-500 resize-none focus:outline-none
              leading-relaxed min-h-[60px]
            "
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <Sparkles size={12} className="text-slate-600" />
              <span className="text-xs text-slate-600">Press Enter to submit</span>
            </div>
            <button
              type="submit"
              disabled={!goal.trim() || disabled}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                bg-nexus-cyan text-nexus-950
                disabled:opacity-40 disabled:cursor-not-allowed
                hover:bg-nexus-teal transition-colors
              "
            >
              <Send size={12} />
              Submit Goal
            </button>
          </div>
        </div>
      </form>

      {/* Example goals (only when empty and idle) */}
      {!goal && !sessionState && (
        <div className="mt-4">
          <p className="text-xs text-slate-600 mb-2 uppercase tracking-wider">Examples</p>
          <div className="flex flex-col gap-1.5">
            {EXAMPLE_GOALS.map((eg, i) => (
              <button
                key={i}
                onClick={() => setGoal(eg)}
                className="
                  text-left text-xs px-3 py-2 rounded-lg
                  bg-nexus-900/50 border border-nexus-800
                  text-slate-400 hover:text-slate-200 hover:border-nexus-700
                  transition-colors cursor-pointer
                "
              >
                {eg}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalInput;
