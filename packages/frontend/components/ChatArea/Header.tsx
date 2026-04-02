import React from 'react';
import { Bot, MessageSquare, ListTodo, PanelRight, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Agent, Task } from '../../types';

interface HeaderProps {
  agent: Agent;
  viewMode: 'chat' | 'tasks';
  tasks: Task[];
  showPanelToggle?: boolean;
  isPanelOpen?: boolean;
  autoExecuteEnabled?: boolean;
  onViewModeChange: (mode: 'chat' | 'tasks') => void;
  onTogglePanel?: () => void;
  onToggleAutoExecute?: () => void;
  onClearHistory: () => void;
}

const Header: React.FC<HeaderProps> = ({
  agent,
  viewMode,
  tasks,
  showPanelToggle,
  isPanelOpen,
  autoExecuteEnabled = true,
  onViewModeChange,
  onTogglePanel,
  onToggleAutoExecute,
  onClearHistory,
}) => {
  const pendingCount = tasks.filter(t => !t.completed).length;

  return (
    <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-card/80 backdrop-blur-sm z-10 shrink-0">
      {/* Agent info */}
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

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* View toggle */}
        <div className="flex items-center bg-secondary rounded-lg p-0.5">
          {(['chat', 'tasks'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                viewMode === mode
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {mode === 'chat' ? <MessageSquare size={11} /> : <ListTodo size={11} />}
              {mode === 'chat' ? 'Chat' : 'Tasks'}
              {mode === 'tasks' && pendingCount > 0 && (
                <span className="bg-primary/20 text-primary text-[9px] px-1 rounded">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Auto-execute toggle */}
        {onToggleAutoExecute && (
          <button
            onClick={onToggleAutoExecute}
            title={autoExecuteEnabled ? 'Auto-execute ON' : 'Auto-execute OFF'}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer',
              autoExecuteEnabled
                ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <div className={cn(
              'w-7 h-3.5 rounded-full relative transition-colors',
              autoExecuteEnabled ? 'bg-emerald-500' : 'bg-muted'
            )}>
              <div className={cn(
                'absolute w-2.5 h-2.5 rounded-full bg-white top-0.5 transition-all',
                autoExecuteEnabled ? 'left-[calc(100%-12px)]' : 'left-0.5'
              )} />
            </div>
            <span className="hidden sm:inline">Auto</span>
          </button>
        )}

        {/* Panel toggle */}
        {showPanelToggle && (
          <button
            onClick={onTogglePanel}
            className={cn(
              'p-1.5 rounded-md text-xs transition-colors cursor-pointer',
              isPanelOpen
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            title="Toggle logs panel"
          >
            <PanelRight size={14} />
          </button>
        )}

        {/* Clear history */}
        <button
          onClick={onClearHistory}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          title="Clear chat history"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default Header;
