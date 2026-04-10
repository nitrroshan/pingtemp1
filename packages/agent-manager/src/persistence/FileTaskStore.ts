/**
 * FileTaskStore — Built-in file-based task persistence for @ping/agent-manager
 *
 * Persists task state to JSON on disk. Used as default when no plugin provides a TaskStore.
 * Directory structure: data/tasks/{teamId}/tasks.json
 *
 * Accepts an optional StorageProvider for cloud storage (Azure Blob, S3).
 * Falls back to direct fs when no provider is given.
 */

import { promises as fs } from "fs";
import path from "path";
import { rootLogger } from "../logging.js";
import type { ITaskStore } from "../plugin/types.js";

const logger = rootLogger.child({ module: "FileTaskStore" });

/** Minimal storage interface — matches @ping/backend AppStateStorage */
export interface StorageProvider {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
}

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
  private relativePath: string;
  private filePath: string;
  private storage: StorageProvider | null;
  private tasks = new Map<string, StoredTask>();
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(teamId: string, repoPath: string = ".", storage?: StorageProvider) {
    this.relativePath = path.join("tasks", teamId, "tasks.json");
    this.filePath = path.join(repoPath, "data", "tasks", teamId, "tasks.json");
    this.storage = storage || null;
  }

  /** Load tasks from disk (call once at startup) */
  async load(): Promise<void> {
    try {
      const content = this.storage
        ? await this.storage.read(this.relativePath)
        : await fs.readFile(this.filePath, "utf8");
      if (!content) return;
      const tasks: StoredTask[] = JSON.parse(content);
      this.tasks.clear();
      for (const t of tasks) {
        this.tasks.set(t.id, t);
      }
      logger.info(`Loaded ${tasks.length} tasks from disk`);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
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

  /** Force write to disk (or storage provider) */
  async flush(): Promise<void> {
    this.dirty = false;
    const tasks = Array.from(this.tasks.values());
    const data = JSON.stringify(tasks, null, 2);

    if (this.storage) {
      await this.storage.write(this.relativePath, data);
    } else {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, data, "utf8");
    }
    logger.debug(`Saved ${tasks.length} tasks to disk`);
  }
}
