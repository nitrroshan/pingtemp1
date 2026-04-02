/**
 * StatusBar — bottom status bar
 *
 * Shows: connection status · active agent count · team name · session state
 */

import React from 'react';
import { Circle, Cpu, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SessionState } from '../../types';

interface StatusBarProps {
  isConnected: boolean;
  activeAgentCount: number;
  teamName?: string;
  sessionState: SessionState;
}

const SESSION_LABELS: Record<string, string> = {
  idle: 'Idle',
  planning: 'Planning…',
  executing: 'Executing',
  completed: 'Completed',
  awaiting_approval: 'Awaiting Approval',
};

const SESSION_COLORS: Record<string, string> = {
  idle: 'text-muted-foreground',
  planning: 'text-yellow-400',
  executing: 'text-blue-400',
  completed: 'text-emerald-400',
  awaiting_approval: 'text-orange-400',
};

export const StatusBar: React.FC<StatusBarProps> = ({
  isConnected,
  activeAgentCount,
  teamName,
  sessionState,
}) => {
  const state = sessionState ?? 'idle';

  return (
    <div className="h-7 border-t border-border bg-card/80 flex items-center px-4 gap-4 text-xs text-muted-foreground shrink-0 select-none">
      {/* Connection */}
      <div className="flex items-center gap-1.5">
        <Circle
          size={6}
          className={cn(
            'fill-current',
            isConnected ? 'text-emerald-400' : 'text-red-400'
          )}
        />
        <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>

      <span className="text-border">·</span>

      {/* Active agents */}
      <div className="flex items-center gap-1">
        <Cpu size={11} />
        <span>{activeAgentCount} agent{activeAgentCount !== 1 ? 's' : ''} active</span>
      </div>

      {/* Team name */}
      {teamName && (
        <>
          <span className="text-border">·</span>
          <div className="flex items-center gap-1">
            <Users size={11} />
            <span className="truncate max-w-36">{teamName}</span>
          </div>
        </>
      )}

      {/* Session state */}
      {state !== 'idle' && (
        <>
          <span className="text-border">·</span>
          <span className={cn('font-medium', SESSION_COLORS[state])}>
            {SESSION_LABELS[state] ?? state}
          </span>
        </>
      )}
    </div>
  );
};
