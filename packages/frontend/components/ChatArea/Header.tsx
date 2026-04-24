import React from 'react';
import { Bot, MessageSquare, ListChecks, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Agent, Task } from '../../types';

interface HeaderProps {
  agent: Agent;
  viewMode: 'chat' | 'tasks';
  tasks: Task[];
  /** When true, render slim toggle-only bar (PlanSwitcher above already shows identity) */
  compact?: boolean;
  onViewModeChange: (mode: 'chat' | 'tasks') => void;
  onClearHistory: () => void;
}

const Header: React.FC<HeaderProps> = ({
  agent,
  viewMode,
  tasks,
  compact = false,
  onViewModeChange,
  onClearHistory,
}) => {
  const pendingCount = tasks.filter(t => !t.completed).length;

  return (
    <div
      className={cn(
        'border-b border-border flex items-center justify-between bg-card/60 backdrop-blur-sm z-10 shrink-0',
        compact ? 'h-9 px-3' : 'h-12 px-4'
      )}
    >
      {/* Left: agent identity (hidden in compact mode — PlanSwitcher above shows it) */}
      {compact ? (
        <div />
      ) : (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <Bot size={14} className="text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">{agent.name}</h2>
            {agent.description && (
              <p className="text-[10px] text-muted-foreground truncate max-w-xs hidden sm:block">
                {agent.description}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Right: minimal segmented toggle + clear */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <div
          role="tablist"
          aria-label="Chat or tasks"
          className="flex items-center bg-secondary/60 rounded-md p-0.5"
        >
          <button
            role="tab"
            aria-selected={viewMode === 'chat'}
            onClick={() => onViewModeChange('chat')}
            title="Chat"
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-[5px] transition-all cursor-pointer',
              viewMode === 'chat'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare size={13} />
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'tasks'}
            onClick={() => onViewModeChange('tasks')}
            title="Tasks"
            className={cn(
              'relative flex items-center justify-center w-7 h-7 rounded-[5px] transition-all cursor-pointer',
              viewMode === 'tasks'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ListChecks size={13} />
            {pendingCount > 0 && viewMode !== 'tasks' && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center leading-none">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
        </div>

        {!compact && (
          <button
            onClick={onClearHistory}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            title="Clear chat history"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

export default Header;
