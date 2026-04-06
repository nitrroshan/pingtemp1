/**
 * TaskList - Task management for agents
 *
 * Every agent has a TaskList to track assigned work.
 * Handles dependency resolution and cascading failures.
 */

import { EventEmitter } from "events";
import type { Task, TaskStatus, ITaskList } from "./types.js";

export class TaskList implements ITaskList {
  private _tasks: Map<string, Task> = new Map();
  private emitter: EventEmitter = new EventEmitter();

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  all(): Task[] {
    return Array.from(this._tasks.values());
  }

  pending(): Task[] {
    return this.all().filter((t) => t.status === "pending");
  }

  inProgress(): Task[] {
    return this.all().filter((t) => t.status === "in_progress");
  }

  completed(): Task[] {
    return this.all().filter((t) => t.status === "completed");
  }

  failed(): Task[] {
    return this.all().filter((t) => t.status === "failed");
  }

  skipped(): Task[] {
    return this.all().filter((t) => (t as any).skipped === true);
  }

  getById(id: string): Task | undefined {
    return this._tasks.get(id);
  }

  /**
   * Get tasks that are ready to execute (dependencies satisfied)
   * Considers both 'all' and 'any' dependency types
   */
  getReady(): Task[] {
    const completedIds = new Set(this.completed().map((t) => t.id));
    const failedIds = new Set(this.failed().map((t) => t.id));

    return this.pending().filter((task) => {
      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }

      const depType = task.dependencyType || "all";

      if (depType === "all") {
        // All dependencies must be completed (not failed)
        return task.dependencies.every((depId) => completedIds.has(depId));
      } else {
        // 'any' - at least one dependency must be completed
        return task.dependencies.some((depId) => completedIds.has(depId));
      }
    });
  }

  /**
   * Get tasks that are blocked due to failed dependencies
   */
  getBlocked(): Task[] {
    const failedIds = new Set(this.failed().map((t) => t.id));

    return this.pending().filter((task) => {
      if (!task.dependencies || task.dependencies.length === 0) {
        return false;
      }
      // Blocked if any dependency has failed
      return task.dependencies.some((depId) => failedIds.has(depId));
    });
  }

  /**
   * Check for circular dependencies
   */
  hasCircularDependency(
    taskId: string,
    visited: Set<string> = new Set(),
  ): boolean {
    if (visited.has(taskId)) {
      return true;
    }

    const task = this._tasks.get(taskId);
    if (!task || !task.dependencies) {
      return false;
    }

    visited.add(taskId);
    for (const depId of task.dependencies) {
      if (this.hasCircularDependency(depId, new Set(visited))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the dependency graph as an adjacency list
   */
  getDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const task of this._tasks.values()) {
      graph.set(task.id, task.dependencies || []);
    }
    return graph;
  }

  /**
   * Get tasks in topological order (respecting dependencies)
   */
  getTopologicalOrder(): Task[] {
    const visited = new Set<string>();
    const result: Task[] = [];

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = this._tasks.get(taskId);
      if (!task) return;

      // Visit dependencies first
      for (const depId of task.dependencies || []) {
        visit(depId);
      }

      result.push(task);
    };

    for (const task of this._tasks.values()) {
      visit(task.id);
    }

    return result;
  }

  // ==========================================================================
  // Mutation Methods
  // ==========================================================================

  add(task: Task): void {
    if (this._tasks.has(task.id)) {
      throw new Error(`Task ${task.id} already exists`);
    }

    // Validate dependencies exist (if referencing existing tasks)
    if (task.dependencies) {
      for (const depId of task.dependencies) {
        // Only validate if the dependency should already exist
        // (allows adding tasks in any order, validated at execution time)
      }
    }

    const newTask: Task = {
      ...task,
      status: task.status || "pending",
      assignedAt: task.assignedAt || new Date(),
      dependencyType: task.dependencyType || "all",
      onDependencyFail: task.onDependencyFail || "fail",
    };

    this._tasks.set(task.id, newTask);

    // Check for circular dependencies
    if (this.hasCircularDependency(task.id)) {
      this._tasks.delete(task.id);
      throw new Error(`Circular dependency detected for task ${task.id}`);
    }

    this.emitter.emit("task:added", newTask);
  }

  /**
   * Add multiple tasks at once (batch add)
   * Validates dependencies across the batch and detects circular dependencies
   */
  addBatch(tasks: Task[]): void {
    // First pass: add all tasks (skip individual circular check)
    const addedIds: string[] = [];
    for (const task of tasks) {
      if (this._tasks.has(task.id)) {
        throw new Error(`Task ${task.id} already exists`);
      }

      const newTask: Task = {
        ...task,
        status: task.status || "pending",
        assignedAt: task.assignedAt || new Date(),
        dependencyType: task.dependencyType || "all",
        onDependencyFail: task.onDependencyFail || "fail",
      };

      this._tasks.set(task.id, newTask);
      addedIds.push(task.id);
    }

    // Second pass: validate all dependencies exist
    for (const task of tasks) {
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          if (!this._tasks.has(depId)) {
            // Rollback
            for (const id of addedIds) {
              this._tasks.delete(id);
            }
            throw new Error(`Task ${task.id} has unknown dependency: ${depId}`);
          }
        }
      }
    }

    // Third pass: detect circular dependencies
    const circularTasks = this.findCircularDependencies(addedIds);
    if (circularTasks.length > 0) {
      // Emit event with details about the circular dependency
      this.emitter.emit("task:circular-detected", {
        taskIds: circularTasks,
        cycle: this.getCircularPath(circularTasks[0]!),
      });

      // Don't throw - let caller decide what to do
      // Mark circular tasks so they can be identified
      for (const taskId of circularTasks) {
        const task = this._tasks.get(taskId);
        if (task) {
          (task as any).isCircular = true;
        }
      }
    }

    // Emit added events
    for (const id of addedIds) {
      this.emitter.emit("task:added", this._tasks.get(id));
    }
  }

  /**
   * Find all tasks involved in circular dependencies
   */
  private findCircularDependencies(taskIds: string[]): string[] {
    const circular: Set<string> = new Set();

    for (const taskId of taskIds) {
      if (this.hasCircularDependency(taskId)) {
        circular.add(taskId);
      }
    }

    return Array.from(circular);
  }

  /**
   * Get the circular path for a task (for debugging/logging)
   */
  private getCircularPath(startId: string): string[] {
    const path: string[] = [];
    const visited = new Set<string>();

    const traverse = (taskId: string): boolean => {
      if (visited.has(taskId)) {
        // Found the cycle - extract it
        const cycleStart = path.indexOf(taskId);
        if (cycleStart !== -1) {
          path.push(taskId); // Close the cycle
          return true;
        }
        return false;
      }

      visited.add(taskId);
      path.push(taskId);

      const task = this._tasks.get(taskId);
      if (task?.dependencies) {
        for (const depId of task.dependencies) {
          if (traverse(depId)) {
            return true;
          }
        }
      }

      path.pop();
      return false;
    };

    traverse(startId);
    return path;
  }

  start(taskId: string): void {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (task.status !== "pending") {
      throw new Error(`Task ${taskId} is not pending (status: ${task.status})`);
    }

    task.status = "in_progress";
    task.startedAt = new Date();

    this.emitter.emit("task:started", task);
  }

  complete(taskId: string, output: any): void {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = "completed";
    task.completedAt = new Date();
    task.output = output;

    // Update blocked tasks - remove this task from blockedBy lists
    this.updateBlockedTasks(taskId);

    this.emitter.emit("task:completed", task);
  }

  fail(taskId: string, error: string): void {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = "failed";
    task.completedAt = new Date();
    task.error = error;

    this.emitter.emit("task:failed", task);

    // Handle cascading failures for dependent tasks
    this.handleDependencyFailure(taskId);
  }

  /**
   * Handle tasks that depend on a failed task
   */
  private handleDependencyFailure(failedTaskId: string): void {
    for (const task of this._tasks.values()) {
      if (task.status !== "pending") continue;
      if (!task.dependencies?.includes(failedTaskId)) continue;

      const action = task.onDependencyFail || "fail";

      switch (action) {
        case "skip":
          // Mark as skipped, don't fail
          (task as any).skipped = true;
          task.status = "failed";
          task.error = `Skipped: dependency ${failedTaskId} failed`;
          this.emitter.emit("task:skipped", task);
          break;

        case "fail":
          // Cascade the failure
          task.status = "failed";
          task.error = `Dependency failed: ${failedTaskId}`;
          this.emitter.emit("task:failed", task);
          // Recursively handle tasks depending on this one
          this.handleDependencyFailure(task.id);
          break;

        case "replan":
          // Emit event for orchestrator to re-plan
          this.emitter.emit("task:replan-needed", {
            task,
            failedDependency: failedTaskId,
          });
          break;
      }
    }
  }

  // ==========================================================================
  // Event Methods
  // ==========================================================================

  on(
    event: "task:added" | "task:started" | "task:completed" | "task:failed",
    handler: (task: Task) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: Function): void {
    this.emitter.off(event, handler as any);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private updateBlockedTasks(completedTaskId: string): void {
    // Remove completedTaskId from blockedBy lists
    for (const task of this._tasks.values()) {
      if (task.blockedBy) {
        task.blockedBy = task.blockedBy.filter((id) => id !== completedTaskId);
      }
    }
  }
}
