import React from 'react';
import { Server, Terminal } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PanelTabsProps {
  activeTab: 'swarm' | 'events';
  activeAgentsCount: number;
  onTabChange: (tab: 'swarm' | 'events') => void;
}

const PanelTabs: React.FC<PanelTabsProps> = ({ activeTab, activeAgentsCount, onTabChange }) => {
  const tabs: { id: 'swarm' | 'events'; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'swarm',  label: 'Active Swarm', icon: <Server size={13} />, badge: activeAgentsCount || undefined },
    { id: 'events', label: 'System Logs',  icon: <Terminal size={13} /> },
  ];

  return (
    <div className="flex border-b border-border shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors relative cursor-pointer',
            activeTab === tab.id
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge !== undefined && (
            <span className="ml-0.5 bg-primary/20 text-primary px-1 rounded text-[9px]">
              {tab.badge}
            </span>
          )}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-0 w-full h-px bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
};

export default PanelTabs;
