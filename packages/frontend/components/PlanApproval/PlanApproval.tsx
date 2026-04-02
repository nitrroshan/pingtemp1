import React, { useState } from 'react';
import { ClipboardList, CheckCircle, GitBranch, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { Task as BackendTask } from '../../services/AgentServiceV2';

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
    <Dialog open onOpenChange={open => { if (!open) onDismiss?.(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ClipboardList size={16} className="text-primary" />
            </div>
            <div>
              <DialogTitle>Plan Ready for Approval</DialogTitle>
              <DialogDescription className="mt-0.5">
                {tasks.length} task{tasks.length !== 1 ? 's' : ''} — review and reorder before approving
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
          <div className="flex flex-col gap-2">
            {tasks.map((task, index) => {
              const depNames = getDepNames(task.dependencies);
              const isSelected = selectedId === task.id;

              return (
                <div
                  key={task.id}
                  className={cn(
                    'rounded-xl border transition-colors',
                    isSelected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-primary/20'
                  )}
                >
                  <div
                    className="flex items-start gap-3 p-3 cursor-pointer"
                    onClick={() => setSelectedId(isSelected ? null : task.id)}
                  >
                    {/* Index + grip */}
                    <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-0.5">
                      <GripVertical size={13} className="text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">{index + 1}</span>
                    </div>

                    {/* Task info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {task.assignedRole && (
                          <Badge variant="secondary">{task.assignedRole}</Badge>
                        )}
                        {task.priority !== undefined && (
                          <Badge variant="info">P{task.priority}</Badge>
                        )}
                        {depNames.length > 0 && (
                          <Badge variant="warning">
                            <GitBranch size={9} />
                            {depNames.length} dep{depNames.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Reorder */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); moveTask(index, 'up'); }}
                        disabled={index === 0}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed rounded"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); moveTask(index, 'down'); }}
                        disabled={index === tasks.length - 1}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed rounded"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Dependencies (expanded) */}
                  {isSelected && depNames.length > 0 && (
                    <div className="px-3 pb-3 pt-2 border-t border-border">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Dependencies</p>
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
        <DialogFooter className="px-5 py-3 border-t border-border shrink-0 flex flex-row items-center justify-between">
          <span className="text-xs text-muted-foreground">Click task to view deps · arrows to reorder</span>
          <div className="flex items-center gap-2">
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Review Later
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => onApprove(tasks)}
              className="gap-1.5"
            >
              <CheckCircle size={14} />
              Approve & Execute
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlanApproval;
export { PlanApproval };
