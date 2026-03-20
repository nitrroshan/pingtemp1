import React from 'react';
import { ClipboardList, Play, X, CheckCircle } from 'lucide-react';
import { Task as BackendTask } from '../../services/AgentServiceV2';

interface PlanApprovalProps {
  plan: BackendTask[];
  onApprove: () => void;
  onDismiss?: () => void;
}

const PlanApproval: React.FC<PlanApprovalProps> = ({ plan, onApprove, onDismiss }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nexus-950 border border-nexus-700 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-800 bg-nexus-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-nexus-800 rounded-lg text-nexus-cyan">
              <ClipboardList size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Plan Ready for Approval</h2>
              <p className="text-xs text-slate-500">{plan.length} tasks to execute</p>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-2 text-slate-500 hover:text-slate-300 hover:bg-nexus-800 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Task List */}
        <div className="px-6 py-4 max-h-80 overflow-y-auto scrollbar-thin">
          <div className="space-y-2">
            {plan.map((task, index) => (
              <div
                key={task.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-nexus-900 border border-nexus-800"
              >
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-nexus-800 text-nexus-cyan flex items-center justify-center text-xs font-medium">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{task.title}</p>
                  {task.description && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-nexus-800 text-slate-400 border border-nexus-700">
                      {task.assignedRole}
                    </span>
                    {task.priority && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 border border-blue-800/50">
                        Priority: {task.priority}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-nexus-800 bg-nexus-900/30">
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-nexus-800 rounded-lg transition-colors"
            >
              Review Later
            </button>
          )}
          <button
            onClick={onApprove}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-nexus-cyan text-nexus-950 rounded-lg hover:bg-nexus-teal transition-colors shadow-lg shadow-nexus-cyan/20"
          >
            <CheckCircle size={16} />
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanApproval;
