/**
 * Utility exports for worker module
 */

// Task Queue (legacy - used by AgentWorker)
export { TaskQueue } from "./TaskQueue.js";
export type { Task } from "./TaskQueue.js";

// Priority Queue
export { PriorityQueue } from "./PriorityQueue.js";

// Role-based Task Queue (new centralized queue)
export { RoleTaskQueue } from "./RoleTaskQueue.js";
export type {
  TaskWithContext,
  TaskContext,
  TaskAvailableEvent,
  TaskCompleteEvent,
  TaskFailedEvent,
  QueueMetrics,
} from "./RoleTaskQueue.types.js";
