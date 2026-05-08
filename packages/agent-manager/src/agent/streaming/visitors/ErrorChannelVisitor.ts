/**
 * ErrorChannelVisitor — bridges hooks-mode `onError` to the legacy
 * `WorkerCallbacks.onError` channel so SocketEventBroadcaster's existing
 * `error` Socket.IO emit (and any other downstream consumer of that
 * channel) keeps firing in hooks mode.
 *
 * Without this, hooks-mode worker failures only surface via:
 *   - StreamPublisherVisitor (chunks up to the failure point)
 *   - ChannelBVisitor → `task_update: failed`
 * The frontend `error` channel subscription would silently miss the
 * coarse error event the legacy callback path used to fire (May 9 2026
 * review fix #1).
 *
 * Pure forwarder — no accumulator, no I/O. Pairs with the existing
 * WorkerPool `setCallbacks({ onError })` wiring inside OrchestratorService.
 */

import type {
  StreamingAgentContext,
  StreamingHooks,
} from "../types.js";

export interface ErrorChannelVisitorDeps {
  /**
   * Bridge to `WorkerCallbacks.onError` (or anything with the same shape).
   * Same payload shape as the legacy WorkerPool emission so downstream
   * consumers don't need a code change.
   */
  publishError(data: { taskId: string; error: string }): void;
}

export class ErrorChannelVisitor implements StreamingHooks {
  constructor(private readonly deps: ErrorChannelVisitorDeps) {}

  async onError(error: Error, ctx: StreamingAgentContext): Promise<void> {
    this.deps.publishError({
      taskId: ctx.taskId ?? "",
      error: error.message,
    });
  }
}
