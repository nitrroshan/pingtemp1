import React from 'react';
import { Bot, MessageSquare, ListTodo, PanelRight, Trash2 } from 'lucide-react';
import { Agent, Task } from '../../types';

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
  onClearHistory
}) => {
  return (
    <div className="h-20 border-b border-nexus-800 flex items-center justify-between px-6 bg-nexus-950/80 backdrop-blur-sm z-10 sticky top-0">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-nexus-800 flex items-center justify-center text-nexus-cyan border border-nexus-700 shadow-inner">
          <Bot size={20} />
        </div>
        <div>
          <h2 className="font-semibold text-slate-100 text-lg">{agent.name}</h2>
          <p className="text-xs text-slate-500 truncate max-w-md">{agent.description}</p>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {/* View Toggle */}
        <div className="flex p-1 bg-nexus-900 rounded-lg border border-nexus-800">
          <button 
            onClick={() => onViewModeChange('chat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              viewMode === 'chat' ? 'bg-nexus-800 text-nexus-cyan shadow-sm' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <MessageSquare size={14} />
            Chat
          </button>
          <button 
            onClick={() => onViewModeChange('tasks')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              viewMode === 'tasks' ? 'bg-nexus-800 text-nexus-cyan shadow-sm' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <ListTodo size={14} />
            Tasks
            {tasks.length > 0 && (
              <span className="bg-nexus-950 text-nexus-cyan px-1.5 py-0.5 rounded text-[9px] border border-nexus-800/50">
                {tasks.filter(t => !t.completed).length}
              </span>
            )}
          </button>
        </div>

        <div className="w-px h-6 bg-nexus-800" />

        {/* Auto Execute Toggle */}
        {onToggleAutoExecute && (
          <button
            onClick={onToggleAutoExecute}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
              autoExecuteEnabled 
                ? 'bg-nexus-800 text-green-400 border-green-700/50' 
                : 'bg-nexus-900 text-slate-500 border-nexus-800 hover:text-slate-300'
            }`}
            title={autoExecuteEnabled ? 'Auto-execute enabled - tasks run automatically' : 'Auto-execute disabled - manual approval required'}
          >
            <div className={`w-8 h-4 rounded-full relative transition-colors ${autoExecuteEnabled ? 'bg-green-600' : 'bg-nexus-700'}`}>
              <div className={`absolute w-3 h-3 rounded-full bg-white top-0.5 transition-all ${autoExecuteEnabled ? 'right-0.5' : 'left-0.5'}`} />
            </div>
            <span className="text-xs">Auto</span>
          </button>
        )}

        {/* Panel Toggle */}
        {showPanelToggle && (
          <button
            onClick={onTogglePanel}
            className={`p-2 rounded-lg transition-colors border ${
              isPanelOpen ? 'bg-nexus-800 text-nexus-cyan border-nexus-700' : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-nexus-900'
            }`}
            title="Toggle Orchestration Panel"
          >
            <PanelRight size={18} />
          </button>
        )}

        <button 
          onClick={onClearHistory}
          className="p-2 text-slate-500 hover:text-red-400 hover:bg-nexus-900 rounded-lg transition-colors"
          title="Clear History"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
};

export default Header;
