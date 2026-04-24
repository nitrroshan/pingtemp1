
import React, { useState, useEffect } from 'react';
import { Agent, Message, Task } from '../../types';
import { agentServiceV2 } from '../../services/AgentServiceV2';
import { FEATURES } from '../../lib/features';
import { logger } from '../../utils/logger';
import { Header, MessageList, ChatInput, TaskList } from '.';
import { RunningWorkersPanel } from './RunningWorkersPanel';
import { AnimatePresence, motion } from 'framer-motion';
import { Skeleton } from '../ui/skeleton';

interface ChatAreaProps {
  agent: Agent;
  messages: Message[];
  tasks: Task[];
  teamId: string | null; // V2: Team ID for socket context
  onUpdateMessages: (agentId: string, messagesOrSingle: Message[] | Message) => void;
  onAddTask: (agentId: string, title: string) => void;
  onToggleTask: (agentId: string, taskId: string) => void;
  onDeleteTask: (agentId: string, taskId: string) => void;
  onAssignTask?: (agentName: string, taskDescription: string, reasoning: string) => void; // Optional: Only for main agent usually
  apiKey: string;
  onTogglePanel?: () => void;
  isPanelOpen?: boolean;
  showPanelToggle?: boolean;
  
  // Auto-execute toggle
  autoExecuteEnabled?: boolean;
  onToggleAutoExecute?: () => void;
  
  // Current plan from backend
  currentPlan?: any[] | null;
  
  // Task lifecycle handlers
  onStartTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  onCancelTask?: (taskId: string) => void;
  isLoading?: boolean;
  onOpenDiscussions?: () => void;
  discussionUnreadCount?: number;

  /** Render slim toggle-only header (PlanSwitcher above shows agent/plan identity) */
  compactHeader?: boolean;

  /** Task list scope: 'plan' for the orchestrator (full plan), 'agent' for individual roles */
  taskScope?: 'plan' | 'agent';
  /** When taskScope === 'plan', pass the full task set so dependency labels can resolve */
  allTasks?: Task[];
  /** Click a task row to open the DetailPanel for it */
  onSelectTask?: (taskId: string) => void;
  selectedTaskId?: string | null;
}

function ChatAreaSkeleton() {
  return (
    <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden">
      <div className="h-12 border-b border-border px-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-7 h-7 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
        </div>
        <Skeleton className="h-7 w-36 rounded-lg" />
      </div>

      <div className="flex-1 p-4 space-y-5 overflow-hidden">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3 items-start">
            <Skeleton className="w-8 h-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 rounded-lg" />
              <Skeleton className="h-4 w-5/6 rounded-lg" />
              <Skeleton className="h-4 w-1/2 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border bg-background/80 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

const ChatArea: React.FC<ChatAreaProps> = ({ 
  agent, 
  messages, 
  tasks,
  teamId,
  onUpdateMessages, 
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onAssignTask,
  apiKey,
  onTogglePanel,
  isPanelOpen,
  showPanelToggle,
  autoExecuteEnabled,
  onToggleAutoExecute,
  currentPlan,
  onStartTask,
  onCompleteTask,
  onCancelTask,
  isLoading = false,
  onOpenDiscussions,
  discussionUnreadCount = 0,
  compactHeader = false,
  taskScope = 'agent',
  allTasks,
  onSelectTask,
  selectedTaskId,
}) => {
  const [viewMode, setViewMode] = useState<'chat' | 'tasks'>('chat');
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Find the currently active (in_progress) task for this agent
  // This is used to send messages in the context of that task
  const activeTask = tasks.find(t =>
    t.status === 'in_progress'
  );

  // When messages change and the last message is from the model, stop streaming
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'model') {
        setIsStreaming(false);
      }
    }
  }, [messages]);

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear this conversation?')) {
      onUpdateMessages(agent.id, []);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // NOTE: V2 event subscriptions are handled in App.tsx
  // ChatArea receives messages via props (messages) and only sends via agentServiceV2

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now()
    };

    const newHistory = [...messages, userMsg];
    onUpdateMessages(agent.id, newHistory);
    setInputValue('');
    setIsStreaming(true);

    try {
      // Send message via V2 API
      if (!teamId) {
        throw new Error('No team selected');
      }
      
      // Determine if this is the orchestrator (main team agent) or a sub-agent
      // Orchestrator agents don't have a parentId, sub-agents do
      const isOrchestrator = !agent.parentId;
      
      if (isOrchestrator) {
        // Send to manager/orchestrator for planning
        agentServiceV2.sendToManager(userMsg.content);
      } else if (FEATURES.chatAgentChat) {
        // Send to persistent ChatAgent (L2) for the role
        agentServiceV2.sendToChatAgent(agent.role.toLowerCase(), userMsg.content);
      } else {
        // Send to worker agent for task execution (legacy path)
        // Pass taskId if there's an active (in_progress) task for this agent
        await agentServiceV2.sendToWorker(
          agent.role.toLowerCase(), 
          userMsg.content, 
          activeTask?.id
        );
      }
    } catch (error: any) {
      logger.error("AgentManager Error:", error);
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: `Error: ${error.message || 'Failed to send message to agent.'}`,
        timestamp: Date.now(),
        isError: true
      };
      onUpdateMessages(agent.id, [...newHistory, errorMsg]);
      setIsStreaming(false);
    }
  };

  if (isLoading) {
    return <ChatAreaSkeleton />;
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden transition-all duration-300">
      {/* Background Gradient Effect */}
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-muted/30 to-transparent pointer-events-none" />
      
      {/* Minimal header — slim in plan mode, full in standalone agent mode */}
      <Header
        agent={agent}
        viewMode={viewMode}
        tasks={taskScope === 'plan' && allTasks ? allTasks : tasks}
        compact={compactHeader}
        onViewModeChange={setViewMode}
        onClearHistory={handleClearHistory}
      />

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {/* Running Workers Panel — shown for ChatAgent R1 chat ONLY (not worker stream view) */}
        {FEATURES.chatAgentChat && agent.parentId && allTasks && !selectedTaskId && (
          <RunningWorkersPanel
            tasks={allTasks}
            role={agent.role}
            onJumpToTask={(taskId) => onSelectTask?.(taskId)}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {viewMode === 'chat' ? (
            <motion.div
              key="chat"
              className="flex-1 overflow-hidden relative flex flex-col"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
                <MessageList
                  messages={messages}
                  isStreaming={isStreaming}
                  agentName={agent.name}
                />
              </div>

              <ChatInput
                inputValue={inputValue}
                isStreaming={isStreaming}
                agentName={agent.name}
                onInputChange={setInputValue}
                onSubmit={handleSubmit}
                onKeyDown={handleKeyDown}
                onOpenDiscussions={onOpenDiscussions}
                discussionUnreadCount={discussionUnreadCount}
                autoExecuteEnabled={autoExecuteEnabled}
                onToggleAutoExecute={onToggleAutoExecute}
              />
            </motion.div>
          ) : (
            <motion.div
              key="tasks"
              className="flex-1 overflow-hidden"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <TaskList
                tasks={taskScope === 'plan' && allTasks ? allTasks : tasks}
                agentName={agent.name}
                scope={taskScope}
                allTasks={allTasks}
                onSelectTask={onSelectTask}
                selectedTaskId={selectedTaskId}
                onStartTask={onStartTask}
                autoExecuteEnabled={autoExecuteEnabled}
              />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default ChatArea;
