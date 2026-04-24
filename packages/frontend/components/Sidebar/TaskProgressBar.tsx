/**
 * TaskProgressBar — thin 2px progress bar for in-progress tasks.
 *
 * Width from progress.pct (0-100). If no pct, shows indeterminate pulse.
 * Only visible for in_progress tasks.
 */

import React from 'react';

interface TaskProgressBarProps {
  status: string;
  pct?: number;
}

export const TaskProgressBar: React.FC<TaskProgressBarProps> = ({ status, pct }) => {
  if (status !== 'in_progress') return null;

  return (
    <div className="h-0.5 w-full bg-muted rounded-full overflow-hidden">
      {pct != null ? (
        <div
          className="h-full bg-primary rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      ) : (
        <div className="h-full w-1/3 bg-primary/60 rounded-full animate-pulse" />
      )}
    </div>
  );
};
