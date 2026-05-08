/**
 * CrdtStatusVisitor — Marks an agent as `busy`/`idle` in the CRDT during
 * task execution.
 *
 * Phase 1.4 of the agent-stream-bus refactor.
 *
 * Behaviour ported VERBATIM from
 * `packages/agent-manager/src/services/WorkerPool.ts` (lines ~418–525):
 *   - onStart  → crdtTaskSync.updateAgentStatus(role, 'busy', taskId)
 *   - onFinish → crdtTaskSync.updateAgentStatus(role, 'idle', taskId)
 *   - onError  → crdtTaskSync.updateAgentStatus(role, 'idle', taskId)
 *
 * The original code uses `.catch(() => {})` — same here. CRDT status updates
 * are best-effort; they MUST NOT break the agent loop.
 */

import type {
  AgentRunResult,
  StreamingAgentContext,
  StreamingHooks,
} from "../types.js";

// =============================================================================
// Public contract
// =============================================================================

/**
 * Minimal CRDT-task-sync surface this visitor depends on. We don't import the
 * concrete class to keep `agent-manager` free of `collaboration` deps.
 */
export interface ICrdtTaskSync {
  updateAgentStatus(
    role: string,
    status: "busy" | "idle",
    taskId?: string,
  ): Promise<void>;
}

export interface CrdtStatusVisitorDeps {
  crdtTaskSync: ICrdtTaskSync;
  /** Optional logger. */
  logger?: { warn?(msg: string, meta?: unknown): void };
}

// =============================================================================
// Visitor implementation
// =============================================================================

export class CrdtStatusVisitor implements StreamingHooks {
  private readonly crdtTaskSync: ICrdtTaskSync;
  private readonly log: NonNullable<CrdtStatusVisitorDeps["logger"]>;

  /**
   * Pending detached `busy` writes keyed by `<role>|<taskId>`. The `onStart`
   * hook is fire-and-forget per the StreamingHooks contract, so the busy
   * write is not awaited at start. To prevent a slow `busy` from arriving
   * AFTER `idle` (which would wedge the CRDT in busy state), `setAwaited`
   * first drains any pending busy for the same key.
   *
   * Key shape mirrors the natural ordering scope: per-role + per-task.
   * Multiple agents in the same task get separate keys; same agent across
   * different tasks gets separate keys.
   */
  private readonly pendingBusy = new Map<string, Promise<void>>();

  constructor(deps: CrdtStatusVisitorDeps) {
    this.crdtTaskSync = deps.crdtTaskSync;
    this.log = deps.logger ?? {};
  }

  // ---------------------------------------------------------------------------
  // StreamingHooks
  //
  // Per the StreamingHooks contract:
  //   - `onStart` is FIRE-AND-FORGET: detach the CRDT call so token UI isn't
  //     blocked on a slow CRDT round-trip at the very start of execution.
  //   - `onFinish` and `onError` are AWAITED: the agent has already finished
  //     producing output, and downstream code (Phase 1.7 AgentFactory)
  //     depends on the CRDT being in `idle` before `runWithHooks()` returns,
  //     otherwise an immediate follow-up dispatch can see the agent as busy.
  //     Errors are still swallowed so a CRDT outage cannot break the loop.
  // ---------------------------------------------------------------------------

  onStart(ctx: StreamingAgentContext): void {
    this.setDetached(ctx, "busy");
  }

  async onFinish(_result: AgentRunResult, ctx: StreamingAgentContext): Promise<void> {
    await this.setAwaited(ctx, "idle");
  }

  async onError(_error: Error, ctx: StreamingAgentContext): Promise<void> {
    await this.setAwaited(ctx, "idle");
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Composite key for ordering busy/idle on the same execution slot. */
  private orderingKey(ctx: StreamingAgentContext): string {
    return `${ctx.agentId}|${ctx.taskId ?? "_"}`;
  }

  /** Fire-and-forget CRDT write, used by `onStart`. */
  private setDetached(ctx: StreamingAgentContext, status: "busy" | "idle"): void {
    const role = ctx.agentId;
    if (!role) return;
    const key = this.orderingKey(ctx);
    let promise: Promise<void>;
    try {
      promise = Promise.resolve(this.crdtTaskSync.updateAgentStatus(role, status, ctx.taskId))
        .then(() => undefined)
        .catch((err) => {
          this.log.warn?.(
            `[CrdtStatusVisitor] detached updateAgentStatus(${status}) failed — swallowing`,
            err,
          );
        });
    } catch (err) {
      this.log.warn?.(
        `[CrdtStatusVisitor] updateAgentStatus(${status}) threw synchronously — swallowing`,
        err,
      );
      return;
    }
    // Track only `busy` for the ordering guarantee; idle never has a follower.
    if (status === "busy") {
      this.pendingBusy.set(key, promise);
      // Drop the entry once the write settles so we don't leak across tasks.
      promise.finally(() => {
        if (this.pendingBusy.get(key) === promise) {
          this.pendingBusy.delete(key);
        }
      });
    }
  }

  /**
   * Awaited CRDT write, used by `onFinish`/`onError`.
   *
   * Drains any in-flight `busy` for the same ordering key BEFORE issuing
   * the `idle` write. This guarantees CRDT observes `busy → idle` even
   * when the detached busy has high latency. Errors isolated.
   */
  private async setAwaited(ctx: StreamingAgentContext, status: "busy" | "idle"): Promise<void> {
    const role = ctx.agentId;
    if (!role) return;
    const key = this.orderingKey(ctx);

    // Drain pending busy first so idle never overtakes it.
    const pending = this.pendingBusy.get(key);
    if (pending) {
      this.pendingBusy.delete(key);
      try { await pending; } catch { /* already logged in setDetached */ }
    }

    try {
      await this.crdtTaskSync.updateAgentStatus(role, status, ctx.taskId);
    } catch (err) {
      // StreamingHooks contract: a buggy/unavailable visitor must NOT break
      // the agent loop. We log and continue.
      this.log.warn?.(
        `[CrdtStatusVisitor] updateAgentStatus(${status}) failed — swallowing`,
        err,
      );
    }
  }
}
