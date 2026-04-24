/**
 * TaskTimeLabel — shows elapsed time for a task.
 *
 * Format: < 1m → "< 1m", 1-59m → "3m", 60m+ → "1h 5m"
 * Updates every 10s while task is in_progress.
 * Shows final duration for completed/failed tasks.
 * Not shown for pending/ready tasks.
 */

import React, { useState, useEffect } from 'react';

interface TaskTimeLabelProps {
  status: string;
  createdAt?: number;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return '< 1m';
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}

export const TaskTimeLabel: React.FC<TaskTimeLabelProps> = ({ status, createdAt }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== 'in_progress') return;
    const iv = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(iv);
  }, [status]);

  if (!createdAt || status === 'pending' || status === 'ready') return null;

  const elapsed = (status === 'in_progress' ? now : Date.now()) - createdAt;
  if (elapsed < 0) return null;

  return (
    <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
      {formatDuration(elapsed)}
    </span>
  );
};
