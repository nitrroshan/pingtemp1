import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import type { OrchestrationEvent } from '../../types';
import EventLog from './EventLog';

interface EventsViewProps {
  logs: OrchestrationEvent[];
}

const EventsView: React.FC<EventsViewProps> = ({ logs }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground font-mono text-xs">
        <Terminal size={20} className="opacity-30" />
        <span>System ready. Waiting for input…</span>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 font-mono text-[11px] p-2 overflow-y-auto">
      <div className="flex flex-col gap-0.5">
        {logs.map(log => (
          <EventLog key={log.id} log={log} />
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default EventsView;
