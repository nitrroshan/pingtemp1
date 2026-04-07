/*Memory Manager Responsibilities

1) Task Storage: Stores all tasks with their metadata
@example{
  "task_id": "",
  "description": "",
  "assigned_role": "",
  context: {},
  "status": "pending, in_progress, completed, failed",
  "output_type": "result | delegate | question | error | request_info",
  "output_data": "",
  "prerequisites": []
}

2) Task Dependency Management: 
Tracks prerequisites an Determines which tasks are ready for execution (no pending prerequisites).

3) Context Store

Stores results, intermediate data, and shared context for tasks.

Provides query interface for AgentManager to fetch context when needed.

4) Task Lifecycle Updates

Updates task status (pending, in_progress, completed, failed).

status:
1) Ready: Can be taken up by assigned role for execution
2) pending: Dependencies need to be completed first
3) inProgress: assigned to agent
4) completed: final output is returned and task is compelte
5) failed: the task is failed.

Updates context when an agent completes a task.

Updates dependent tasks when prerequisite tasks are done. */

import { randomUUID } from "crypto";
import { Logger } from "tslog";
import type { Task, TaskStatus } from "./types/index.js";
import { RoleTaskQueue } from "../util/RoleTaskQueue.js";
import type {
  TaskWithContext,
  QueueMetrics,
} from "../util/RoleTaskQueue.types.js";

const log = new Logger({ name: "MemoryManager" });

export class MemoryManager {
  private tasks: Map<string, Task>;
  public readonly taskQueue: RoleTaskQueue; // Expose for direct event subscription

  constructor() {
    // Initialize task storage and context store
    this.tasks = new Map(); // task_id -> task object
    this.taskQueue = new RoleTaskQueue(); // Priority queue for event-driven execution

    log.info("MemoryManager initialized");
  }
  addTask(task: Task): void {
    if (!task.id) {
      task.id = randomUUID();
    }
    this.tasks.set(task.id, task);
    log.info("Task added", {
      id: task.id,
      description: task.description,
      assigned_role: task.assigned_role,
    });

    // Auto-queue if ready (v1.1: event-driven execution)
    if (this.checkTaskReady(task.id)) {
      this.queueTask(task);
    }
  }

  getTasks(role: string): Task[] {
    const readyTasks: Task[] = [];
    log.info("Fetching tasks for role", { role });
    for (const task of Array.from(this.tasks.values())) {
      log.debug("Checking task readiness", {
        taskId: task.id,
        assigned_role: task.assigned_role,
      });
      if (this.checkTaskReady(task.id) && task.assigned_role === role) {
        readyTasks.push(task);
      }
    }
    log.debug("Fetched tasks for role", {
      role,
      readyTasksCount: readyTasks.length,
    });

    return readyTasks;
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error("updateTaskStatus: Task not found", { taskId });
      return;
    }

    task.status = status;
    log.info("Task status updated", { taskId, status });
    this.tasks.set(task.id, task);
  }

  /**
   * Complete a task and return any newly-ready dependent tasks
   */
  completeTask(taskId: string, outputData: any): Task[] {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error("completeTask: Task not found", { taskId });
      return [];
    }
    task.output = outputData;
    this.updateTaskStatus(taskId, "completed");
    this.updateDependantTasks(task);
    this.tasks.set(taskId, task);
    log.info("Task status updated", { taskId, status: "completed" });

    // Complete in queue (v1.1)
    try {
      this.taskQueue.completeTask(taskId, outputData);
    } catch (error) {
      // Task might not be in queue (backward compatibility)
      log.debug("Task not in queue", { taskId, error });
    }

    // Auto-queue ready dependents (0ms latency) and track them
    const newlyReadyTasks: Task[] = [];
    for (const dependantId of task.dependants) {
      if (this.checkTaskReady(dependantId)) {
        const dependantTask = this.tasks.get(dependantId);
        if (dependantTask) {
          this.queueTask(dependantTask);
          newlyReadyTasks.push(dependantTask);
        }
      }
    }
    
    return newlyReadyTasks;
  }

  isComplete(): boolean {
    for (const task of Array.from(this.tasks.values())) {
      if (task.status !== "completed") {
        return false;
      }
    }
    log.info("All tasks completed");
    return true;
  }

  private checkTaskReady(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error("checkTaskReady: Task not found", { taskId });
      return false;
    }
    // Task with no prerequisites is ready
    if (task.prerequisites.size === 0) {
      log.debug("Task is ready (no prerequisites)", { taskId });
      return true;
    }
    // Check if all prerequisites are completed
    for (const completed of Array.from(task.prerequisites.values())) {
      if (completed === false) {
        log.debug("Task not ready (pending prerequisites)", { taskId });
        return false;
      }
    }
    log.debug("Task is ready (all prerequisites completed)", { taskId });
    return true;
  }

  private updateDependantTasks(task: Task): void {
    for (const dependantId of task?.dependants) {
      const dependantTask = this.tasks.get(dependantId);
      this.updateContext(dependantTask, task);
      dependantTask?.prerequisites.set(task.id, true);

      this.tasks.set(dependantId, dependantTask!);
    }
  }

  private updateContext(task: Task | undefined, completedTask: Task): void {
    if (!task || !completedTask.output) {
      log.warn("updateContext: Missing task or output_data", {
        task,
        completedTask,
      });
      return;
    }

    // Merge completed task's output into dependent task's context
    task.context = {
      ...(task.context || {}),
      [completedTask.id]: {
        description: completedTask.description,
        assigned_role: completedTask.assigned_role,
        output: completedTask.output,
        status: completedTask.status,
      },
    };
    log.debug("Context updated for task", {
      taskId: task.id,
      completedTaskId: completedTask.id,
    });
  }

  // ==========================================================================
  // v1.1: RoleTaskQueue Integration
  // ==========================================================================

  /**
   * Convert Task to TaskWithContext for queue
   */
  private toTaskWithContext(task: Task): TaskWithContext {
    // Handle both string and object context for backward compatibility
    const context =
      typeof task.context === "string"
        ? JSON.parse(task.context)
        : task.context || {};
    const previousOutputs = Object.entries(context).map(
      ([taskId, data]: [string, any]) => ({
        taskId,
        output: data.output,
      }),
    );

    return {
      id: task.id,
      description: task.description,
      assigned_role: task.assigned_role,
      priority: (task as any).priority || 0, // Default priority
      context: {
        previousOutputs,
        artifacts: [], // TODO: Implement artifact tracking
      },
      createdAt: Date.now(),
      status: "queued",
    };
  }

  /**
   * Queue a ready task (internal use)
   */
  private queueTask(task: Task): void {
    try {
      // Check if task already exists in queue (avoid duplicate queue errors)
      const existingInQueue = this.taskQueue.getTask(task.id);
      if (existingInQueue) {
        log.debug("Task already in queue, skipping", { taskId: task.id, status: existingInQueue.status });
        return;
      }
      
      // Update task status to ready before queueing
      task.status = "ready";
      this.tasks.set(task.id, task);
      
      const taskWithContext = this.toTaskWithContext(task);
      this.taskQueue.queueTask(taskWithContext);
      log.debug("Task queued", { taskId: task.id, role: task.assigned_role });
    } catch (error) {
      log.error("Failed to queue task", { taskId: task.id, error });
    }
  }

  /**
   * Get a single task by ID (v1.1 helper)
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /** Alias for getTask() — satisfies ITaskProvider interface. */
  get(taskId: string): Task | undefined {
    return this.getTask(taskId);
  }

  /**
   * Get all tasks regardless of status (v1.1 helper)
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /** Alias for getAllTasks() — satisfies ITaskProvider interface. */
  getAll(): Task[] {
    return this.getAllTasks();
  }

  /**
   * Remove a task by ID (v1.2 — supports plan mutations)
   * Also removes the task from the queue if it's there.
   * Updates dependants of other tasks that reference this one.
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Remove from internal map
    this.tasks.delete(taskId);

    // Remove from queue if present
    this.taskQueue.removeTask(taskId);

    // Clean up references in other tasks' prerequisites
    for (const other of this.tasks.values()) {
      if (other.prerequisites?.has(taskId)) {
        other.prerequisites.delete(taskId);
      }
      if (Array.isArray((other as any).dependants)) {
        (other as any).dependants = (other as any).dependants.filter((d: string) => d !== taskId);
      }
    }

    log.info("Task removed", { taskId });
    return true;
  }

  /**
   * Bulk add tasks (v1.1 helper)
   */
  storeTasks(tasks: Task[]): void {
    for (const task of tasks) {
      this.addTask(task);
    }
    log.info("Bulk tasks stored", { count: tasks.length });
  }

  /**
   * Get task with dependency outputs (v1.1 helper)
   */
  getTaskContext(
    taskId: string,
  ): { task: Task; dependencyOutputs: any[] } | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    // Handle both string and object context for backward compatibility
    const context =
      typeof task.context === "string"
        ? JSON.parse(task.context)
        : task.context || {};
    const dependencyOutputs = Object.values(context);

    return { task, dependencyOutputs };
  }

  /**
   * Get queue metrics (v1.1)
   */
  getMetrics(): QueueMetrics {
    return this.taskQueue.getMetrics();
  }

  /**
   * Clear all tasks and reset the task queue
   * Used when approving a new plan to avoid conflicts with old tasks
   */
  clearAllTasks(): void {
    log.info("Clearing all tasks from MemoryManager");
    this.tasks.clear();

    // Clear the queue but keep event listeners attached
    this.taskQueue.clear();

    log.info("All tasks cleared");
  }
}
