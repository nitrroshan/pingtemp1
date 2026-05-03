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

import { rootLogger } from "../logging.js";
import type { Task, TaskStatus } from "../memory/types/Task.types.js";
import type { ITaskProvider } from "./ITaskProvider.js";
import type { GoalConfig } from "./types.js";
import { RoleTaskQueue } from "../util/RoleTaskQueue.js";
import type { TaskCallbacks, TaskWithContext } from "../util/RoleTaskQueue.types.js";

const log = rootLogger.child({ module: "TaskStore" });

/**
 * Valid state transitions. Any transition not listed here throws.
 * 'cancelled' is handled separately in updateStatus() — mapped to 'failed'.
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "discarded"],
  ready: ["in_progress", "discarded"],
  in_progress: ["completed", "failed"],
  completed: [],           // terminal state — nothing after completion
  failed: ["ready"],       // retry: failed → ready (fresh attempt)
  discarded: [],           // terminal state — replaced by replan
};

export interface TaskStoreCallbacks {
  onStatusChanged?: (taskId: string, oldStatus: TaskStatus, newStatus: TaskStatus) => void;
  onTaskCreated?: (task: Task) => void;
  onTaskRemoved?: (taskId: string) => void;
}

/**
 * TaskStorePersistence — Write-through adapter for durable persistence.
 *
 * When set, TaskStore writes to this adapter BEFORE updating the in-memory Map.
 * If the adapter throws, the in-memory Map is NOT updated (consistency).
 * Reads always come from the in-memory Map (fast, sync).
 *
 * This eliminates the dual-write problem: MongoDB is the authoritative write target,
 * the Map is just a read cache.
 */
export interface TaskStorePersistence {
  saveTasks(goalId: string, teamId: string, tasks: Array<{
    taskId: string; goalId: string; teamId: string; title?: string;
    description: string; status: string; assignedRole: string;
    priority?: number; output?: unknown; planId?: string; dependencies?: string[];
  }>): Promise<void>;
  updateTaskStatus(taskId: string, goalId: string, status: string, output?: unknown): Promise<void>;
  clearTasksByGoal(goalId: string): Promise<void>;
}

export class TaskStore implements ITaskProvider {
  private tasks = new Map<string, Task>();
  public readonly queue: RoleTaskQueue;
  private storeCallbacks: TaskStoreCallbacks = {};

  /** Goal-level config — looked up by goalId, injected into task.context on create */
  private goalConfigs = new Map<string, GoalConfig>();

  /** Role-filtered event listeners: Map<"role:event", callback[]> */
  private roleListeners = new Map<string, Array<(task: Task) => void>>();

  /** Write-through persistence adapter (MongoDB). When set, writes go to DB first. */
  private persistence: TaskStorePersistence | null = null;
  private teamId: string = "";

  constructor() {
    this.queue = new RoleTaskQueue();
    log.info("TaskStore initialized");
  }

  /** Set the write-through persistence adapter. Writes go to DB BEFORE updating the Map. */
  setPersistence(persistence: TaskStorePersistence, teamId: string): void {
    this.persistence = persistence;
    this.teamId = teamId;
    log.info(`TaskStore persistence enabled (teamId: ${teamId})`);
  }

  /**
   * Register goal-level config. All tasks with this goalId inherit repoUrl/repoBranch.
   * Looked up by goalId — multi-goal safe.
   */
  setGoalConfig(config: GoalConfig): void {
    this.goalConfigs.set(config.goalId, { ...config });
    log.info(`Goal config set for ${config.goalId}: repoUrl=${config.repoUrl || 'none'}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ROLE-FILTERED LISTENERS (for ChatAgent)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Subscribe to task events filtered by role.
   * Event types: "ready" (status → ready), "completed", "failed"
   */
  onRoleEvent(role: string, event: "ready" | "completed" | "failed", cb: (task: Task) => void): void {
    const key = `${role.toLowerCase()}:${event}`;
    const listeners = this.roleListeners.get(key) || [];
    listeners.push(cb);
    this.roleListeners.set(key, listeners);
  }

  /** Fire role-filtered event listeners */
  private fireRoleEvent(task: Task, event: "ready" | "completed" | "failed"): void {
    const key = `${task.assigned_role}:${event}`;
    const listeners = this.roleListeners.get(key);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(task); } catch (err) { log.error({ err }, `Role listener error: ${key}`); }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════

  /** Add a task. Persists to MongoDB FIRST, then updates Map. Queues if ready. */
  async create(task: Task): Promise<void> {
    if (!task.goalId) {
      log.error(`Task '${task.id}' created without goalId — this is a data integrity bug. Caller must set goalId.`);
    }
    if (this.tasks.has(task.id)) {
      throw new Error(`Task '${task.id}' already exists`);
    }

    // Inject goal config into task context (repoUrl, repoBranch)
    if (task.goalId) {
      const goalConfig = this.goalConfigs.get(task.goalId);
      if (goalConfig) {
        task.context = {
          repoUrl: goalConfig.repoUrl,
          repoBranch: goalConfig.repoBranch,
          ...task.context,
        };
      }
    }

    // Determine final status before persisting
    if (this.isReady(task) && (task.status === "pending" || task.status === "ready")) {
      task.status = "ready";
    }

    // Persist to MongoDB FIRST — if this fails, Map is NOT updated
    if (this.persistence && task.goalId) {
      await this.persistence.saveTasks(task.goalId, this.teamId, [{
        taskId: task.id,
        goalId: task.goalId,
        teamId: this.teamId,
        title: task.title || task.description?.slice(0, 80),
        description: task.description,
        status: task.status,
        assignedRole: task.assigned_role,
        priority: task.priority,
        output: task.output,
        planId: task.planId,
        dependencies: task.prerequisites ? Array.from(task.prerequisites.keys()) : [],
      }]);
    }

    // MongoDB succeeded — update Map (read cache)
    this.tasks.set(task.id, task);

    // Enrich context with upstream outputs + queue if ready
    if (task.status === "ready") {
      if (task.prerequisites) {
        for (const [depId, met] of task.prerequisites) {
          if (met) {
            const upstream = this.tasks.get(depId);
            if (upstream?.output) {
              this.enrichDependantContext(task, upstream);
            }
          }
        }
      }
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
  async addTask(task: Task): Promise<void> {
    await this.create(task);
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

  /** Get tasks by goal ID. */
  getByGoal(goalId: string): Task[] {
    return this.getAll().filter((t) => t.goalId === goalId);
  }

  /** Get tasks by plan ID. */
  getByPlan(planId: string): Task[] {
    return this.getAll().filter((t) => t.planId === planId);
  }

  /** Check if all tasks for a specific goal are done. */
  isAllCompleteForGoal(goalId: string): boolean {
    const goalTasks = this.getByGoal(goalId);
    if (goalTasks.length === 0) return false;
    return goalTasks.every((t) => t.status === "completed" || t.status === "failed" || t.status === "discarded");
  }

  /** Remove all tasks for a specific goal. Used when replanning within a goal. */
  /** Clear all tasks for a goal. Persists to MongoDB FIRST. */
  async clearByGoal(goalId: string): Promise<void> {
    // MongoDB FIRST — prevents zombie tasks on crash
    if (this.persistence) {
      await this.persistence.clearTasksByGoal(goalId);
    }

    const toRemove = this.getByGoal(goalId);
    for (const task of toRemove) {
      this.remove(task.id);
    }
    log.info(`Cleared ${toRemove.length} tasks for goal ${goalId}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Update task status. Persists to MongoDB FIRST, then updates Map.
   * Invalid transitions throw.
   */
  async updateStatus(taskId: string, newStatus: TaskStatus): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    const oldStatus = task.status;

    // 'cancelled' is allowed from any non-terminal state
    if (newStatus === ("cancelled" as any)) {
      if (oldStatus === "completed") {
        throw new Error(`Cannot cancel completed task '${taskId}'`);
      }
      // Persist to MongoDB FIRST
      if (this.persistence && task.goalId) {
        await this.persistence.updateTaskStatus(taskId, task.goalId, "failed", task.output);
      }
      task.status = "failed";
      this.storeCallbacks.onStatusChanged?.(taskId, oldStatus, "failed");
      this.fireRoleEvent(task, "failed");
      return;
    }

    const allowed = VALID_TRANSITIONS[oldStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: '${taskId}' ${oldStatus} → ${newStatus}. ` +
        `Allowed: ${(allowed || []).join(", ") || "none (terminal state)"}`,
      );
    }

    // Persist to MongoDB FIRST — if this fails, Map is NOT updated
    if (this.persistence && task.goalId) {
      await this.persistence.updateTaskStatus(taskId, task.goalId, newStatus, task.output);
    }

    // MongoDB succeeded — update Map
    task.status = newStatus;
    this.storeCallbacks.onStatusChanged?.(taskId, oldStatus, newStatus);

    // Fire role-filtered listeners for ChatAgent
    if (newStatus === "ready") this.fireRoleEvent(task, "ready");
    else if (newStatus === "completed") this.fireRoleEvent(task, "completed");
    else if (newStatus === "failed") this.fireRoleEvent(task, "failed");

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
  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.updateStatus(taskId, status);
  }

  /** Mark a task as ready and enqueue for dispatch. Satisfies ITaskProvider. */
  async markReady(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (task.status !== "pending" && task.status !== "failed") return;
    await this.updateStatus(taskId, "ready" as TaskStatus);
    this.queueTask(task);
    log.debug(`Task ${taskId} marked ready and queued`);
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
   * Complete a task: persist to MongoDB, update Map, cascade dependants.
   * Returns newly ready tasks.
   */
  async completeTask(taskId: string, output: any): Promise<Task[]> {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error(`completeTask: Task '${taskId}' not found`);
      return [];
    }

    // Set output BEFORE updateStatus so MongoDB gets both in one write
    task.output = output;

    // Persist to MongoDB FIRST, then update Map
    await this.updateStatus(taskId, "completed");

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

        if (this.isReady(other) && (other.status === "pending" || other.status === "failed")) {
          const wasRetry = other.status === "failed";
          // Route through updateStatus for MongoDB persistence + callbacks
          await this.updateStatus(other.id, "ready" as TaskStatus);
          this.queueTask(other);
          newlyReady.push(other);
          if (wasRetry) {
            log.info(`Task ${other.id} auto-retrying — was failed but prerequisites now met`);
          }
        }
      }
    }

    return newlyReady;
  }

  /** Check if all tasks are done (completed, failed, or discarded). */
  isAllComplete(): boolean {
    if (this.tasks.size === 0) return false;
    return this.getAll().every((t) => t.status === "completed" || t.status === "failed" || t.status === "discarded");
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
   * Enrich a dependant task's context with an upstream task's output.
   * Works for both completed tasks (output.summary) and failed tasks (output.error).
   */
  private enrichDependantContext(dependant: Task, upstream: Task): void {
    const ctx = (typeof dependant.context === "object" ? dependant.context : {}) as Record<string, any>;

    // Initialize arrays if needed
    if (!Array.isArray(ctx.upstreamOutputs)) ctx.upstreamOutputs = [];
    if (!Array.isArray(ctx.upstreamArtifacts)) ctx.upstreamArtifacts = [];
    if (!Array.isArray(ctx.upstreamNotes)) ctx.upstreamNotes = [];

    // Add upstream task summary (works for both completed and failed tasks)
    if (upstream.output) {
      ctx.upstreamOutputs.push({
        taskId: upstream.id,
        role: upstream.assigned_role,
        status: upstream.status,
        summary: upstream.output.summary || upstream.output.error || "",
      });

      // Collect deliverables as artifact references
      if (Array.isArray(upstream.output.deliverables)) {
        ctx.upstreamArtifacts.push(...upstream.output.deliverables);
      }

      // Collect next steps as notes for downstream
      if (Array.isArray(upstream.output.nextSteps)) {
        for (const step of upstream.output.nextSteps) {
          ctx.upstreamNotes.push(`From ${upstream.assigned_role}: ${step}`);
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
      goalId: task.goalId,
      context: {
        previousOutputs: Object.values(context),
        artifacts: [],
      },
      createdAt: Date.now(),
      status: "queued",
    };

    try {
      this.queue.queueTask(taskWithContext);
    } catch {
      // Already in queue — safe to skip (can happen when create() pre-queues
      // a task whose upstream later completes and triggers completeTask re-queue)
      log.debug(`Task ${task.id} already in queue — skipping re-queue`);
    }
  }
}
