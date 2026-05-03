/**
 * SocketNotificationHandler — Emits Socket.IO events for frontend.
 *
 * Subscribes to GoalEventBus as notification tier (fire-and-forget).
 * Failures logged at debug level — never blocks domain logic.
 */

import type { GoalEventBus } from "../events/GoalEventBus.js";
import type {
  TasksCreated,
  TaskStatusChanged,
  TaskCompleted,
  GoalStatusChanged,
} from "../events/GoalEvents.js";

export interface SocketNotificationCallbacks {
  onTaskUpdate?: (data: { taskId: string; status: string; role?: string; output?: any; timestamp?: number }) => void;
  onProgress?: (data: { teamId: string; state: string; message: string; timestamp?: string; [key: string]: any }) => void;
  onGoalStatusChange?: (data: { teamId: string; goalId: string; status: string }) => void;
  onPlanApproved?: (data: { planId: string; teamId: string; goalId?: string; tasksQueued: number; timestamp: string }) => void;
}

export class SocketNotificationHandler {
  constructor(private callbacks: SocketNotificationCallbacks) {}

  /** Wire all event subscriptions to the bus. */
  register(bus: GoalEventBus): void {
    bus.onNotification("task_status_changed", (e) => this.onTaskStatusChanged(e as TaskStatusChanged));
    bus.onNotification("task_completed", (e) => this.onTaskCompleted(e as TaskCompleted));
    bus.onNotification("tasks_created", (e) => this.onTasksCreated(e as TasksCreated));
    bus.onNotification("goal_status_changed", (e) => this.onGoalStatusChanged(e as GoalStatusChanged));
  }

  private async onTaskStatusChanged(event: TaskStatusChanged): Promise<void> {
    this.callbacks.onTaskUpdate?.({
      taskId: event.taskId,
      status: event.newStatus,
      role: event.role,
      timestamp: event.timestamp,
    });
  }

  private async onTaskCompleted(event: TaskCompleted): Promise<void> {
    this.callbacks.onTaskUpdate?.({
      taskId: event.taskId,
      status: "completed",
      role: event.role,
      timestamp: event.timestamp,
    });

    // Notify frontend about newly-ready tasks
    for (const ready of event.newlyReady) {
      this.callbacks.onTaskUpdate?.({
        taskId: ready.id,
        status: "ready",
        role: ready.assigned_role,
        timestamp: event.timestamp,
      });
    }
  }

  private async onTasksCreated(event: TasksCreated): Promise<void> {
    this.callbacks.onPlanApproved?.({
      planId: event.planId,
      teamId: event.teamId,
      goalId: event.goalId,
      tasksQueued: event.tasks.length,
      timestamp: new Date().toISOString(),
    });
  }

  private async onGoalStatusChanged(event: GoalStatusChanged): Promise<void> {
    this.callbacks.onGoalStatusChange?.({
      teamId: event.teamId,
      goalId: event.goalId,
      status: event.status,
    });
  }
}
