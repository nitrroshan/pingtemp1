/**
 * CrdtProjectionHandler — Projects MongoDB state changes to CRDT.
 *
 * Subscribes to GoalEventBus. Best-effort — failures logged, never thrown.
 * Handles:
 *   Flow A: status/metadata projection (MongoDB → CRDT copy)
 *   Flow C: document creation (MongoDB data → CRDT rich docs)
 *
 * @see docs/features/crdt-first-architecture/feature_architecture.md
 */

import type { ICrdtContentService } from "../interfaces/ICrdtContentService.js";
import type { GoalEventBus } from "../events/GoalEventBus.js";
import type {
  TasksCreated,
  TaskStatusChanged,
  TaskCompleted,
  PlanProposed,
  PlanStatusChanged,
  GoalStatusChanged,
} from "../events/GoalEvents.js";

export class CrdtProjectionHandler {
  constructor(private crdt: ICrdtContentService) {}

  /** Wire all event subscriptions to the bus. */
  register(bus: GoalEventBus): void {
    bus.onProjection("tasks_created", (e) => this.onTasksCreated(e as TasksCreated));
    bus.onProjection("task_status_changed", (e) => this.onTaskStatusChanged(e as TaskStatusChanged));
    bus.onProjection("task_completed", (e) => this.onTaskCompleted(e as TaskCompleted));
    bus.onProjection("plan_proposed", (e) => this.onPlanProposed(e as PlanProposed));
    bus.onProjection("plan_status_changed", (e) => this.onPlanStatusChanged(e as PlanStatusChanged));
    bus.onProjection("goal_status_changed", (e) => this.onGoalStatusChanged(e as GoalStatusChanged));
  }

  /** Flow C: Create CRDT docs for all tasks + plan after approval. */
  private async onTasksCreated(event: TasksCreated): Promise<void> {
    if (!this.crdt.isAvailable()) return;

    // Parallel — each task doc is independent
    await Promise.allSettled(
      event.tasks.map(t => this.crdt.createTaskDoc(t)),
    );

    await this.crdt.createPlanDoc(event.plan, event.goalId);
    await this.crdt.updateIndex(event.tasks);
  }

  /** Flow A: Project single task status change to CRDT. */
  private async onTaskStatusChanged(event: TaskStatusChanged): Promise<void> {
    if (!this.crdt.isAvailable()) return;
    await this.crdt.syncTaskStatus(event.taskId, event.newStatus, event.output);
  }

  /** Flow A: Project task completion + update index. */
  private async onTaskCompleted(event: TaskCompleted): Promise<void> {
    if (!this.crdt.isAvailable()) return;
    await this.crdt.syncTaskStatus(event.taskId, "completed", event.output);
    // Index will be stale until next full rebuild — acceptable for agent browsing
  }

  /** Project plan status change. */
  private async onPlanStatusChanged(event: PlanStatusChanged): Promise<void> {
    if (!this.crdt.isAvailable()) return;
    await this.crdt.syncPlanStatus(event.status);
  }

  /** Flow C: Write plan doc to CRDT at proposal time (before approval). */
  private async onPlanProposed(event: PlanProposed): Promise<void> {
    // Resolve FIRST — CRDT may not be available until goal is resolved
    await this.crdt.resolveForGoal(event.goalId);
    if (!this.crdt.isAvailable()) return;
    await this.crdt.createPlanDoc(event.plan, event.goalId);
  }

  /** Project goal status change. */
  private async onGoalStatusChanged(event: GoalStatusChanged): Promise<void> {
    if (!this.crdt.isAvailable()) return;
    await this.crdt.syncGoalStatus(event.status);
  }
}
