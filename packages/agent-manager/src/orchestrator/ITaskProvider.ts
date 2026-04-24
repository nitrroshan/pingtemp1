/**
 * ITaskProvider — Shared interface for task storage
 *
 * Both MemoryManager and TaskStore implement this interface.
 * Tools and DependencyResolver depend on this — not concrete classes.
 * Follows Dependency Inversion (D in SOLID).
 */

import type { Task, TaskStatus } from "../memory/types/Task.types.js";

export interface ITaskProvider {
  /** Get a task by ID */
  get(taskId: string): Task | undefined;
  /** Alias for get() — backward compat with MemoryManager */
  getTask(taskId: string): Task | undefined;
  /** Get all tasks */
  getAll(): Task[];
  /** Alias for getAll() — backward compat with MemoryManager */
  getAllTasks(): Task[];
  /** Get tasks filtered by status */
  getByStatus(status: TaskStatus): Task[];
  /** Add a task */
  addTask(task: Task): void;
  /** Remove a task by ID */
  removeTask(taskId: string): boolean;
  /** Update task status */
  updateTaskStatus(taskId: string, status: TaskStatus): void;
  /**
   * Mark a task as ready and enqueue for dispatch.
   * Encapsulates status change + queue enqueue — tools call this
   * instead of reaching into queue directly.
   */
  markReady(taskId: string): void;
}
