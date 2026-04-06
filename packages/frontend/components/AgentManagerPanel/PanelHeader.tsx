import React from 'react';
import { Activity, X } from 'lucide-react';

interface PanelHeaderProps {
  onClose: () => void;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({ onClose }) => {
  return (
    <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-card/80 backdrop-blur flex-shrink-0">
      <div className="flex items-center gap-2 text-primary">
        <Activity size={18} className="animate-pulse" />
        <h2 className="font-bold text-sm tracking-wider uppercase">Orchestration Net</h2>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-mono text-green-500">ONLINE</span>
        </div>
        <button 
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Close Panel"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default PanelHeader;
