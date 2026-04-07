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
  /** Called with batched message when queue flushes */
  onFlush: (batchedMessage: string) => void;
}

export class NotificationQueue {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private onFlush: (batchedMessage: string) => void;

  constructor(config: NotificationQueueConfig) {
    this.debounceMs = config.debounceMs ?? 100;
    this.onFlush = config.onFlush;
  }

  /**
   * Push a message into the queue. Starts debounce timer.
   * Multiple pushes within debounceMs are batched into one flush.
   */
  push(message: string): void {
    this.pending.push(message);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }
  }

  /**
   * Push an urgent message. Flushes immediately (no debounce).
   * Use for: worker died, plan blocked, execution complete.
   */
  pushUrgent(message: string): void {
    this.pending.push(message);
    this.flush();
  }

  /**
   * Flush all pending messages as a single batched string.
   */
  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pending.length === 0) return;

    const batch = this.pending.splice(0);
    const message = batch.length === 1
      ? batch[0]!
      : `${batch.length} events since last check:\n${batch.join("\n")}`;

    this.onFlush(message);
  }

  /** Number of pending messages. */
  get size(): number {
    return this.pending.length;
  }

  /** Cancel pending flush and clear queue. */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }
}
