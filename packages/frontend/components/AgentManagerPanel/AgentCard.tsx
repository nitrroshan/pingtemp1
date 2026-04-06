import React from 'react';
import { ActiveAgentState } from '../../types';

interface AgentCardProps {
  agent: ActiveAgentState;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent }) => {
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-sm hover:border-primary/30 transition-colors group animate-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-muted flex items-center justify-center text-foreground/80 border border-border shadow-inner">
            <span className="text-[10px] font-bold">{agent.name.charAt(0)}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-foreground block leading-tight">{agent.name}</span>
            <span className="text-[9px] text-muted-foreground font-mono">ID: {agent.id.substring(0,6)}</span>
          </div>
        </div>
        {agent.status === 'working' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 font-mono uppercase animate-pulse flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-amber-500" />
            Working
          </span>
        )}
        {agent.status === 'completed' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-500 border border-green-500/20 font-mono uppercase flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-green-500" />
            Done
          </span>
        )}
        {agent.status === 'idle' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border font-mono uppercase flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-muted-foreground" />
            Idle
          </span>
        )}
      </div>
      
      <div className="space-y-2 pl-1">
        <div className="bg-muted/50 rounded p-2 border border-border/50">
          <p className="text-[9px] text-primary/70 uppercase font-bold mb-1 tracking-wide">Current Task</p>
          <p className="text-xs text-foreground/80 leading-snug font-mono">{agent.currentTask}</p>
        </div>
        
        <div className="flex gap-2.5 pt-1">
          <div className="w-0.5 bg-border rounded-full my-1" />
          <div>
            <p className="text-[9px] text-muted-foreground/70 uppercase font-bold mb-0.5">Strategy</p>
            <p className="text-[11px] text-muted-foreground italic leading-snug">"{agent.reasoning}"</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentCard;
