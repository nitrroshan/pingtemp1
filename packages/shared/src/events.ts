/**
 * @ping/shared — Socket.IO event type contracts.
 *
 * Defines the typed event interfaces for Socket.IO v4 typed events.
 * Used by both backend (Server<C2S, S2C>) and frontend (Socket<S2C, C2S>).
 */

import type { StreamPayload, ErrorResponse } from './messages.js';
import type { TaskUpdate } from './tasks.js';

// ─────────────────────────────────────────────────────────────────────────────
// Client → Server events
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientToServerEvents {
  /** Register connection with userId */
  register: (data: { userId: string; token?: string }) => void;

  /** Send a chat message (to manager, worker, or chat-agent) */
  message: (data: {
    teamId: string;
    agentId: string;
    sessionId?: string;
    content: string;
    goalId?: string;
    nonce?: string;
    repoUrl?: string;
    repoBranch?: string;
    taskId?: string;
  }) => void;

  /** Dispatch an action (approve-plan, start-task, etc.) */
  action: (data: {
    teamId: string;
    type: 'approve-plan' | 'start-task' | 'complete-task' | 'cancel-task' | 'auto-execute' | 'get-state';
    sessionId?: string;
    taskId?: string;
    output?: unknown;
    enabled?: boolean;
    changes?: unknown;
  }) => void;

  /** Subscribe to a goal-scoped room for stream isolation */
  subscribeToGoal: (data: { teamId: string; goalId: string }) => void;

  /** Unsubscribe from a goal-scoped room */
  unsubscribeFromGoal: (data: { teamId: string; goalId: string }) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server → Client events
// ─────────────────────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  /** Registration confirmation */
  registered: (data: { clientId: string }) => void;

  /** AI SDK Data Stream Protocol parts (text, reasoning, tool calls, lifecycle) */
  stream: (payload: StreamPayload) => void;

  /** Session/task state changes */
  state: (data: SessionStateEvent) => void;

  /** Chat messages from agents */
  message: (data: AgentMessageEvent) => void;

  /** Error notifications */
  error: (data: ErrorResponse) => void;

  /** Legacy real-time updates (thinking, tool_start, tool_result) */
  progress: (data: ProgressEvent) => void;

  /** Structured output from agents */
  output: (data: AgentOutputEvent) => void;

  /** Server-generated goalId after first message to new goal */
  'goal:created': (data: { goalId: string; nonce?: string }) => void;

  /** Goal status changes + summaries for sidebar */
  'goal:stateChange': (data: GoalStateChangeEvent) => void;

  /** Coarse-grained task lifecycle updates */
  task_update: (data: TaskUpdate) => void;

  /** Collaboration document activity */
  'discussion:activity': (data: DiscussionActivityEvent) => void;

  /** User mention in collaboration document */
  'discussion:mention': (data: DiscussionMentionEvent) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event payload types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionStateEvent {
  sessionId: string;
  sessionState?: 'planning' | 'ready' | 'executing' | 'completed' | 'awaiting_approval';
  plan?: Array<{
    id: string;
    title: string;
    description: string;
    assignedRole: string;
    status: string;
    priority?: number;
    dependencies?: string[];
    goalId?: string;
  }>;
  tasks?: Array<{ id: string; status: string; role?: string }>;
  autoExecute?: boolean;
  goalId?: string;
  timestamp: number;
}

export interface AgentMessageEvent {
  sessionId: string;
  agentId: string;
  taskId?: string;
  goalId?: string;
  content: string;
  isStreaming?: boolean;
  timestamp: number;
}

export interface ProgressEvent {
  sessionId: string;
  taskId: string;
  agentId: string;
  type: 'thinking' | 'tool_start' | 'tool_result' | 'step';
  content: string;
  tool?: string;
  timestamp: number;
}

export interface AgentOutputEvent {
  sessionId: string;
  taskId: string;
  agentId: string;
  output: {
    content: string;
    contentType?: string;
    filePath?: string;
    links?: string[];
  };
  timestamp: number;
}

export interface GoalStateChangeEvent {
  teamId: string;
  goalId?: string;
  allGoals?: Array<{
    goalId: string;
    title: string;
    state: string;
    taskCount: number;
    completedCount: number;
    planId?: string;
    createdAt: number;
  }>;
}

export interface DiscussionActivityEvent {
  docName: string;
  taskId?: string;
  teamId?: string;
  goalId?: string;
  blockCount: number;
  timestamp: number;
}

export interface DiscussionMentionEvent {
  docName: string;
  teamId?: string;
  goalId?: string;
  taskId?: string;
  mentions: string[];
  timestamp: number;
}
