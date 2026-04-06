import React from 'react';
import { Grid, Edit3 } from 'lucide-react';

interface ModalTabsProps {
  activeTab: 'custom' | 'library';
  onTabChange: (tab: 'custom' | 'library') => void;
}

const ModalTabs: React.FC<ModalTabsProps> = ({ activeTab, onTabChange }) => {
  return (
    <div className="flex border-b border-border bg-muted/30 flex-shrink-0">
      <button
        onClick={() => onTabChange('library')}
        className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
          activeTab === 'library' 
            ? 'bg-accent text-primary border-b-2 border-primary' 
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        }`}
      >
        <Grid size={14} />
        Published Agents
      </button>
      <button
        onClick={() => onTabChange('custom')}
        className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
          activeTab === 'custom' 
            ? 'bg-accent text-primary border-b-2 border-primary' 
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        }`}
      >
        <Edit3 size={14} />
        Custom / Edit
      </button>
    </div>
  );
};

export default ModalTabs;
