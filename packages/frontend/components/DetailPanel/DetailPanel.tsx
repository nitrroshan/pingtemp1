/**
 * DetailPanel — right-side detail panel (320px, optional)
 *
 * Tabs:
 *   Events   — real-time orchestration event logs
 *   Agents   — active agent swarm view
 *   Tasks    — task status list
 *   Settings — agent/team settings placeholder (Phase 3+)
 */

import React, { useState } from 'react';
import { X, Activity, ListTodo, Users, Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import EventsView from '../AgentManagerPanel/EventsView';
import SwarmView from '../AgentManagerPanel/SwarmView';
import SkillSelector from '../SkillSelector';
import type { OrchestrationEvent, ActiveAgentState, Task } from '../../types';

type DetailTab = 'events' | 'agents' | 'tasks' | 'settings';

interface DetailPanelProps {
  logs: OrchestrationEvent[];
  activeAgents: ActiveAgentState[];
  allTasks: Task[];
  agentName?: string;
  agentId?: string;
  teamId?: string;
  onClose: () => void;
}

const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
  { id: 'events',   label: 'Events',   icon: <Activity size={13} /> },
  { id: 'agents',   label: 'Agents',   icon: <Users size={13} /> },
  { id: 'tasks',    label: 'Tasks',    icon: <ListTodo size={13} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={13} /> },
];

const STATUS_COLORS: Record<string, string> = {
  ready:       'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  pending:     'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  completed:   'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  failed:      'bg-red-500/20 text-red-600 dark:text-red-400',
};

function TasksTab({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-xs">
        <ListTodo size={20} className="opacity-30" />
        <span>No tasks yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-2">
      {tasks.map(task => (
        <div key={task.id} className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-muted/60 border border-border">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-foreground truncate">{task.title}</div>
            {task.assignedRole && (
              <div className="text-[10px] text-muted-foreground mt-0.5">{task.assignedRole}</div>
            )}
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[task.status] ?? 'bg-muted text-muted-foreground'}`}>
            {task.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function SettingsTab({ agentName }: { agentName?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-xs px-4 text-center">
      <Settings size={20} className="opacity-30" />
      <span className="font-medium text-foreground/70">{agentName ?? 'Agent'} Settings</span>
      <span className="text-[10px] text-muted-foreground/70">Agent configuration and tool management will be available in Phase 5.</span>
    </div>
  );
}

export function DetailPanel({ logs, activeAgents, allTasks, agentName, agentId, teamId, onClose }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('events');

  return (
    <motion.div
      className="w-80 border-l border-border bg-background flex flex-col shrink-0"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wider">Details</span>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          aria-label="Close detail panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            <span className="hidden xl:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'events' && (
            <motion.div key="events" className="absolute inset-0"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}>
              <EventsView logs={logs} />
            </motion.div>
          )}
          {activeTab === 'agents' && (
            <motion.div key="agents" className="absolute inset-0"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}>
              <SwarmView activeAgents={activeAgents} />
            </motion.div>
          )}
          {activeTab === 'tasks' && (
            <motion.div key="tasks" className="absolute inset-0 overflow-y-auto"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}>
              <TasksTab tasks={allTasks} />
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div key="settings" className="absolute inset-0 overflow-y-auto"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}>
              {agentId && teamId ? (
                <SkillSelector agentId={agentId} teamId={teamId} onClose={() => setActiveTab('events')} />
              ) : (
                <SettingsTab agentName={agentName} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default DetailPanel;
