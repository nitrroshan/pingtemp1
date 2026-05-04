/**
 * ITaskService — Source of truth for task state (MongoDB).
 *
 * All task reads and writes go through this interface.
 * Production: MongoTaskService. Tests: FakeTaskService.
 * NO in-memory cache. Every call hits the database.
 *
 * Replaces: TaskStore (in-memory Map) + ITaskPersistence (fire-and-forget).
 */

import type { Task, TaskStatus } from "../../memory/types/Task.types.js";

export interface ITaskService {
  // ─── CRUD ─────────────────────────────────────────────────
  create(task: Omit<Task, "createdAt" | "updatedAt">): Promise<Task>;
  createMany(goalId: string, teamId: string, tasks: Array<Omit<Task, "createdAt" | "updatedAt">>): Promise<Task[]>;
  get(taskId: string, goalId: string): Promise<Task | null>;
  getByGoal(goalId: string): Promise<Task[]>;
  getByTeam(teamId: string): Promise<Task[]>;
  clearByGoal(goalId: string): Promise<number>;

  // ─── State Machine ────────────────────────────────────────
  /** Atomic status transition. Rejects if current status doesn't allow transition. */
  updateStatus(taskId: string, goalId: string, newStatus: TaskStatus, output?: unknown): Promise<Task>;

  /**
   * Complete task: set status to completed, store output, cascade dependencies.
   * Returns the completed task + dependants that became ready.
   */
  completeTask(taskId: string, goalId: string, output: any): Promise<{
    task: Task;
    newlyReady: Task[];
  }>;

  // ─── Queries ──────────────────────────────────────────────
  isAllCompleteForGoal(goalId: string): Promise<boolean>;
  getReadyTasks(goalId: string): Promise<Task[]>;
  getByStatus(goalId: string, status: TaskStatus): Promise<Task[]>;
}
