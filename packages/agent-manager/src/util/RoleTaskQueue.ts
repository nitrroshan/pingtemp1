/**
 * RoleTaskQueue - Centralized role-based task queue
 *
 * Features:
 * - Separate priority queues per role
 * - Event emission for task lifecycle
 * - Metrics tracking
 * - Task lookup by ID
 *
 * Usage:
 * - Orchestrator creates and owns the queue instance
 * - Agents receive reference via constructor
 * - Orchestrator calls queueTask() when tasks are ready
 * - Agents poll() for their role's tasks
 */

import { PriorityQueue } from "./PriorityQueue.js";
import type {
  TaskWithContext,
  QueueMetrics,
  TaskCallbacks,
} from "./RoleTaskQueue.types.js";
import { rootLogger } from "../logging.js";

const logger = rootLogger.child({ module: "RoleTaskQueue" });

export class RoleTaskQueue {
  /** Priority queues by role */
  private queues: Map<string, PriorityQueue<TaskWithContext>> = new Map();

  /** Task lookup by ID */
  private tasks: Map<string, TaskWithContext> = new Map();

  /** Task completion times for metrics */
  private completionTimes: number[] = [];

  /** Callbacks for task lifecycle events */
  private callbacks: TaskCallbacks = {};

  /** Queue metrics */
  private metrics: QueueMetrics = {
    tasksQueued: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    queueSizes: {},
    avgCompletionTime: 0,
  };

  constructor() {
    logger.info("RoleTaskQueue initialized");
  }

  // ==========================================================================
  // Queue Operations
  // ==========================================================================

  /**
   * Add a task to the queue for its assigned role
   * @param task - Task with context to queue
   */
  queueTask(task: TaskWithContext): void {
    const role = task.assigned_role.toLowerCase();

    // Validate
    if (this.tasks.has(task.id)) {
      throw new Error(`Task ${task.id} already exists in queue`);
    }

    // Ensure queue exists for role
    if (!this.queues.has(role)) {
      this.queues.set(role, new PriorityQueue<TaskWithContext>());
    }

    // Update task status
    task.status = "queued";
    task.createdAt = task.createdAt || Date.now();

    // Add to structures
    this.tasks.set(task.id, task);
    this.queues.get(role)!.push(task, task.priority);

    // Update metrics
    this.metrics.tasksQueued++;
    this.updateQueueSizeMetrics();

    logger.debug(`Task ${task.id} queued for role: ${role}`);

    // Invoke callback
    this.callbacks.onTaskReady?.({ role, taskId: task.id });
  }

  /**
   * Poll and remove the highest priority task for a role
   * @param role - Role to poll tasks for
   * @returns Task or undefined if none available
   */
  poll(role: string): TaskWithContext | undefined {
    const normalizedRole = role.toLowerCase();
    const queue = this.queues.get(normalizedRole);

    if (!queue || queue.isEmpty()) {
      return undefined;
    }

    const task = queue.pop();
    if (task) {
      task.status = "in_progress";
      this.updateQueueSizeMetrics();
      logger.debug(`Task ${task.id} polled by role: ${normalizedRole}`);
    }

    return task;
  }

  /**
   * Peek at the highest priority task for a role without removing
   * @param role - Role to peek tasks for
   * @returns Task or undefined if none available
   */
  peek(role: string): TaskWithContext | undefined {
    const normalizedRole = role.toLowerCase();
    const queue = this.queues.get(normalizedRole);

    if (!queue || queue.isEmpty()) {
      return undefined;
    }

    return queue.peek();
  }

  // ==========================================================================
  // Task Lifecycle
  // ==========================================================================

  /**
   * Mark a task as completed
   * @param taskId - Task ID to complete
   * @param output - Task output/result
   */
  completeTask(taskId: string, output: any): void {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "completed") {
      logger.warn(`Task ${taskId} already completed`);
      return;
    }

    // Update task
    task.status = "completed";

    // Track completion time
    const completionTime = Date.now() - task.createdAt;
    this.completionTimes.push(completionTime);
    this.updateAvgCompletionTime();

    // Update metrics
    this.metrics.tasksCompleted++;

    logger.debug(`Task ${taskId} completed`);

    // Invoke callback
    this.callbacks.onTaskComplete?.({ taskId, output });
  }

  /**
   * Mark a task as failed
   * @param taskId - Task ID that failed
   * @param error - Error message
   */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "failed") {
      logger.warn(`Task ${taskId} already marked as failed`);
      return;
    }

    // Update task
    task.status = "failed";

    // Update metrics
    this.metrics.tasksFailed++;

    logger.warn(`Task ${taskId} failed: ${error}`);

    // Invoke callback
    this.callbacks.onTaskFailed?.({ taskId, error });
  }

  /**
   * Update the priority of a queued task
   * @param taskId - Task ID to update
   * @param newPriority - New priority level (lower = higher priority)
   * @returns true if updated, false if task not found or not in queued status
   */
  updatePriority(taskId: string, newPriority: number): boolean {
    const task = this.tasks.get(taskId);

    if (!task) {
      logger.warn(`Cannot update priority: Task ${taskId} not found`);
      return false;
    }

    if (task.status !== "queued") {
      logger.warn(
        `Cannot update priority: Task ${taskId} is ${task.status}, not queued`,
      );
      return false;
    }

    const role = task.assigned_role.toLowerCase();
    const queue = this.queues.get(role);

    if (!queue) {
      return false;
    }

    const oldPriority = task.priority;
    task.priority = newPriority;

    const updated = queue.updatePriority(task, newPriority);

    if (updated) {
      logger.debug(
        `Task ${taskId} priority updated: ${oldPriority} -> ${newPriority}`,
      );
    }

    return updated;
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get a task by ID
   * @param taskId - Task ID to lookup
   */
  getTask(taskId: string): TaskWithContext | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get queue size for a role
   * @param role - Role to check
   */
  getQueueSize(role: string): number {
    const queue = this.queues.get(role.toLowerCase());
    return queue ? queue.size() : 0;
  }

  /**
   * Get all roles that have queues
   */
  getRoles(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Check if a role has pending tasks
   * @param role - Role to check
   */
  hasTasksFor(role: string): boolean {
    return this.getQueueSize(role) > 0;
  }

  // ==========================================================================
  // Callbacks
  // ==========================================================================

  /**
   * Set callbacks for task lifecycle events
   * @param callbacks - Callback functions for task events
   */
  setCallbacks(callbacks: TaskCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Clear all tasks and queues, but keep callbacks attached
   * Used when clearing tasks for a new plan
   */
  clear(): void {
    this.queues.clear();
    this.tasks.clear();
    this.completionTimes = [];
    this.metrics = {
      tasksQueued: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      queueSizes: {},
      avgCompletionTime: 0,
    };
    logger.info("RoleTaskQueue cleared (callbacks preserved)");
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  /**
   * Get queue metrics
   */
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  /**
   * Update queue size metrics
   */
  private updateQueueSizeMetrics(): void {
    this.metrics.queueSizes = {};
    for (const [role, queue] of Array.from(this.queues)) {
      this.metrics.queueSizes[role] = queue.size();
    }
  }

  /**
   * Update average completion time
   */
  private updateAvgCompletionTime(): void {
    if (this.completionTimes.length === 0) {
      this.metrics.avgCompletionTime = 0;
      return;
    }

    const sum = this.completionTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgCompletionTime = sum / this.completionTimes.length;
  }

  // ==========================================================================
  // Task Removal (Plan Mutations)
  // ==========================================================================

  /**
   * Remove a task from the queue entirely.
   * Used by plan mutation tools (remove_task, replan).
   * Only removes queued/pending tasks — completed/in_progress are left as-is.
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Remove from lookup
    this.tasks.delete(taskId);

    // Remove from role queue if still queued
    if (task.status === "queued") {
      const role = task.assigned_role.toLowerCase();
      const queue = this.queues.get(role);
      if (queue) {
        queue.remove(task);
        this.updateQueueSizeMetrics();
      }
    }

    logger.debug(`Task ${taskId} removed from queue`);
    return true;
  }

  // ==========================================================================
  // Utility
  // ==========================================================================
}
