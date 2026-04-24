/**
 * TaskActions — action buttons for task detail panel.
 *
 * Shows context-appropriate buttons based on task status:
 *   ready       → Start (manual mode only)
 *   completed   → Review, Retry
 *   failed      → Retry, View Error
 *   in_progress → Pause
 *   pending     → (none — waiting on prerequisites)
 */

import React from 'react';
import { Play, RotateCcw, Eye, Pause, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import type { Task } from '../../types';

interface TaskActionsProps {
  task: Task;
  /** When true, ready tasks dispatch automatically — hide the Start button. */
  autoExecuteEnabled?: boolean;
  onStart?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onPause?: (taskId: string) => void;
  onReview?: (taskId: string) => void;
}

export const TaskActions: React.FC<TaskActionsProps> = ({ task, autoExecuteEnabled, onStart, onRetry, onPause, onReview }) => {
  // Pending tasks have unmet prerequisites — nothing to do.
  if (task.status === 'pending') return null;
  // Ready tasks: only show Start in manual mode (auto mode dispatches automatically).
  if (task.status === 'ready' && (autoExecuteEnabled || !onStart)) {
    return autoExecuteEnabled ? (
      <div className="pt-3 border-t border-border mt-3 text-[10px] text-muted-foreground">
        Auto mode · this task will dispatch automatically.
      </div>
    ) : null;
  }

  return (
    <div className="flex flex-wrap gap-2 pt-3 border-t border-border mt-3">
      {task.status === 'ready' && onStart && !autoExecuteEnabled && (
        <Button
          variant="default"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => onStart(task.id)}
        >
          <Play size={12} />
          Start
        </Button>
      )}

      {(task.status === 'completed') && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => onReview?.(task.id)}
          >
            <Eye size={12} />
            Review
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => onRetry?.(task.id)}
          >
            <RotateCcw size={12} />
            Retry
          </Button>
        </>
      )}

      {task.status === 'failed' && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => onRetry?.(task.id)}
          >
            <RotateCcw size={12} />
            Retry
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 text-red-400"
            onClick={() => onReview?.(task.id)}
          >
            <AlertTriangle size={12} />
            View Error
          </Button>
        </>
      )}

      {task.status === 'in_progress' && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 text-amber-400"
          onClick={() => onPause?.(task.id)}
        >
          <Pause size={12} />
          Pause
        </Button>
      )}
    </div>
  );
};
