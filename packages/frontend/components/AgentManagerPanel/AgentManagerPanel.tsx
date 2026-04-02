
import React, { useState } from 'react';
import { Activity } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import type { ActiveAgentState, OrchestrationEvent } from '../../types';
import { PanelTabs, SwarmView, EventsView } from '.';

interface AgentManagerPanelProps {
  activeAgents: ActiveAgentState[];
  logs: OrchestrationEvent[];
  onClose: () => void;
}

const AgentManagerPanel: React.FC<AgentManagerPanelProps> = ({ activeAgents, logs, onClose }) => {
  const [activeTab, setActiveTab] = useState<'swarm' | 'events'>('swarm');

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-96 p-0 flex flex-col">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary animate-pulse" />
            <SheetTitle className="text-sm">Orchestration</SheetTitle>
          </div>
        </SheetHeader>

        <PanelTabs
          activeTab={activeTab}
          activeAgentsCount={activeAgents.length}
          onTabChange={setActiveTab}
        />

        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'swarm' && <SwarmView activeAgents={activeAgents} />}
          {activeTab === 'events' && <EventsView logs={logs} />}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AgentManagerPanel;
