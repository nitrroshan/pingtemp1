import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '../ui/button';

interface ModalFooterProps {
  isSubAgentMode: boolean;
  activeTab: 'custom' | 'library';
  onClose: () => void;
}

const ModalFooter: React.FC<ModalFooterProps> = ({ isSubAgentMode, activeTab, onClose }) => {
  const showSubmitButton = !isSubAgentMode || activeTab === 'custom';
  const formId = isSubAgentMode ? 'agent-form' : 'workflow-form';

  return (
    <div className="flex items-center justify-end gap-2 w-full">
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>

      {showSubmitButton ? (
        <Button type="submit" form={formId} size="sm" className="gap-1.5">
          <Check size={14} />
          {isSubAgentMode ? 'Add Agent' : 'Create Team'}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">
          Select an agent from the library to continue.
        </span>
      )}
    </div>
  );
};

export default ModalFooter;
