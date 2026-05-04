/**
 * NotificationQueue
 *
 * Debounce buffer for planner notifications from task lifecycle events.
 * Batches multiple events (e.g., 5 tasks failing in 100ms) into a single
 * planner turn — avoids redundant LLM calls.
 *
 * Usage:
 *   OrchestratorService pushes messages on task complete/fail/stall.
 *   Queue debounces (100ms default), fires onFlush with batched message.
 *   AgentManager wires onFlush → plannerAgent.execute({ message }).
 *
 * Urgent messages (worker died, plan blocked) flush immediately.
 */

export interface NotificationQueueConfig {
  /** Debounce interval in ms. Default: 100 */
  debounceMs?: number;
  /** Called with batched message when queue flushes for a specific goal */
  onFlush: (goalId: string, batchedMessage: string) => void;
}

export class NotificationQueue {
  private pending: Map<string, string[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private debounceMs: number;
  private onFlush: (goalId: string, batchedMessage: string) => void;

  constructor(config: NotificationQueueConfig) {
    this.debounceMs = config.debounceMs ?? 100;
    this.onFlush = config.onFlush;
  }

  /**
   * Push a message for a specific goal. Starts per-goal debounce timer.
   */
  push(goalId: string, message: string): void {
    let bucket = this.pending.get(goalId);
    if (!bucket) {
      bucket = [];
      this.pending.set(goalId, bucket);
    }
    bucket.push(message);
    if (!this.timers.has(goalId)) {
      this.timers.set(goalId, setTimeout(() => this.flushGoal(goalId), this.debounceMs));
    }
  }

  /**
   * Push an urgent message. Flushes that goal immediately (no debounce).
   */
  pushUrgent(goalId: string, message: string): void {
    let bucket = this.pending.get(goalId);
    if (!bucket) {
      bucket = [];
      this.pending.set(goalId, bucket);
    }
    bucket.push(message);
    this.flushGoal(goalId);
  }

  /**
   * Flush pending messages for a specific goal.
   */
  private flushGoal(goalId: string): void {
    const timer = this.timers.get(goalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(goalId);
    }

    const bucket = this.pending.get(goalId);
    if (!bucket || bucket.length === 0) return;
    this.pending.delete(goalId);

    const message = bucket.length === 1
      ? bucket[0]!
      : `${bucket.length} events since last check:\n${bucket.join("\n")}`;

    this.onFlush(goalId, message);
  }

  /** Number of pending messages across all goals. */
  get size(): number {
    let total = 0;
    for (const bucket of this.pending.values()) total += bucket.length;
    return total;
  }

  /** Cancel all pending flushes and clear queue. */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }
}
