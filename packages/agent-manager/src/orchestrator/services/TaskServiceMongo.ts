/**
 * MongoTaskService — Source of truth for task state.
 *
 * Implements ITaskService backed by MongoDB.
 * - Atomic status transitions via findOneAndUpdate with status guard
 * - Dependency cascade via queries (not in-memory)
 * - Bridges MongoDB schema (assignedRole, dependencies[]) to Task interface (assigned_role, prerequisites Map)
 *
 * Replaces: TaskStore (in-memory Map) + ITaskPersistence (fire-and-forget dual-write)
 */

import type { Task, TaskStatus } from "../../memory/types/Task.types.js";
import type { ITaskService } from "../interfaces/ITaskService.js";
import { rootLogger } from "../../logging.js";

const log = rootLogger.child({ module: "MongoTaskService" });

/** Mongoose-like model interface — avoids importing from @ping/backend. */
interface TaskModel {
  create(doc: any): Promise<any>;
  insertMany(docs: any[]): Promise<any[]>;
  findOne(filter: any): { lean(): Promise<any | null> };
  find(filter: any): { lean(): Promise<any[]> };
  findOneAndUpdate(filter: any, update: any, options?: any): { lean(): Promise<any | null> };
  countDocuments(filter: any): Promise<number>;
  deleteMany(filter: any): Promise<{ deletedCount: number }>;
  updateOne(filter: any, update: any): Promise<any>;
}

/** Valid state machine transitions. Any transition not listed here is rejected. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["ready", "discarded"],
  ready: ["in_progress", "discarded"],
  in_progress: ["completed", "failed"],
  completed: [],
  failed: ["ready"],
  discarded: [],
};

export class TaskServiceMongo implements ITaskService {
  constructor(private model: TaskModel) {}

  // ─── CRUD ─────────────────────────────────────────────────

  async create(task: Omit<Task, "createdAt" | "updatedAt">): Promise<Task> {
    const doc = await this.model.create(this.toDoc(task));
    return this.toTask(doc);
  }

  async createMany(goalId: string, teamId: string, tasks: Array<Omit<Task, "createdAt" | "updatedAt">>): Promise<Task[]> {
    const docs = tasks.map(t => this.toDoc({ ...t, goalId, teamId } as any));
    const result = await this.model.insertMany(docs);
    return result.map(d => this.toTask(d));
  }

  async get(taskId: string, goalId: string): Promise<Task | null> {
    const doc = await this.model.findOne({ taskId, goalId }).lean();
    return doc ? this.toTask(doc) : null;
  }

  async getByGoal(goalId: string): Promise<Task[]> {
    const docs = await this.model.find({ goalId }).lean();
    return docs.map(d => this.toTask(d));
  }

  async getByTeam(teamId: string): Promise<Task[]> {
    const docs = await this.model.find({ teamId }).lean();
    return docs.map(d => this.toTask(d));
  }

  async clearByGoal(goalId: string): Promise<number> {
    const result = await this.model.deleteMany({ goalId });
    log.info(`Cleared ${result.deletedCount} tasks for goal ${goalId}`);
    return result.deletedCount;
  }

  // ─── State Machine ────────────────────────────────────────

  async updateStatus(taskId: string, goalId: string, newStatus: TaskStatus, output?: unknown): Promise<Task> {
    const current = await this.model.findOne({ taskId, goalId }).lean();
    if (!current) throw new Error(`Task ${taskId} not found in goal ${goalId}`);

    const currentStatus = current.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${currentStatus} → ${newStatus} for task ${taskId}`);
    }

    const update: Record<string, any> = { status: newStatus };
    if (output !== undefined) update.output = output;
    if (newStatus === "completed") update.completedAt = new Date();

    // Atomic: only updates if status hasn't changed since we read it
    const updated = await this.model.findOneAndUpdate(
      { taskId, goalId, status: currentStatus },
      { $set: update },
      { new: true },
    ).lean();

    if (!updated) {
      throw new Error(`Concurrent status change: task ${taskId} no longer in ${currentStatus}`);
    }

    log.debug(`Task ${taskId}: ${currentStatus} → ${newStatus}`);
    return this.toTask(updated);
  }

  async completeTask(taskId: string, goalId: string, output: any): Promise<{ task: Task; newlyReady: Task[] }> {
    const task = await this.updateStatus(taskId, goalId, "completed" as TaskStatus, output);
    const newlyReady = await this.cascadeDependencies(taskId, goalId);
    return { task, newlyReady };
  }

  // ─── Queries ──────────────────────────────────────────────

  async isAllCompleteForGoal(goalId: string): Promise<boolean> {
    const incomplete = await this.model.countDocuments({
      goalId,
      status: { $nin: ["completed", "failed", "discarded"] },
    });
    return incomplete === 0;
  }

  async getReadyTasks(goalId: string): Promise<Task[]> {
    const docs = await this.model.find({ goalId, status: "ready" }).lean();
    return docs.map(d => this.toTask(d));
  }

  async getByStatus(goalId: string, status: TaskStatus): Promise<Task[]> {
    const docs = await this.model.find({ goalId, status }).lean();
    return docs.map(d => this.toTask(d));
  }

  // ─── Dependency Cascade ───────────────────────────────────

  /**
   * After a task completes, check its dependants.
   * For each dependant that had this task as a dependency:
   *   1. Check if ALL dependencies are now completed
   *   2. If so, transition the dependant to "ready"
   *
   * Returns the list of newly-ready tasks.
   */
  private async cascadeDependencies(completedTaskId: string, goalId: string): Promise<Task[]> {
    // Find tasks in this goal that depend on the completed task
    const dependants = await this.model.find({
      goalId,
      dependencies: completedTaskId,
      status: "pending",
    }).lean();

    if (dependants.length === 0) return [];

    const nowReady: Task[] = [];

    for (const dep of dependants) {
      // Check if ALL of this task's dependencies are now completed
      const allDepsCompleted = await this.areAllDependenciesCompleted(dep.dependencies, goalId);

      if (allDepsCompleted) {
        // Atomic transition: pending → ready (only if still pending)
        const updated = await this.model.findOneAndUpdate(
          { taskId: dep.taskId, goalId, status: "pending" },
          { $set: { status: "ready" } },
          { new: true },
        ).lean();

        if (updated) {
          log.info(`Cascade: ${completedTaskId} → ${dep.taskId} now ready`);
          nowReady.push(this.toTask(updated));
        }
      }
    }

    return nowReady;
  }

  /** Check if all task IDs in the dependency list have status "completed". */
  private async areAllDependenciesCompleted(dependencies: string[], goalId: string): Promise<boolean> {
    if (!dependencies || dependencies.length === 0) return true;

    const completedCount = await this.model.countDocuments({
      goalId,
      taskId: { $in: dependencies },
      status: "completed",
    });

    return completedCount === dependencies.length;
  }

  // ─── Mapping: MongoDB ↔ Task ──────────────────────────────

  /** Convert Task (domain) → MongoDB document fields. */
  private toDoc(task: any): Record<string, any> {
    return {
      taskId: task.id,
      goalId: task.goalId,
      teamId: task.teamId,
      title: task.title || task.description?.slice(0, 80),
      description: task.description,
      status: task.status || "pending",
      assignedRole: task.assigned_role,
      priority: task.priority ?? 3,
      output: task.output,
      planId: task.planId,
      dependencies: task.prerequisites
        ? Array.from(task.prerequisites.keys())
        : task.dependencies || [],
    };
  }

  /** Convert MongoDB document → Task (domain). */
  private toTask(doc: any): Task {
    // Reconstruct prerequisites Map from dependencies array
    // We can't know completion state from dependencies alone,
    // so we default to false — caller can enrich if needed.
    const prerequisites = new Map<string, boolean>(
      (doc.dependencies || []).map((d: string) => [d, false] as [string, boolean]),
    );

    return {
      id: doc.taskId,
      title: doc.title,
      description: doc.description,
      assigned_role: doc.assignedRole,
      status: doc.status as TaskStatus,
      priority: doc.priority ?? 3,
      output: doc.output,
      goalId: doc.goalId,
      planId: doc.planId,
      prerequisites,
      dependants: [], // rebuilt by DependencyResolver if needed
    };
  }
}
