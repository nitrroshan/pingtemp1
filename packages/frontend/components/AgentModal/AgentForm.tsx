import React from 'react';

interface AgentFormProps {
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
  onNameChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSystemInstructionChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const AgentForm: React.FC<AgentFormProps> = ({
  name,
  role,
  description,
  systemInstruction,
  onNameChange,
  onRoleChange,
  onDescriptionChange,
  onSystemInstructionChange,
  onSubmit
}) => {
  return (
    <form id="agent-form" onSubmit={onSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-nexus-cyan mb-1 uppercase tracking-wider">
            Agent Name
          </label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full bg-nexus-950 border border-nexus-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-nexus-cyan focus:ring-1 focus:ring-nexus-cyan transition-colors"
            placeholder="e.g. Code Reviewer"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-nexus-cyan mb-1 uppercase tracking-wider">
            Role Title
          </label>
          <input 
            type="text" 
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            className="w-full bg-nexus-950 border border-nexus-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-nexus-cyan focus:ring-1 focus:ring-nexus-cyan transition-colors"
            placeholder="e.g. Architect"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-nexus-cyan mb-1 uppercase tracking-wider">
          Short Description
        </label>
        <input 
          type="text" 
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="w-full bg-nexus-950 border border-nexus-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-nexus-cyan focus:ring-1 focus:ring-nexus-cyan transition-colors"
          placeholder="e.g. Checks code for common errors"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-nexus-cyan mb-1 uppercase tracking-wider">
          System Instructions
        </label>
        <textarea 
          value={systemInstruction}
          onChange={(e) => onSystemInstructionChange(e.target.value)}
          className="w-full bg-nexus-950 border border-nexus-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-nexus-cyan focus:ring-1 focus:ring-nexus-cyan h-32 resize-none font-mono text-xs transition-colors"
          placeholder="Define the agent's persona and rules..."
          required
        />
      </div>
    </form>
  );
};

export default AgentForm;
