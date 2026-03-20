import React from 'react';
import { Server } from 'lucide-react';
import { ActiveAgentState } from '../../types';
import AgentCard from './AgentCard';

interface SwarmViewProps {
  activeAgents: ActiveAgentState[];
}

const SwarmView: React.FC<SwarmViewProps> = ({ activeAgents }) => {
  if (activeAgents.length === 0) {
    return (
      <div className="absolute inset-0 overflow-y-auto scrollbar-thin p-4">
        <div className="border border-nexus-800 border-dashed rounded-lg p-8 text-center mt-10 opacity-60">
          <Server size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-xs text-slate-500 font-mono">No active agents deployed.</p>
          <p className="text-[10px] text-slate-600 mt-1">Assign tasks to populate the swarm.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-thin p-4 space-y-3">
      {activeAgents.map(agent => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
      {/* Bottom spacer */}
      <div className="h-4" />
    </div>
  );
};

export default SwarmView;
