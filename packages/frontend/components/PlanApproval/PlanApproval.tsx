import React, { useState } from 'react';
import { ClipboardList, X, CheckCircle, GitBranch, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { Task as BackendTask } from '../../services/AgentServiceV2';

interface PlanApprovalProps {
  plan: BackendTask[];
  onApprove: (tasks?: BackendTask[]) => void;
  onDismiss?: () => void;
}

const PlanApproval: React.FC<PlanApprovalProps> = ({ plan: initialPlan, onApprove, onDismiss }) => {
  const [tasks, setTasks] = useState<BackendTask[]>(initialPlan);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const moveTask = (index: number, direction: 'up' | 'down') => {
    const newTasks = [...tasks];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= newTasks.length) return;
    [newTasks[index], newTasks[target]] = [newTasks[target], newTasks[index]];
    setTasks(newTasks);
  };

  const taskById = new Map(tasks.map(t => [t.id, t]));
  const getDepNames = (deps: string[] | undefined) =>
    (deps ?? []).map(id => taskById.get(id)?.title ?? id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nexus-950 border border-nexus-700 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-800 bg-nexus-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-nexus-800 rounded-lg text-nexus-cyan">
              <ClipboardList size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Plan Ready for Approval</h2>
              <p className="text-xs text-slate-500">{tasks.length} tasks — review and reorder before approving</p>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-2 text-slate-500 hover:text-slate-300 hover:bg-nexus-800 rounded-lg transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
          <div className="space-y-2">
            {tasks.map((task, index) => {
              const depNames = getDepNames(task.dependencies);
              const isSelected = selectedId === task.id;
              return (
                <div
                  key={task.id}
                  className={`rounded-xl border transition-all duration-150 ${isSelected ? 'border-nexus-cyan bg-nexus-900' : 'border-nexus-800 bg-nexus-900/60 hover:border-nexus-700'}`}
                >
                  <div className="flex items-start gap-3 p-3 cursor-pointer" onClick={() => setSelectedId(isSelected ? null : task.id)}>
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                      <GripVertical size={14} className="text-slate-600" />
                      <span className="text-[11px] text-slate-600 w-4 text-center">{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-nexus-800 text-slate-400 border border-nexus-700">
                          {task.assignedRole}
                        </span>
                        {task.priority !== undefined && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/40">
                            P{task.priority}
                          </span>
                        )}
                        {depNames.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/20 text-orange-400 border border-orange-800/30 flex items-center gap-1">
                            <GitBranch size={9} />
                            {depNames.length} dep{depNames.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); moveTask(index, 'up'); }} disabled={index === 0}
                        className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed" title="Move up">
                        <ArrowUp size={14} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); moveTask(index, 'down'); }} disabled={index === tasks.length - 1}
                        className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed" title="Move down">
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                  {isSelected && depNames.length > 0 && (
                    <div className="px-3 pb-3 border-t border-nexus-800/60 pt-2">
                      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5">Dependencies</p>
                      <div className="flex flex-col gap-1">
                        {depNames.map((dep, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-orange-300">
                            <GitBranch size={11} className="text-orange-500 flex-shrink-0" />
                            <span>{dep}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-nexus-800 bg-nexus-900/30 shrink-0">
          <p className="text-xs text-slate-500">Click task to see deps · arrows to reorder</p>
          <div className="flex items-center gap-3">
            {onDismiss && (
              <button onClick={onDismiss} className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-nexus-800 rounded-lg transition-colors">
                Review Later
              </button>
            )}
            <button
              onClick={() => onApprove(tasks)}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-nexus-cyan text-nexus-950 rounded-lg hover:bg-nexus-teal transition-colors shadow-lg shadow-nexus-cyan/20"
            >
              <CheckCircle size={16} />
              Approve & Execute
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanApproval;
export { PlanApproval };
