import React from 'react';
import { Server, Terminal } from 'lucide-react';

interface PanelTabsProps {
  activeTab: 'swarm' | 'events';
  activeAgentsCount: number;
  onTabChange: (tab: 'swarm' | 'events') => void;
}

const PanelTabs: React.FC<PanelTabsProps> = ({ activeTab, activeAgentsCount, onTabChange }) => {
  return (
    <div className="flex border-b border-nexus-800 bg-nexus-900/30 flex-shrink-0">
      <button
        onClick={() => onTabChange('swarm')}
        className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-all relative ${
          activeTab === 'swarm' 
            ? 'text-nexus-cyan bg-nexus-800/20' 
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
      >
        <Server size={14} />
        <span>Active Swarm</span>
        {activeTab === 'swarm' && (
          <div className="absolute bottom-0 left-0 w-full h-0.5 bg-nexus-cyan shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
        )}
        {activeAgentsCount > 0 && (
          <span className="ml-1 bg-nexus-800 text-nexus-cyan px-1.5 rounded-full text-[9px] border border-nexus-700">
            {activeAgentsCount}
          </span>
        )}
      </button>
      <button
        onClick={() => onTabChange('events')}
        className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-all relative ${
          activeTab === 'events' 
            ? 'text-nexus-cyan bg-nexus-800/20' 
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
      >
        <Terminal size={14} />
        <span>System Logs</span>
        {activeTab === 'events' && (
          <div className="absolute bottom-0 left-0 w-full h-0.5 bg-nexus-cyan shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
        )}
      </button>
    </div>
  );
};

export default PanelTabs;
