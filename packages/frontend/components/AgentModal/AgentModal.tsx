
import React, { useState, useEffect } from 'react';
import type { Agent } from '../../types';
import { AGENT_TEMPLATES } from '../../constants';
import {
  Dialog, DialogContent, DialogHeader as UIDialogHeader, DialogTitle, DialogFooter as UIDialogFooter,
} from '../ui/dialog';
import {
  ModalHeader,
  ModalTabs,
  AgentLibrary,
  AgentForm,
  WorkflowForm,
  ModalFooter,
} from './index';

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (agent: Partial<Agent>) => void;
  parentAgents: Agent[];
  initialParentId?: string;
}

const AgentModal: React.FC<AgentModalProps> = ({ isOpen, onClose, onSave, parentAgents, initialParentId }) => {
  const [activeTab, setActiveTab] = useState<'custom' | 'library'>('custom');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [systemInstruction, setSystemInstruction] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('Bot');
  const [workflowGoal, setWorkflowGoal] = useState('');

  const isSubAgentMode = !!initialParentId;

  useEffect(() => {
    if (isOpen) {
      setName('');
      setRole('');
      setDescription('');
      setSystemInstruction('');
      setWorkflowGoal('');
      setSelectedIcon('Bot');
      setActiveTab(isSubAgentMode ? 'library' : 'custom');
    }
  }, [isOpen, initialParentId, isSubAgentMode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubAgentMode) {
      onSave({ name, role, description, systemInstruction, parentId: initialParentId, icon: selectedIcon, subAgents: [], collapsed: false });
    } else {
      onSave({ name, description: workflowGoal, parentId: undefined });
    }
    onClose();
  };

  const handleSelectTemplate = (template: typeof AGENT_TEMPLATES[0]) => {
    setName(template.name);
    setRole(template.role);
    setDescription(template.description);
    setSystemInstruction(template.systemInstruction);
    setSelectedIcon(template.icon);
    setActiveTab('custom');
  };

  const parentName = parentAgents.find(a => a.id === initialParentId)?.name ?? 'Unknown Parent';

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <UIDialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <ModalHeader isSubAgentMode={isSubAgentMode} parentName={parentName} />
        </UIDialogHeader>

        {/* Tabs (sub-agent mode only) */}
        {isSubAgentMode && (
          <ModalTabs activeTab={activeTab} onTabChange={setActiveTab} />
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          {isSubAgentMode && activeTab === 'library' && (
            <AgentLibrary onSelectTemplate={handleSelectTemplate} />
          )}
          {(!isSubAgentMode || activeTab === 'custom') && (
            isSubAgentMode ? (
              <AgentForm
                name={name} role={role} description={description} systemInstruction={systemInstruction}
                onNameChange={setName} onRoleChange={setRole} onDescriptionChange={setDescription}
                onSystemInstructionChange={setSystemInstruction} onSubmit={handleSubmit}
              />
            ) : (
              <WorkflowForm
                name={name} description={description} workflowGoal={workflowGoal}
                onNameChange={setName} onDescriptionChange={setDescription}
                onWorkflowGoalChange={setWorkflowGoal} onSubmit={handleSubmit}
              />
            )
          )}
        </div>

        {/* Footer */}
        <UIDialogFooter className="px-5 py-3 border-t border-border shrink-0">
          <ModalFooter isSubAgentMode={isSubAgentMode} activeTab={activeTab} onClose={onClose} />
        </UIDialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AgentModal;
