import React from 'react';
import { Check, Trash2, Clock, Play, Loader2, AlertCircle, Square, CheckCircle, GitBranch } from 'lucide-react';
import { Task, TaskStatus } from '../../types';

interface TaskItemProps {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onStart?: (taskId: string) => void;
  onComplete?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
}

const getStatusConfig = (status: TaskStatus, hasDependencies: boolean) => {
  switch (status) {
    case 'ready':
      return { icon: Play, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', label: 'Ready' };
    case 'pending':
      // Pending with dependencies = blocked, pending without = effectively ready
      if (hasDependencies) {
        return { icon: GitBranch, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', label: 'Blocked' };
      }
      return { icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', label: 'Pending' };
    case 'in_progress':
      return { icon: Loader2, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', label: 'Running', animate: true };
    case 'completed':
      return { icon: Check, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Done' };
    case 'failed':
      return { icon: AlertCircle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Failed' };
    default:
      return { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', label: 'Unknown' };
  }
};

const TaskItem: React.FC<TaskItemProps> = ({ task, onToggle, onDelete, onStart, onComplete, onCancel }) => {
  // Check if task has unmet dependencies
  const hasDependencies = task.dependencies && task.dependencies.length > 0;
  const isBlocked = task.status === 'pending' && hasDependencies;
  const canStart = task.status === 'ready' || (task.status === 'pending' && !hasDependencies);
  
  const statusConfig = getStatusConfig(task.status, !!hasDependencies);
  const StatusIcon = statusConfig.icon;

  return (
    <div 
      className={`
        group flex items-center gap-3 p-4 rounded-xl border transition-all duration-200
        ${task.completed 
          ? 'bg-muted/30 border-border text-muted-foreground' 
          : 'bg-card border-border hover:border-primary/30 text-foreground shadow-md'}
      `}
    >
      {/* Status Badge */}
      <div 
        className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${statusConfig.bg} ${statusConfig.border} border ${statusConfig.color}`}
      >
        <StatusIcon size={12} className={statusConfig.animate ? 'animate-spin' : ''} />
        <span>{statusConfig.label}</span>
      </div>
      
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${task.completed ? 'line-through decoration-muted-foreground' : ''}`}>
          {task.title}
        </span>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>
        )}
      </div>

      {/* Action Buttons based on status */}
      <div className="flex items-center gap-1">
        {/* Blocked indicator - show for tasks waiting on dependencies */}
        {isBlocked && (
          <span 
            className="flex items-center gap-1 px-2 py-1 text-xs text-orange-600 dark:text-orange-400 bg-orange-500/10 rounded-md"
            title={`Waiting for: ${task.dependencies?.join(', ')}`}
          >
            <GitBranch size={12} />
            Waiting
          </span>
        )}
        
        {/* Start button - only for tasks that can actually start */}
        {canStart && onStart && (
          <button
            onClick={() => onStart(task.id)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-md transition-colors"
            title="Start task"
          >
            <Play size={12} />
            Start
          </button>
        )}

        {/* Complete/Cancel buttons - show for in_progress tasks */}
        {task.status === 'in_progress' && (
          <>
            {onComplete && (
              <button
                onClick={() => onComplete(task.id)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-colors"
                title="Mark complete"
              >
                <CheckCircle size={12} />
                Done
              </button>
            )}
            {onCancel && (
              <button
                onClick={() => onCancel(task.id)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-colors"
                title="Cancel task"
              >
                <Square size={12} />
                Cancel
              </button>
            )}
          </>
        )}

        {/* Legacy toggle button for completed display */}
        {(task.status === 'completed' || task.status === 'failed') && (
          <button 
            onClick={onToggle}
            className={`
              flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-colors
              ${task.completed 
                ? 'bg-emerald-500 border-emerald-500 text-white' 
                : 'border-muted-foreground hover:border-primary text-transparent'}
            `}
          >
            <Check size={12} strokeWidth={4} />
          </button>
        )}

        <button 
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-red-500 hover:bg-muted rounded-lg transition-all"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};

export default TaskItem;
