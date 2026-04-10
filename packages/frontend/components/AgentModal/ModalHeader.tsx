import React from 'react';
import { Bot, Workflow } from 'lucide-react';
import { DialogTitle } from '../ui/dialog';

interface ModalHeaderProps {
  isSubAgentMode: boolean;
  parentName: string;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ isSubAgentMode, parentName }) => {  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSubAgentMode ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'}`}>
        {isSubAgentMode ? <Bot size={16} /> : <Workflow size={16} />}
      </div>
      <div>
        <DialogTitle className="text-base font-semibold text-foreground leading-tight">
          {isSubAgentMode ? 'Add Agent' : 'New Team'}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          {isSubAgentMode ? `Reporting to: ${parentName}` : 'Create an orchestration team'}
        </p>
      </div>
    </div>
  );
};

export default ModalHeader;
