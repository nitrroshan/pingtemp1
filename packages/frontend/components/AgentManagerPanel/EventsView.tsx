import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { OrchestrationEvent } from '../../types';
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
      <div className="absolute inset-0 bg-nexus-950 font-mono text-[10px] p-2">
        <div className="h-full flex flex-col items-center justify-center text-slate-700 space-y-2">
          <Terminal size={24} className="opacity-20" />
          <span>System ready. Waiting for input...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-nexus-950 font-mono text-[10px] p-2 overflow-y-auto scrollbar-thin">
      <div className="space-y-0.5">
        {logs.map((log) => (
          <EventLog key={log.id} log={log} />
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default EventsView;
