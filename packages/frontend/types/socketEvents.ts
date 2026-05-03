/**
 * Socket.IO typed event contracts — frontend-local copy.
 *
 * Defines `ClientToServerEvents` and `ServerToClientEvents` for typed Socket.IO.
 * Used by `AgentServiceV2` for `Socket<ServerToClientEvents, ClientToServerEvents>`.
 *
 * Previously imported from `@ping/shared`. Inlined so frontend has no
 * cross-package type dependency.
 */

import type { StreamPayload } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Payload types used by Socket.IO events
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorResponse {
  sessionId?: string;
  taskId?: string;
  error: string;
  timestamp: number;
}

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
  state?: string;
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

export interface TaskUpdate {
  taskId: string;
  type: string;
  role?: string;
  teamId?: string;
  goalId?: string;
  note?: string;
  summary?: string;
  error?: string;
  reason?: string;
  stepIdx?: number;
  tool?: string;
  timestamp?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client → Server events
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientToServerEvents {
  register: (data: { userId: string; token?: string }) => void;
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
  action: (data: {
    teamId: string;
    type: 'approve-plan' | 'start-task' | 'complete-task' | 'cancel-task' | 'auto-execute' | 'get-state';
    sessionId?: string;
    taskId?: string;
    goalId?: string;
    output?: unknown;
    enabled?: boolean;
    changes?: unknown;
  }) => void;
  subscribeToGoal: (data: { teamId: string; goalId: string }) => void;
  unsubscribeFromGoal: (data: { teamId: string; goalId: string }) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server → Client events
// ─────────────────────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  registered: (data: { clientId: string }) => void;
  stream: (payload: StreamPayload) => void;
  state: (data: SessionStateEvent) => void;
  message: (data: AgentMessageEvent) => void;
  error: (data: ErrorResponse) => void;
  progress: (data: ProgressEvent) => void;
  output: (data: AgentOutputEvent) => void;
  'goal:created': (data: { goalId: string; nonce?: string }) => void;
  'goal:stateChange': (data: GoalStateChangeEvent) => void;
  task_update: (data: TaskUpdate) => void;
  'discussion:activity': (data: DiscussionActivityEvent) => void;
  'discussion:mention': (data: DiscussionMentionEvent) => void;
}
