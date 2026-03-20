
import React, { useState } from 'react';
import { ActiveAgentState, OrchestrationEvent } from '../../types';
import { PanelHeader, PanelTabs, SwarmView, EventsView } from '.';

interface AgentManagerPanelProps {
  activeAgents: ActiveAgentState[];
  logs: OrchestrationEvent[];
  onClose: () => void;
}

const AgentManagerPanel: React.FC<AgentManagerPanelProps> = ({ activeAgents, logs, onClose }) => {
  const [activeTab, setActiveTab] = useState<'swarm' | 'events'>('swarm');

  return (
    <div className="w-[380px] h-full bg-nexus-950 border-l border-nexus-800 flex flex-col flex-shrink-0 animate-in slide-in-from-right duration-300 shadow-2xl z-20">
      
      {/* Header */}
      <PanelHeader onClose={onClose} />

      {/* Tabs */}
      <PanelTabs
        activeTab={activeTab}
        activeAgentsCount={activeAgents.length}
        onTabChange={setActiveTab}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative bg-nexus-950/50">
        {activeTab === 'swarm' && <SwarmView activeAgents={activeAgents} />}
        {activeTab === 'events' && <EventsView logs={logs} />}
      </div>
    </div>
  );
};

export default AgentManagerPanel;
