import React from 'react';
import { Check } from 'lucide-react';

interface ModalFooterProps {
  isSubAgentMode: boolean;
  activeTab: 'custom' | 'library';
  onClose: () => void;
}

const ModalFooter: React.FC<ModalFooterProps> = ({ isSubAgentMode, activeTab, onClose }) => {
  const showSubmitButton = !isSubAgentMode || activeTab === 'custom';
  const formId = isSubAgentMode ? 'agent-form' : 'workflow-form';
  
  return (
    <div className="p-4 border-t border-nexus-800 bg-nexus-950 flex justify-end gap-3 flex-shrink-0">
      <button 
        type="button"
        onClick={onClose}
        className="px-4 py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-nexus-800 transition-colors text-sm"
      >
        Cancel
      </button>
      
      {showSubmitButton ? (
        <button 
          type="submit"
          form={formId}
          className={`px-4 py-2 rounded-lg font-semibold shadow-lg transition-all flex items-center gap-2 text-sm ${
            isSubAgentMode 
              ? 'bg-nexus-cyan text-nexus-950 hover:bg-cyan-400 shadow-cyan-900/20' 
              : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-900/20'
          }`}
        >
          <Check size={16} />
          {isSubAgentMode ? 'Add Agent' : 'Initialize Workflow'}
        </button>
      ) : (
        <div className="text-xs text-slate-500 flex items-center">
          Select an agent from the library to proceed.
        </div>
      )}
    </div>
  );
};

export default ModalFooter;
