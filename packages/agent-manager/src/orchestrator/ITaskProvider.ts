/**
 * ITaskProvider — Shared interface for task storage
 *
 * Both MemoryManager and TaskStore implement this interface.
 * Tools and DependencyResolver depend on this — not concrete classes.
 * Follows Dependency Inversion (D in SOLID).
 */

import type { Task, TaskStatus } from "../memory/types/Task.types.js";

export interface ITaskProvider {
  /** Get a task by ID (sync — reads from cache) */
  get(taskId: string): Task | undefined;
  /** Alias for get() — backward compat with MemoryManager */
  getTask(taskId: string): Task | undefined;
  /** Get all tasks (sync — reads from cache) */
  getAll(): Task[];
  /** Alias for getAll() — backward compat with MemoryManager */
  getAllTasks(): Task[];
  /** Get tasks filtered by status (sync) */
  getByStatus(status: TaskStatus): Task[];
  /** Add a task (async — persists to MongoDB first) */
  addTask(task: Task): Promise<void>;
  /** Remove a task by ID */
  removeTask(taskId: string): boolean;
  /** Update task status (async — persists to MongoDB first) */
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  /**
   * Mark a task as ready and enqueue for dispatch (async — persists to MongoDB first).
   */
  markReady(taskId: string): Promise<void>;
  /** Get tasks filtered by goalId (sync) */
  getByGoal(goalId: string): Task[];
}
