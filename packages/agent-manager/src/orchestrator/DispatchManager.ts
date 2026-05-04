/**
 * DispatchManager — Concurrency + Retry logic for task dispatch.
 *
 * Extracted from OrchestratorService (Phase 4.5, SRP refactor).
 * Manages active dispatch tracking, deferred dispatch queue, and
 * exponential backoff retry for retriable errors.
 */

import { classifyError } from "./types/workerTypes.js";
import { rootLogger } from "../logging.js";

const log = rootLogger.child({ module: "DispatchManager" });

export interface DispatchManagerConfig {
  maxConcurrent: number;
  maxRetries: number;
  /** Execute the actual task dispatch */
  executeTask: (taskId: string, role: string) => Promise<void>;
  /** Get task from store for state checks */
  getTask: (taskId: string) => { id: string; status: string; assigned_role: string } | undefined;
  /** Route through ChatAgent instead of direct dispatch */
  chatAgentDispatch?: (taskId: string, role: string) => Promise<void>;
  /** Update task status in store (may be async for write-through persistence) */
  updateTaskStatus?: (taskId: string, status: string) => Promise<void> | void;
  /** Notify frontend of task status change */
  onTaskUpdate?: (data: { taskId: string; status: string; role: string; timestamp: number }) => void;
  /** Fail task in queue */
  failTask?: (taskId: string, error: string) => void;
}

export class DispatchManager {
  private activeDispatches = new Set<string>();
  private deferredDispatches: Array<{ taskId: string; role: string }> = [];
  private taskAttempts = new Map<string, number>();
  private manualDispatchChain: Promise<void> = Promise.resolve();
  private config: DispatchManagerConfig;

  constructor(config: DispatchManagerConfig) {
    this.config = config;
  }

  /** Check if a task is currently being dispatched. */
  isDispatching(taskId: string): boolean {
    return this.activeDispatches.has(taskId);
  }

  /** Get count of active dispatches. */
  get activeCount(): number {
    return this.activeDispatches.size;
  }

  /** Update ChatAgent dispatch callback. */
  setChatAgentDispatch(dispatch: (taskId: string, role: string) => Promise<void>): void {
    this.config.chatAgentDispatch = dispatch;
  }

  /**
   * Handle a ready task — manages concurrency limit, ChatAgent routing, deferral.
   * Called by GoalManager.onTaskReady → OrchestratorService callback.
   */
  dispatch(taskId: string, role: string, autoExecute: boolean): void {
    if (!autoExecute) return;
    if (this.activeDispatches.has(taskId)) return;

    // Route through ChatAgent if dispatch callback is set
    if (this.config.chatAgentDispatch) {
      this.config.chatAgentDispatch(taskId, role).catch((err) => {
        log.error(`ChatAgent dispatch error for ${taskId}:`, err);
      });
      return;
    }

    // Concurrency limit: defer if too many active dispatches
    if (this.activeDispatches.size >= this.config.maxConcurrent) {
      this.deferredDispatches.push({ taskId, role });
      return;
    }

    this.activeDispatches.add(taskId);
    this.config.executeTask(taskId, role).catch((err) => {
      log.error(`Auto-dispatch error for ${taskId}:`, err);
    }).finally(() => {
      this.activeDispatches.delete(taskId);
      this.drainDeferred();
    });
  }

  /**
   * Direct dispatch — bypasses ChatAgent routing.
   * Used by ChatAgent.onDispatchTask callback to actually run the task.
   */
  async directDispatch(taskId: string, role: string): Promise<void> {
    if (this.activeDispatches.has(taskId)) return;
    this.activeDispatches.add(taskId);
    try {
      await this.config.executeTask(taskId, role);
    } finally {
      this.activeDispatches.delete(taskId);
      this.drainDeferred();
    }
  }

  /**
   * Manual dispatch — serialized, caller awaits.
   * Used when autoExecute is OFF and user triggers start-task from frontend.
   */
  async manualDispatch(taskId: string): Promise<void> {
    const task = this.config.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === "in_progress") {
      log.info(`Task ${taskId} already in progress — skipping`);
      return;
    }
    if (task.status !== "ready" && task.status !== "pending") {
      throw new Error(`Task ${taskId} is not ready (status: ${task.status})`);
    }
    if (this.activeDispatches.has(taskId)) {
      log.info(`Task ${taskId} already being dispatched — skipping`);
      return;
    }

    const role = task.assigned_role;

    // Route through ChatAgent if dispatch callback is set
    if (this.config.chatAgentDispatch) {
      this.config.chatAgentDispatch(taskId, role).catch((err) => {
        log.error(`ChatAgent manual dispatch error for ${taskId}:`, err);
      });
      return;
    }

    this.activeDispatches.add(taskId);
    this.manualDispatchChain = this.manualDispatchChain
      .then(() => this.config.executeTask(taskId, role))
      .catch((err) => { log.error(`Dispatch error for ${taskId}:`, err); })
      .finally(() => this.activeDispatches.delete(taskId));
    await this.manualDispatchChain;
  }

  /**
   * Handle dispatch error — classify, retry with backoff, or fail permanently.
   */
  handleError(taskId: string, role: string, error: unknown): void {
    const task = this.config.getTask(taskId);
    if (task?.status === "completed") return;

    const attempt = this.taskAttempts.get(taskId) || 1;
    const report = classifyError(taskId, role, error, attempt);

    log.warn(`Task ${taskId} failed (attempt ${attempt}/${this.config.maxRetries}): [${report.errorCategory}] ${report.message.slice(0, 200)}`);

    if (report.retriable && attempt < this.config.maxRetries) {
      const backoffMs = Math.min(10_000 * Math.pow(2, attempt - 1), 60_000);
      log.info(`Auto-retrying task ${taskId} in ${backoffMs / 1000}s (attempt ${attempt + 1}/${this.config.maxRetries})`);

      this.taskAttempts.set(taskId, attempt + 1);
      this.config.onTaskUpdate?.({ taskId, status: "ready", role, timestamp: Date.now() });

      // Reset status for re-dispatch (async-safe: chain promises, log failures)
      const resetStatus = async () => {
        try { await this.config.updateTaskStatus?.(taskId, "failed"); } catch (e) { log.warn({ err: e }, `Failed to set ${taskId} to failed before retry`); }
        try { await this.config.updateTaskStatus?.(taskId, "ready"); } catch (e) { log.warn({ err: e }, `Failed to reset ${taskId} to ready for retry`); }
      };
      resetStatus().catch((e) => log.error({ err: e }, `Status reset chain failed for ${taskId}`));

      setTimeout(() => {
        const retryTask = this.config.getTask(taskId);
        if (!retryTask || retryTask.status !== "ready") return;
        if (this.activeDispatches.has(taskId)) return;

        this.activeDispatches.add(taskId);
        this.config.executeTask(taskId, role).catch((err) => {
          log.error(`Retry dispatch error for ${taskId}:`, err);
        }).finally(() => {
          this.activeDispatches.delete(taskId);
          this.drainDeferred();
        });
      }, backoffMs);
    } else {
      if (attempt >= this.config.maxRetries) {
        log.error(`Task ${taskId} exhausted all ${this.config.maxRetries} retry attempts, failing permanently`);
      }
      this.taskAttempts.delete(taskId);
      // Persist failure status (async-safe)
      Promise.resolve(this.config.updateTaskStatus?.(taskId, "failed"))
        .catch((e) => log.warn({ err: e }, `Failed to persist failed status for ${taskId}`))
        .finally(() => this.config.failTask?.(taskId, report.message));
    }
  }

  /** Drain deferred queue when a slot opens. */
  private drainDeferred(): void {
    while (
      this.deferredDispatches.length > 0 &&
      this.activeDispatches.size < this.config.maxConcurrent
    ) {
      const next = this.deferredDispatches.shift()!;
      if (this.activeDispatches.has(next.taskId)) continue;

      const task = this.config.getTask(next.taskId);
      if (!task || task.status === "completed" || task.status === "failed") continue;

      this.activeDispatches.add(next.taskId);
      this.config.executeTask(next.taskId, next.role).catch((err) => {
        log.error(`Deferred dispatch error for ${next.taskId}:`, err);
      }).finally(() => {
        this.activeDispatches.delete(next.taskId);
        this.drainDeferred();
      });
    }
  }
}
