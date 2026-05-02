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
  /** Update task status in store */
  updateTaskStatus?: (taskId: string, status: string) => void;
  /** Notify frontend of task status change */
  onTaskUpdate?: (data: { taskId: string; status: string; role: string; timestamp: number }) => void;
  /** Fail task in queue */
  failTask?: (taskId: string, error: string) => void;
}

export class DispatchManager {
  private activeDispatches = new Set<string>();
  /** Per-goal active dispatch tracking for concurrency fairness */
  private goalDispatches = new Map<string, Set<string>>();
  private deferredDispatches: Array<{ taskId: string; role: string; goalId?: string }> = [];
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

  /** Get active dispatch count for a specific goal. */
  goalActiveCount(goalId: string): number {
    return this.goalDispatches.get(goalId)?.size ?? 0;
  }

  private trackGoalDispatch(taskId: string, goalId?: string): void {
    this.activeDispatches.add(taskId);
    if (goalId) {
      let set = this.goalDispatches.get(goalId);
      if (!set) { set = new Set(); this.goalDispatches.set(goalId, set); }
      set.add(taskId);
    }
  }

  private untrackGoalDispatch(taskId: string, goalId?: string): void {
    this.activeDispatches.delete(taskId);
    if (goalId) {
      const set = this.goalDispatches.get(goalId);
      if (set) { set.delete(taskId); if (set.size === 0) this.goalDispatches.delete(goalId); }
    }
  }

  /** Update ChatAgent dispatch callback. */
  setChatAgentDispatch(dispatch: (taskId: string, role: string) => Promise<void>): void {
    this.config.chatAgentDispatch = dispatch;
  }

  /**
   * Handle a ready task — manages concurrency limit, ChatAgent routing, deferral.
   * Called by GoalManager.onTaskReady → OrchestratorService callback.
   */
  dispatch(taskId: string, role: string, autoExecute: boolean, goalId?: string): void {
    if (!autoExecute) return;
    if (this.activeDispatches.has(taskId)) return;

    // Route through ChatAgent if dispatch callback is set
    if (this.config.chatAgentDispatch) {
      this.config.chatAgentDispatch(taskId, role).catch((err) => {
        log.error(`ChatAgent dispatch error for ${taskId}:`, err);
      });
      return;
    }

    // Per-goal concurrency limit
    if (goalId && this.goalActiveCount(goalId) >= this.config.maxConcurrent) {
      this.deferredDispatches.push({ taskId, role, goalId });
      return;
    }

    this.trackGoalDispatch(taskId, goalId);
    this.config.executeTask(taskId, role).catch((err) => {
      log.error(`Auto-dispatch error for ${taskId}:`, err);
    }).finally(() => {
      this.untrackGoalDispatch(taskId, goalId);
      this.drainDeferred();
    });
  }

  /**
   * Direct dispatch — bypasses ChatAgent routing.
   * Used by ChatAgent.onDispatchTask callback to actually run the task.
   */
  async directDispatch(taskId: string, role: string, goalId?: string): Promise<void> {
    if (this.activeDispatches.has(taskId)) return;

    // Per-goal concurrency cap (same as auto-dispatch)
    if (goalId && this.goalActiveCount(goalId) >= this.config.maxConcurrent) {
      this.deferredDispatches.push({ taskId, role, goalId });
      return;
    }

    this.trackGoalDispatch(taskId, goalId);
    try {
      await this.config.executeTask(taskId, role);
    } finally {
      this.untrackGoalDispatch(taskId, goalId);
      this.drainDeferred();
    }
  }

  /**
   * Manual dispatch — serialized, caller awaits.
   * Used when autoExecute is OFF and user triggers start-task from frontend.
   */
  async manualDispatch(taskId: string, goalId?: string): Promise<void> {
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

    // Per-goal concurrency cap
    if (goalId && this.goalActiveCount(goalId) >= this.config.maxConcurrent) {
      this.deferredDispatches.push({ taskId, role, goalId });
      log.info(`Manual dispatch deferred — goal ${goalId} at max concurrency`);
      return;
    }

    this.trackGoalDispatch(taskId, goalId);
    this.manualDispatchChain = this.manualDispatchChain
      .then(() => this.config.executeTask(taskId, role))
      .catch((err) => { log.error(`Dispatch error for ${taskId}:`, err); })
      .finally(() => this.untrackGoalDispatch(taskId, goalId));
    await this.manualDispatchChain;
  }

  /**
   * Handle dispatch error — classify, retry with backoff, or fail permanently.
   */
  handleError(taskId: string, role: string, error: unknown, goalId?: string): void {
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

      // Reset status for re-dispatch
      try { this.config.updateTaskStatus?.(taskId, "failed"); } catch { /* guard */ }
      try { this.config.updateTaskStatus?.(taskId, "ready"); } catch { /* guard */ }

      setTimeout(() => {
        const retryTask = this.config.getTask(taskId);
        if (!retryTask || retryTask.status !== "ready") return;
        if (this.activeDispatches.has(taskId)) return;

        // Per-goal concurrency cap on retry
        if (goalId && this.goalActiveCount(goalId) >= this.config.maxConcurrent) {
          this.deferredDispatches.push({ taskId, role, goalId });
          return;
        }

        this.trackGoalDispatch(taskId, goalId);
        this.config.executeTask(taskId, role).catch((err) => {
          log.error(`Retry dispatch error for ${taskId}:`, err);
        }).finally(() => {
          this.untrackGoalDispatch(taskId, goalId);
          this.drainDeferred();
        });
      }, backoffMs);
    } else {
      if (attempt >= this.config.maxRetries) {
        log.error(`Task ${taskId} exhausted all ${this.config.maxRetries} retry attempts, failing permanently`);
      }
      this.taskAttempts.delete(taskId);
      try { this.config.updateTaskStatus?.(taskId, "failed"); } catch { /* guard */ }
      this.config.failTask?.(taskId, report.message);
    }
  }

  /** Drain deferred queue when a slot opens. */
  private drainDeferred(): void {
    const remaining: typeof this.deferredDispatches = [];
    for (const next of this.deferredDispatches) {
      if (this.activeDispatches.has(next.taskId)) continue;

      const task = this.config.getTask(next.taskId);
      if (!task || task.status === "completed" || task.status === "failed") continue;

      // Per-goal concurrency check
      if (next.goalId && this.goalActiveCount(next.goalId) >= this.config.maxConcurrent) {
        remaining.push(next);
        continue;
      }

      this.trackGoalDispatch(next.taskId, next.goalId);
      this.config.executeTask(next.taskId, next.role).catch((err) => {
        log.error(`Deferred dispatch error for ${next.taskId}:`, err);
      }).finally(() => {
        this.untrackGoalDispatch(next.taskId, next.goalId);
        this.drainDeferred();
      });
    }
    this.deferredDispatches = remaining;
  }
}
