/**
 * ICrdtTaskSync — Interface for CRDT task persistence bridge.
 *
 * Replaces `any` casts across 6+ files. All consumers should use this
 * interface instead of referencing the concrete CrdtTaskSync class directly.
 */

export type TaskStatus = "ready" | "pending" | "in_progress" | "completed" | "failed";

export interface TaskLike {
  id: string;
  description: string;
  assigned_role: string;
  status: TaskStatus;
  priority?: number;
  context?: Record<string, any>;
  output?: any;
  prerequisites: Map<string, boolean>;
  dependants: string[];
  artifacts?: string[];
  knowledgeRefs?: string[];
}

export interface ICrdtTaskSync {
  /** Persist a task to CRDT Y.Map("meta"). */
  persistTask(task: TaskLike): Promise<void>;

  /** Sync task status change to CRDT. */
  syncStatus(taskId: string, newStatus: TaskStatus, output?: any): Promise<void>;

  /** Persist plan overview to CRDT. */
  persistPlan(plan: any, goalId: string): Promise<void>;

  /** Update plan status in CRDT. */
  syncPlanStatus(status: string): Promise<void>;

  /** Update the task index CRDT doc. */
  updateIndex(tasks: TaskLike[]): Promise<void>;

  /** Update agent busy/idle status in CRDT. */
  updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void>;

  /** Load all tasks from CRDT (crash recovery). */
  loadAllTasks(): Promise<TaskLike[]>;

  /** Initialize collaboration docs for a task (discussions, etc.). */
  initCollabDocs?(taskId: string, config: any): Promise<void>;

  /** Access the underlying CollaborationSpace. */
  readonly space: any;
}
