import React from 'react';
import { OrchestrationEvent } from '../../types';

interface EventLogProps {
  log: OrchestrationEvent;
}

const EventLog: React.FC<EventLogProps> = ({ log }) => {
  const getTypeColor = () => {
    switch (log.type) {
      case 'info': return 'text-primary';
      case 'success': return 'text-green-600 dark:text-green-400';
      case 'warning': return 'text-amber-600 dark:text-amber-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex gap-2 hover:bg-accent/50 p-1.5 rounded transition-colors border-l-2 border-transparent hover:border-border">
      <span className="text-muted-foreground/60 flex-shrink-0 select-none w-14 text-right">
        {new Date(log.timestamp).toLocaleTimeString([], {
          hour12: false, 
          hour: '2-digit', 
          minute:'2-digit', 
          second:'2-digit'
        })}
      </span>
      <div className="flex-1 break-words">
        <span className={`font-bold mr-2 tracking-wide ${getTypeColor()}`}>
          [{log.source}]
        </span>
        <span className="text-foreground/70">
          {log.message}
        </span>
      </div>
    </div>
  );
};

export default EventLog;
