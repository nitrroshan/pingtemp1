import React from 'react';
import { X, Bot, Workflow } from 'lucide-react';

interface ModalHeaderProps {
  isSubAgentMode: boolean;
  parentName: string;
  onClose: () => void;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ isSubAgentMode, parentName, onClose }) => {
  return (
    <div className="px-6 py-4 border-b border-nexus-800 flex items-center justify-between bg-nexus-950 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isSubAgentMode ? 'bg-nexus-800 text-nexus-cyan' : 'bg-indigo-900/50 text-indigo-400'}`}>
          {isSubAgentMode ? <Bot size={20} /> : <Workflow size={20} />}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-100 leading-tight">
            {isSubAgentMode ? 'Add Specialist Agent' : 'Initialize New Workflow'}
          </h3>
          <p className="text-xs text-slate-500">
            {isSubAgentMode ? `Reporting to: ${parentName}` : 'Establish a new orchestration group'}
          </p>
        </div>
      </div>
      <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
        <X size={20} />
      </button>
    </div>
  );
};

export default ModalHeader;
