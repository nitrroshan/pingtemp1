/**
 * @ping/shared — Task and goal types.
 *
 * Shared between backend (TaskStore) and frontend (orchestrationStore).
 */

export type TaskStatus = 'ready' | 'pending' | 'in_progress' | 'completed' | 'failed';

export type GoalStatus = 'idle' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed';

export type SessionState =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'completed'
  | 'awaiting_approval'
  | null;

/** Task as shared between backend and frontend */
export interface SharedTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedRole?: string;
  priority?: number;
  dependencies?: string[];
  goalId?: string;
}

/** Coarse-grained task lifecycle update (Channel B) */
export interface TaskUpdate {
  taskId: string;
  type: string; // Backend emits various types: started, progress, tool_milestone, completed, failed, blocked, ask_user, thinking, etc.
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

/** Plan/goal summary for sidebar */
export interface PlanSummary {
  goalId: string;
  title: string;
  state: 'idle' | 'gathering' | 'researching' | 'awaiting_approval' | 'executing' | 'queued' | 'done';
  taskCount: number;
  completedCount: number;
  planId?: string;
  createdAt: number;
}

/** GoalSession — unified model for all goal-scoped state */
export interface GoalSession {
  goalId: string;
  teamId: string;
  goal: string;
  status: GoalStatus;
  planId: string | null;
  plan: SharedTask[];
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    agentId?: string;
    taskId?: string;
    streamParts?: string;
    timestamp: string;
  }>;
  repoUrl?: string;
  repoBranch?: string;
  createdAt: number;
  updatedAt: number;
}

/** Session restore response from GET /api/v2/sessions/:teamId/restore */
export interface RestoreResponse {
  teamId: string;
  conversations: Record<string, Array<{
    id: string;
    role: string;
    content: string;
    streamParts?: string;
    timestamp: string;
  }>>;
  workerMessages: Array<{
    id: string;
    role: string;
    content: string;
    agentId: string;
    taskId?: string;
    streamParts?: string;
    timestamp: string;
  }>;
  goals: Array<{
    goalId?: string;
    planId?: string;
    id?: string;
    _id?: string;
    goal?: string;
    title?: string;
    status?: string;
    taskCount?: number;
    completedCount?: number;
    createdAt?: string;
  }>;
  plan: SharedTask[];
  tasks: SharedTask[];
  orchestratorState: string | null;
  activeGoalId: string | null;
  allGoalSummaries?: PlanSummary[];
}
