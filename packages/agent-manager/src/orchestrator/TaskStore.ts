/**
 * TaskStore — Single Writer for Task State
 *
 * The ONLY class that changes task status. Everyone else reads.
 * Enforces valid state machine transitions. Owns RoleTaskQueue.
 *
 * Extracted from MemoryManager to follow SRP:
 * - TaskStore = task state + queue dispatch
 * - DependencyResolver = DAG queries
 * - PluginRegistry = context/knowledge (was MemoryCoordinator)
 * - ContextBuilder = prompt assembly (A6 Step 3, future)
 */

import { Logger } from "tslog";
import type { Task, TaskStatus } from "../memory/types/Task.types.js";
import type { ITaskProvider } from "./ITaskProvider.js";
import { RoleTaskQueue } from "../util/RoleTaskQueue.js";
import type { TaskCallbacks, TaskWithContext } from "../util/RoleTaskQueue.types.js";

const log = new Logger({ name: "TaskStore" });

/**
 * Valid state transitions. Any transition not listed here throws.
 * 'cancelled' is handled separately in updateStatus() — mapped to 'failed'.
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready"],
  ready: ["in_progress"],
  in_progress: ["completed", "failed"],
  completed: [],           // terminal state — nothing after completion
  failed: ["ready"],       // retry: failed → ready (fresh attempt)
};

export interface TaskStoreCallbacks {
  onStatusChanged?: (taskId: string, oldStatus: TaskStatus, newStatus: TaskStatus) => void;
  onTaskCreated?: (task: Task) => void;
  onTaskRemoved?: (taskId: string) => void;
}

export class TaskStore implements ITaskProvider {
  private tasks = new Map<string, Task>();
  public readonly queue: RoleTaskQueue;
  private storeCallbacks: TaskStoreCallbacks = {};

  constructor() {
    this.queue = new RoleTaskQueue();
    log.info("TaskStore initialized");
  }

  // ═══════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════

  /** Add a task. Queues it in RoleTaskQueue if ready. */
  create(task: Task): void {
    if (this.tasks.has(task.id)) {
      throw new Error(`Task '${task.id}' already exists`);
    }

    this.tasks.set(task.id, task);

    // If task is ready (no unmet prerequisites), queue it
    if (this.isReady(task)) {
      task.status = "ready";
      this.queueTask(task);
    }

    this.storeCallbacks.onTaskCreated?.(task);
    log.debug(`Task created: ${task.id} (${task.status})`);
  }

  /** Get a task by ID. */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /** Alias for get() — satisfies ITaskProvider interface. */
  getTask(taskId: string): Task | undefined {
    return this.get(taskId);
  }

  /** Add a task. Alias for create() — satisfies ITaskProvider interface. */
  addTask(task: Task): void {
    this.create(task);
  }

  /** Get all tasks. */
  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  /** Alias for getAll() — satisfies DependencyResolver's TaskSource interface. */
  getAllTasks(): Task[] {
    return this.getAll();
  }

  /** Get tasks by role. */
  getByRole(role: string): Task[] {
    return this.getAll().filter((t) => t.assigned_role === role.toLowerCase());
  }

  /** Get tasks by status. */
  getByStatus(status: TaskStatus): Task[] {
    return this.getAll().filter((t) => t.status === status);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Update task status with state machine enforcement.
   * Invalid transitions throw.
   */
  updateStatus(taskId: string, newStatus: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    const oldStatus = task.status;

    // 'cancelled' is allowed from any non-terminal state
    if (newStatus === ("cancelled" as any)) {
      if (oldStatus === "completed") {
        throw new Error(`Cannot cancel completed task '${taskId}'`);
      }
      task.status = "failed"; // map cancelled → failed for compatibility
      this.storeCallbacks.onStatusChanged?.(taskId, oldStatus, "failed");
      return;
    }

    const allowed = VALID_TRANSITIONS[oldStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: '${taskId}' ${oldStatus} → ${newStatus}. ` +
        `Allowed: ${(allowed || []).join(", ") || "none (terminal state)"}`,
      );
    }

    task.status = newStatus;
    this.storeCallbacks.onStatusChanged?.(taskId, oldStatus, newStatus);
    log.debug(`Task ${taskId}: ${oldStatus} → ${newStatus}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // MUTATIONS (plan changes mid-flight)
  // ═══════════════════════════════════════════════════════════════════

  /** Update task properties (title, description, role, priority, deps). */
  updateTask(taskId: string, patch: Partial<Pick<Task, "description" | "assigned_role" | "priority" | "context">>): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    if (patch.description !== undefined) task.description = patch.description;
    if (patch.assigned_role !== undefined) task.assigned_role = patch.assigned_role.toLowerCase();
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.context !== undefined) task.context = { ...task.context, ...patch.context };

    log.debug(`Task ${taskId} updated`);
  }

  /** Remove a task. Cleans up references in other tasks. */
  remove(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    this.tasks.delete(taskId);
    this.queue.removeTask(taskId);

    // Clean up references in other tasks' prerequisites
    for (const other of this.tasks.values()) {
      if (other.prerequisites?.has(taskId)) {
        other.prerequisites.delete(taskId);
      }
      if (Array.isArray(other.dependants)) {
        other.dependants = other.dependants.filter((d) => d !== taskId);
      }
    }

    this.storeCallbacks.onTaskRemoved?.(taskId);
    log.debug(`Task ${taskId} removed`);
    return true;
  }

  /** Alias for remove() — satisfies ITaskProvider interface. */
  removeTask(taskId: string): boolean {
    return this.remove(taskId);
  }

  /** Alias for updateStatus() — satisfies ITaskProvider interface. */
  updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.updateStatus(taskId, status);
  }

  /** Store task output after completion. */
  storeOutput(taskId: string, output: any): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    task.output = output;
  }

  /** Clear all tasks (new plan). */
  clear(): void {
    this.tasks.clear();
    this.queue.clear();
    log.info("TaskStore cleared");
  }

  // ═══════════════════════════════════════════════════════════════════
  // DEPENDENCY RESOLUTION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Complete a task: store output, update dependants, return newly ready tasks.
   */
  completeTask(taskId: string, output: any): Task[] {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error(`completeTask: Task '${taskId}' not found`);
      return [];
    }

    // Update status
    this.updateStatus(taskId, "completed");
    task.output = output;

    // Complete in queue (metrics)
    try {
      this.queue.completeTask(taskId, output);
    } catch {
      // May not be in queue if manually managed
    }

    // Update dependants: mark prerequisite met, enrich context, collect newly ready
    const newlyReady: Task[] = [];
    for (const other of this.tasks.values()) {
      if (other.prerequisites?.has(taskId)) {
        other.prerequisites.set(taskId, true);

        // Enrich dependent task context with this task's output
        this.enrichDependantContext(other, task);

        if (this.isReady(other) && other.status === "pending") {
          other.status = "ready";
          this.queueTask(other);
          newlyReady.push(other);
        }
      }
    }

    return newlyReady;
  }

  /** Check if all tasks are complete. */
  isAllComplete(): boolean {
    if (this.tasks.size === 0) return false;
    return this.getAll().every((t) => t.status === "completed" || t.status === "failed");
  }

  // ═══════════════════════════════════════════════════════════════════
  // CALLBACKS
  // ═══════════════════════════════════════════════════════════════════

  /** Set TaskStore-level callbacks. */
  setCallbacks(callbacks: TaskStoreCallbacks): void {
    this.storeCallbacks = callbacks;
  }

  /** Set RoleTaskQueue callbacks (for OrchestratorService). */
  setQueueCallbacks(callbacks: TaskCallbacks): void {
    this.queue.setCallbacks(callbacks);
  }

  // ═══════════════════════════════════════════════════════════════════
  // METRICS
  // ═══════════════════════════════════════════════════════════════════

  get size(): number {
    return this.tasks.size;
  }

  getMetrics() {
    return this.queue.getMetrics();
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNALS
  // ═══════════════════════════════════════════════════════════════════

  /** Check if a task has all prerequisites met. */
  private isReady(task: Task): boolean {
    if (!task.prerequisites || task.prerequisites.size === 0) return true;
    return Array.from(task.prerequisites.values()).every((v) => v === true);
  }

  /**
   * Enrich a dependant task's context with a completed upstream task's output.
   * Called at completion time so context is pre-built — dispatchTask just reads it.
   */
  private enrichDependantContext(dependant: Task, completedUpstream: Task): void {
    const ctx = (typeof dependant.context === "object" ? dependant.context : {}) as Record<string, any>;

    // Initialize arrays if needed
    if (!Array.isArray(ctx.upstreamOutputs)) ctx.upstreamOutputs = [];
    if (!Array.isArray(ctx.upstreamArtifacts)) ctx.upstreamArtifacts = [];
    if (!Array.isArray(ctx.upstreamNotes)) ctx.upstreamNotes = [];

    // Add upstream task summary
    if (completedUpstream.output) {
      ctx.upstreamOutputs.push({
        taskId: completedUpstream.id,
        role: completedUpstream.assigned_role,
        summary: completedUpstream.output.summary || "",
      });

      // Collect deliverables as artifact references
      if (Array.isArray(completedUpstream.output.deliverables)) {
        ctx.upstreamArtifacts.push(...completedUpstream.output.deliverables);
      }

      // Collect next steps as notes for downstream
      if (Array.isArray(completedUpstream.output.nextSteps)) {
        for (const step of completedUpstream.output.nextSteps) {
          ctx.upstreamNotes.push(`From ${completedUpstream.assigned_role}: ${step}`);
        }
      }
    }

    dependant.context = ctx;
  }

  /** Convert Task to TaskWithContext and queue it. */
  private queueTask(task: Task): void {
    const context = typeof task.context === "string"
      ? JSON.parse(task.context)
      : task.context || {};

    const taskWithContext: TaskWithContext = {
      id: task.id,
      description: task.description,
      assigned_role: task.assigned_role,
      priority: task.priority || 0,
      context: {
        previousOutputs: Object.values(context),
        artifacts: [],
      },
      createdAt: Date.now(),
      status: "queued",
    };

    this.queue.queueTask(taskWithContext);
  }
}
