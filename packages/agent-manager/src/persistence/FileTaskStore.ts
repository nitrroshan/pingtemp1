/**
 * FileTaskStore — Built-in file-based task persistence for @ping/agent-manager
 *
 * Persists task state to JSON on disk. Used as default when no plugin provides a TaskStore.
 * Directory structure: data/tasks/{teamId}/tasks.json
 *
 * Works alongside MemoryManager (in-memory DAG) — FileTaskStore adds persistence
 * so task state survives restarts. MemoryManager remains the runtime source of truth.
 */

import { promises as fs } from "fs";
import path from "path";
import { Logger } from "tslog";
import type { ITaskStore } from "../plugin/types.js";

const logger = new Logger({ name: "FileTaskStore" });

export interface StoredTask {
  id: string;
  description: string;
  assigned_role: string;
  status: string;
  prerequisites: Record<string, boolean>;
  output?: any;
  context?: any;
  createdAt: string;
  updatedAt: string;
}

export class FileTaskStore implements ITaskStore {
  private filePath: string;
  private tasks = new Map<string, StoredTask>();
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(teamId: string, repoPath: string = ".") {
    this.filePath = path.join(repoPath, "data", "tasks", teamId, "tasks.json");
  }

  /** Load tasks from disk (call once at startup) */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const tasks: StoredTask[] = JSON.parse(content);
      this.tasks.clear();
      for (const t of tasks) {
        this.tasks.set(t.id, t);
      }
      logger.info(`Loaded ${tasks.length} tasks from disk`);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      // No file yet — start empty
    }
  }

  addTask(task: any): void {
    const stored: StoredTask = {
      id: task.id,
      description: task.description || "",
      assigned_role: task.assigned_role || "",
      status: task.status || "pending",
      prerequisites: task.prerequisites
        ? Object.fromEntries(task.prerequisites)
        : {},
      context: task.context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, stored);
    this.scheduleSave();
  }

  getTask(taskId: string): StoredTask | undefined {
    return this.tasks.get(taskId);
  }

  updateStatus(taskId: string, status: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date().toISOString();
      this.scheduleSave();
    }
  }

  getReadyTasks(): StoredTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "ready" || t.status === "pending",
    );
  }

  /** Save all completed task outputs */
  setOutput(taskId: string, output: any): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.output = output;
      task.updatedAt = new Date().toISOString();
      this.scheduleSave();
    }
  }

  /** Clear all tasks (for new plan) */
  clear(): void {
    this.tasks.clear();
    this.scheduleSave();
  }

  /** Get all tasks */
  getAllTasks(): StoredTask[] {
    return Array.from(this.tasks.values());
  }

  // Debounced save — writes at most every 2 seconds
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      if (this.dirty) {
        await this.flush();
      }
    }, 2000);
  }

  /** Force write to disk */
  async flush(): Promise<void> {
    this.dirty = false;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tasks = Array.from(this.tasks.values());
    await fs.writeFile(this.filePath, JSON.stringify(tasks, null, 2), "utf8");
    logger.debug(`Saved ${tasks.length} tasks to disk`);
  }
}
