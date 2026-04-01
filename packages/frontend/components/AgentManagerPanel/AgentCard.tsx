import React from 'react';
import { ActiveAgentState } from '../../types';

interface AgentCardProps {
  agent: ActiveAgentState;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent }) => {
  return (
    <div className="bg-nexus-900 border border-nexus-800 rounded-lg p-3 shadow-sm hover:border-nexus-700 transition-colors group animate-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-nexus-800 flex items-center justify-center text-slate-300 border border-nexus-700 shadow-inner">
            <span className="text-[10px] font-bold">{agent.name.charAt(0)}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-slate-200 block leading-tight">{agent.name}</span>
            <span className="text-[9px] text-slate-500 font-mono">ID: {agent.id.substring(0,6)}</span>
          </div>
        </div>
        {agent.status === 'working' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono uppercase animate-pulse flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-amber-500" />
            Working
          </span>
        )}
        {agent.status === 'completed' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 border border-green-500/20 font-mono uppercase flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-green-500" />
            Done
          </span>
        )}
        {agent.status === 'idle' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 border border-slate-500/20 font-mono uppercase flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-slate-500" />
            Idle
          </span>
        )}
      </div>
      
      <div className="space-y-2 pl-1">
        <div className="bg-nexus-950 rounded p-2 border border-nexus-800/50">
          <p className="text-[9px] text-nexus-cyan/70 uppercase font-bold mb-1 tracking-wide">Current Task</p>
          <p className="text-xs text-slate-300 leading-snug font-mono">{agent.currentTask}</p>
        </div>
        
        <div className="flex gap-2.5 pt-1">
          <div className="w-0.5 bg-nexus-800 rounded-full my-1" />
          <div>
            <p className="text-[9px] text-slate-600 uppercase font-bold mb-0.5">Strategy</p>
            <p className="text-[11px] text-slate-400 italic leading-snug">"{agent.reasoning}"</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentCard;
