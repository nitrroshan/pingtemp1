import React from 'react';
import { Grid, Edit3 } from 'lucide-react';

interface ModalTabsProps {
  activeTab: 'custom' | 'library';
  onTabChange: (tab: 'custom' | 'library') => void;
}

const ModalTabs: React.FC<ModalTabsProps> = ({ activeTab, onTabChange }) => {
  return (
    <div className="flex border-b border-nexus-800 bg-nexus-950/50 flex-shrink-0">
      <button
        onClick={() => onTabChange('library')}
        className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
          activeTab === 'library' 
            ? 'bg-nexus-800 text-nexus-cyan border-b-2 border-nexus-cyan' 
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
      >
        <Grid size={14} />
        Published Agents
      </button>
      <button
        onClick={() => onTabChange('custom')}
        className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
          activeTab === 'custom' 
            ? 'bg-nexus-800 text-nexus-cyan border-b-2 border-nexus-cyan' 
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
      >
        <Edit3 size={14} />
        Custom / Edit
      </button>
    </div>
  );
};

export default ModalTabs;
