import React from 'react';

interface WorkflowFormProps {
  name: string;
  description: string;
  workflowGoal: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onWorkflowGoalChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const WorkflowForm: React.FC<WorkflowFormProps> = ({
  name,
  description,
  workflowGoal,
  onNameChange,
  onDescriptionChange,
  onWorkflowGoalChange,
  onSubmit
}) => {
  return (
    <form id="workflow-form" onSubmit={onSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-nexus-cyan mb-1 uppercase tracking-wider">
            Workflow Name
          </label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full bg-nexus-950 border border-nexus-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-nexus-cyan focus:ring-1 focus:ring-nexus-cyan transition-colors"
            placeholder="e.g. Marketing Campaign"
            required
          />
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
            placeholder="e.g. Coffee brand campaign"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-nexus-cyan mb-1 uppercase tracking-wider">
          Workflow Goal / Task Description
        </label>
        <textarea 
          value={workflowGoal}
          onChange={(e) => onWorkflowGoalChange(e.target.value)}
          className="w-full bg-nexus-950 border border-nexus-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-nexus-cyan focus:ring-1 focus:ring-nexus-cyan h-32 resize-none font-mono text-xs transition-colors"
          placeholder="Describe what this team of agents should accomplish...

e.g., 'Create a marketing campaign for a new coffee brand', or 'Build a Python script to scrape stock data'..."
          required
        />
        <p className="mt-2 text-[10px] text-slate-500">
          This will automatically spawn an Orchestrator and specialized agents tailored to this goal.
        </p>
      </div>
    </form>
  );
};

export default WorkflowForm;
