/**
 * GoalEvents — Domain events emitted after MongoDB writes succeed.
 *
 * Events are facts — they represent things that already happened.
 * Published by GoalManager/OrchestratorService after ITaskService writes.
 * Consumed by CrdtProjectionHandler, SocketNotificationHandler, etc.
 */

import type { Task } from "../../memory/types/Task.types.js";

// ─── Base ────────────────────────────────────────────────────

export interface GoalEvent {
  readonly type: string;
  readonly goalId: string;
  readonly teamId: string;
  readonly timestamp: number;
}

// ─── Task Events ─────────────────────────────────────────────

/** Plan approved → tasks created in MongoDB. */
export interface TasksCreated extends GoalEvent {
  readonly type: "tasks_created";
  readonly tasks: Task[];
  readonly planId: string;
  readonly plan: any;
}

/** Single task status change (ready, in_progress, completed, failed). */
export interface TaskStatusChanged extends GoalEvent {
  readonly type: "task_status_changed";
  readonly taskId: string;
  readonly oldStatus: string;
  readonly newStatus: string;
  readonly role?: string;
  readonly output?: unknown;
}

/** Task completed with dependants unblocked. */
export interface TaskCompleted extends GoalEvent {
  readonly type: "task_completed";
  readonly taskId: string;
  readonly role?: string;
  readonly output: any;
  readonly newlyReady: Task[];
}

// ─── Plan Events ─────────────────────────────────────────────

/** Plan status change (executing, completed, archived, interrupted). */
export interface PlanStatusChanged extends GoalEvent {
  readonly type: "plan_status_changed";
  readonly planId?: string;
  readonly status: string;
}

// ─── Goal Events ─────────────────────────────────────────────

/** Goal status change (planning, executing, completed, failed). */
export interface GoalStatusChanged extends GoalEvent {
  readonly type: "goal_status_changed";
  readonly status: string;
}

// ─── Lifecycle Events ────────────────────────────────────────

/** Tasks cleared for a goal (before replan). */
export interface TasksCleared extends GoalEvent {
  readonly type: "tasks_cleared";
}

// ─── Union ───────────────────────────────────────────────────

export type AnyGoalEvent =
  | TasksCreated
  | TaskStatusChanged
  | TaskCompleted
  | PlanStatusChanged
  | GoalStatusChanged
  | TasksCleared;
