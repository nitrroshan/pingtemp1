
import React, { useState, useEffect } from 'react';
import { Agent } from '../../types';
import { AGENT_TEMPLATES } from '../../constants';
import {
  ModalHeader,
  ModalTabs,
  AgentLibrary,
  AgentForm,
  WorkflowForm,
  ModalFooter
} from "./index";

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
  
  // State for "New Workflow" mode
  const [workflowGoal, setWorkflowGoal] = useState('');

  const isSubAgentMode = !!initialParentId;

  useEffect(() => {
    if (isOpen) {
      // Reset fields
      setName('');
      setRole('');
      setDescription('');
      setSystemInstruction('');
      setWorkflowGoal('');
      setSelectedIcon('Bot');
      // Default to library if adding sub agent, otherwise custom (workflow description)
      setActiveTab(isSubAgentMode ? 'library' : 'custom');
    }
  }, [isOpen, initialParentId, isSubAgentMode]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubAgentMode) {
        // Create Sub Agent
        onSave({
            name,
            role,
            description,
            systemInstruction,
            parentId: initialParentId,
            icon: selectedIcon,
            subAgents: [],
            collapsed: false
        });
    } else {
        // Create Workflow (passed as description field for App to handle)
        onSave({
            name,
            description: workflowGoal,
            parentId: undefined 
        });
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

  // Find parent name for display
  const parentName = parentAgents.find(a => a.id === initialParentId)?.name || 'Unknown Parent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nexus-900 border border-nexus-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <ModalHeader 
          isSubAgentMode={isSubAgentMode}
          parentName={parentName}
          onClose={onClose}
        />

        {/* Tabs (Only for Sub-Agent Mode) */}
        {isSubAgentMode && (
          <ModalTabs 
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        )}

        {/* Scrollable Content */}
        <div className="overflow-y-auto scrollbar-thin flex-1">
          
          {/* LIBRARY TAB */}
          {isSubAgentMode && activeTab === 'library' && (
            <AgentLibrary onSelectTemplate={handleSelectTemplate} />
          )}

          {/* CUSTOM / FORM TAB */}
          {(!isSubAgentMode || activeTab === 'custom') && (
            <>
              {isSubAgentMode ? (
                <AgentForm
                  name={name}
                  role={role}
                  description={description}
                  systemInstruction={systemInstruction}
                  onNameChange={setName}
                  onRoleChange={setRole}
                  onDescriptionChange={setDescription}
                  onSystemInstructionChange={setSystemInstruction}
                  onSubmit={handleSubmit}
                />
              ) : (
                <WorkflowForm
                  name={name}
                  description={description}
                  workflowGoal={workflowGoal}
                  onNameChange={setName}
                  onDescriptionChange={setDescription}
                  onWorkflowGoalChange={setWorkflowGoal}
                  onSubmit={handleSubmit}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <ModalFooter
          isSubAgentMode={isSubAgentMode}
          activeTab={activeTab}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

export default AgentModal;
