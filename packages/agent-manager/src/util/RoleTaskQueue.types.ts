/**
 * RoleTaskQueue Types
 *
 * Types for the centralized role-based task queue system.
 */

/**
 * Context passed to a task from completed dependencies
 */
export interface TaskContext {
  /** Outputs from prerequisite tasks */
  previousOutputs: Array<{ taskId: string; output: any }>;
  /** Artifact paths/references available to this task */
  artifacts: string[];
  /** CRDT document references for agent access via collab tool */
  crdtRefs?: Record<string, any>;
}

/**
 * Task with full context for agent execution
 */
export interface TaskWithContext {
  /** Unique task identifier */
  id: string;
  /** Human-readable task description */
  description: string;
  /** Role responsible for this task (lowercase) */
  assigned_role: string;
  /** Priority level (0 = normal, lower = higher priority) */
  priority: number;
  /** Context from completed dependencies */
  context: TaskContext;
  /** Timestamp when task was created */
  createdAt: number;
  /** Current task status */
  status: "queued" | "in_progress" | "completed" | "failed";
}

/**
 * Event payloads for RoleTaskQueue events
 */
export interface TaskAvailableEvent {
  role: string;
  taskId: string;
}

export interface TaskCompleteEvent {
  taskId: string;
  output: any;
}

export interface TaskFailedEvent {
  taskId: string;
  error: string;
}

/**
 * Queue metrics for monitoring
 */
export interface QueueMetrics {
  /** Total tasks queued since creation */
  tasksQueued: number;
  /** Total tasks completed */
  tasksCompleted: number;
  /** Total tasks failed */
  tasksFailed: number;
  /** Current queue sizes by role */
  queueSizes: Record<string, number>;
  /** Average time from queue to completion (ms) */
  avgCompletionTime: number;
}

export interface TaskCallbacks {
  onTaskReady?: (data: { role: string; taskId: string }) => void;
  onTaskComplete?: (data: { taskId: string; output: any }) => void;
  onTaskFailed?: (data: { taskId: string; error: string }) => void;
}
