/**
 * StreamPublisherVisitor — port of SocketEventBroadcaster's stream accumulator
 * into a pure StreamingHooks visitor.
 *
 * Phase 1.2 of the agent-stream-bus refactor.
 * See: docs/features/agent-stream-bus/feature_implementation_planning.md
 *
 * Behaviour preserved EXACTLY from
 * `packages/backend/api/SocketEventBroadcaster.ts` (lines ~60–145):
 *   - Maintains a per-execution accumulator keyed by `taskId || agentId`.
 *   - Six part types contribute to the accumulator:
 *       text-delta, tool-call, tool-result, tool-input-available,
 *       tool-output-available, reasoning-delta
 *   - Every `onChunk` is forwarded to `publish(...)`.
 *   - On `finish`, persists the assembled assistant message via
 *     `persistMessage(...)`.
 *   - Skips persistence with a warn when `ctx.goalId` is missing — same
 *     contract as the legacy code.
 *   - `streamedTasks` set: tracks taskIds that were streamed so that a
 *     subsequent `onDone` from the legacy callback path doesn't double-emit
 *     a `finish`. Exposed via `hasStreamed(taskId)` for the bridge in
 *     Phase 1.11.
 *
 * Pure dependencies:
 *   - `publish(event)` — emit one StreamPart to the wire (Socket.IO room,
 *     Redis stream, in-memory bus). Choosing the room is the publisher's job;
 *     the visitor only supplies `{ goalId, teamId, taskId, agentId, part }`.
 *   - `persistMessage(message)` — store the assembled assistant message.
 *     Idempotent retries are the publisher's responsibility.
 */

import type {
  AgentRunResult,
  StreamingAgentContext,
  StreamingHooks,
  StreamPart,
} from "../types.js";

// -----------------------------------------------------------------------------
// Public contract
// -----------------------------------------------------------------------------

export interface StreamPublishEvent {
  teamId: string;
  goalId?: string;
  taskId?: string;
  agentId: string;
  part: StreamPart;
}

export interface PersistedAssistantMessage {
  teamId: string;
  goalId: string;
  agentId: string;
  taskId?: string;
  /** Concatenated assistant text. " " when only tool/reasoning parts present. */
  text: string;
  /**
   * Raw accumulated parts in the visitor's INTERNAL shape — NOT the
   * frontend `RenderedPart[]` shape persisted in the chat row.
   *
   * Each entry is one of:
   *   { type: "tool-call";   toolCallId, toolName, args }
   *   { type: "tool-result"; toolCallId, result }
   *   { type: "tool-input";  toolCallId, toolName, input }
   *   { type: "tool-output"; toolCallId, output }
   *   { type: "reasoning";   id?, text }
   *
   * The backend `persistMessage` adapter is responsible for converting this
   * to `RenderedPart[]` (typically via `toRenderedParts(text, accumulatedParts)`
   * from `socket-types.ts`) before calling the chat service. Visitors stay
   * in `agent-manager` and must not depend on backend-only formatting.
   */
  accumulatedParts: AccumulatedPart[];
}

/**
 * Shape of an accumulated part. Loosely typed because callers (legacy
 * `toRenderedParts`) accept arbitrary extra fields per type.
 */
export type AccumulatedPart =
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; result: unknown }
  | { type: "tool-input"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-output"; toolCallId: string; output: unknown }
  | { type: "reasoning"; id?: string; text: string }
  | { type: string;[k: string]: any };

export interface StreamPublisherDeps {
  /** Forward one stream part to the wire. */
  publish(event: StreamPublishEvent): void;
  /**
   * Persist the assembled assistant message at finish time.
   *
   * Visitor wraps this in one retry on rejection (matches the legacy
   * SocketEventBroadcaster behaviour). Implementers SHOULD make this
   * idempotent so a retry doesn't produce a duplicate row.
   */
  persistMessage(message: PersistedAssistantMessage): Promise<void>;
  /** Optional logger; defaults to a no-op. */
  logger?: {
    debug?(msg: string, meta?: unknown): void;
    warn?(msg: string, meta?: unknown): void;
  };
  /**
   * Retry delay in ms (matches legacy SocketEventBroadcaster which used 500ms).
   * Set to 0 to disable retry. Default: 500.
   */
  persistRetryMs?: number;
}

interface Accumulator {
  agentId: string;
  text: string;
  /** Internal accumulator parts (NOT frontend RenderedPart[]). */
  accumulatedParts: AccumulatedPart[];
}

// -----------------------------------------------------------------------------
// Visitor implementation
// -----------------------------------------------------------------------------

export class StreamPublisherVisitor implements StreamingHooks {
  private readonly accumulators = new Map<string, Accumulator>();
  /**
   * Pending persist promises keyed by accKey. When `onChunk` sees a `finish`
   * part, persistence is detached so token UI doesn't block; we store the
   * promise here so `onFinish` (which IS awaited per the StreamingHooks
   * contract) can drain the persist before `runWithHooks()` returns.
   */
  private readonly pendingPersists = new Map<string, Promise<void>>();
  private readonly streamedTasks = new Set<string>();
  private readonly publish: StreamPublisherDeps["publish"];
  private readonly persistMessage: StreamPublisherDeps["persistMessage"];
  private readonly persistRetryMs: number;
  private readonly log: NonNullable<StreamPublisherDeps["logger"]>;

  constructor(deps: StreamPublisherDeps) {
    this.publish = deps.publish;
    this.persistMessage = deps.persistMessage;
    this.persistRetryMs = deps.persistRetryMs ?? 500;
    this.log = deps.logger ?? {};
  }

  /**
   * True if this visitor handled stream output for the given taskId.
   * Phase 1.11 bridge uses this to suppress legacy `onDone` finish duplicates.
   */
  hasStreamed(taskId: string): boolean {
    return this.streamedTasks.has(taskId);
  }

  /** Clear per-task tracking after the legacy `onDone` is observed. */
  clearStreamed(taskId: string): void {
    this.streamedTasks.delete(taskId);
  }

  /**
   * Composite accumulator key.
   *
   * Includes teamId+goalId so two simultaneous goals can never share a
   * message buffer (planner & chat roles repeat across goals). Includes
   * messageId/threadId when present so multiple turns of the same agent in
   * one task don't concatenate.
   */
  private accKey(ctx: StreamingAgentContext): string {
    const parts = [
      ctx.teamId,
      ctx.goalId,
      ctx.taskId ?? "_",
      ctx.agentId ?? "worker",
      ctx.messageId ?? ctx.threadId ?? "_",
    ];
    return parts.join("|");
  }

  // ---------------------------------------------------------------------------
  // StreamingHooks
  // ---------------------------------------------------------------------------

  async onChunk(part: StreamPart, ctx: StreamingAgentContext): Promise<void> {
    if (ctx.taskId) this.streamedTasks.add(ctx.taskId);

    const accKey = this.accKey(ctx);
    const acc =
      this.accumulators.get(accKey) ??
      ({ agentId: ctx.agentId || "worker", text: "", accumulatedParts: [] } as Accumulator);

    // Mirror SocketEventBroadcaster's switch exactly.
    switch (part?.type) {
      case "text-delta": {
        const delta = (part as any).delta as string | undefined;
        if (delta) acc.text += delta;
        break;
      }
      case "tool-call": {
        acc.accumulatedParts.push({
          type: "tool-call",
          toolCallId: (part as any).toolCallId,
          toolName: (part as any).toolName,
          args: (part as any).args,
        });
        break;
      }
      case "tool-result": {
        acc.accumulatedParts.push({
          type: "tool-result",
          toolCallId: (part as any).toolCallId,
          result: (part as any).result,
        });
        break;
      }
      case "tool-input-available": {
        acc.accumulatedParts.push({
          type: "tool-input",
          toolCallId: (part as any).toolCallId,
          toolName: (part as any).toolName,
          input: (part as any).input,
        });
        break;
      }
      case "tool-output-available": {
        acc.accumulatedParts.push({
          type: "tool-output",
          toolCallId: (part as any).toolCallId,
          output: (part as any).output,
        });
        break;
      }
      case "reasoning-delta": {
        const delta = ((part as any).delta as string | undefined) ?? "";
        const lastReasoning = [...acc.accumulatedParts].reverse().find(
          (p): p is { type: "reasoning"; id?: string; text: string } =>
            p.type === "reasoning",
        );
        if (lastReasoning) {
          lastReasoning.text = (lastReasoning.text || "") + delta;
        } else {
          acc.accumulatedParts.push({ type: "reasoning", id: (part as any).id, text: delta });
        }
        break;
      }
      // Other part types (start, text-end, step boundaries, finish, ...) are
      // forwarded to the wire below but don't contribute to the accumulator.
    }

    this.accumulators.set(accKey, acc);

    // Publish the chunk to the wire FIRST. Persistence on `finish` runs
    // afterwards so token UI never waits on the database. This matches the
    // legacy SocketEventBroadcaster ordering (it emitted to Socket.IO, then
    // scheduled persistence + retry without blocking).
    this.safePublish({
      teamId: ctx.teamId,
      goalId: ctx.goalId,
      taskId: ctx.taskId,
      agentId: ctx.agentId || "worker",
      part,
    });

    // On finish, schedule persistence asynchronously so this hook returns
    // immediately. We track the detached promise in `pendingPersists` so
    // `onFinish` (awaited per the StreamingHooks contract) drains it before
    // `runWithHooks()` returns. Token UI never waits, but the caller still
    // gets the awaited-finish guarantee the docs promise.
    if (part?.type === "finish") {
      const captured = this.accumulators.get(accKey);
      this.accumulators.delete(accKey);
      if (captured) {
        const persistPromise = this.persistFromAccumulator(captured, ctx)
          .finally(() => {
            // Remove ourselves only if no newer persist replaced us.
            if (this.pendingPersists.get(accKey) === persistPromise) {
              this.pendingPersists.delete(accKey);
            }
          });
        this.pendingPersists.set(accKey, persistPromise);
      }
    }
  }

  /**
   * `onFinish` is AWAITED per the StreamingHooks contract — callers depend
   * on persistence completing before `runWithHooks()` returns.
   *
   * Two cases:
   *   1. A `finish` chunk was already observed in `onChunk`. The persist is
   *      detached and tracked in `pendingPersists` — we await it here.
   *   2. No `finish` chunk arrived (e.g. an HTTP adapter that returns one
   *      payload). The accumulator still exists — persist it now and await.
   */
  async onFinish(_result: AgentRunResult, ctx: StreamingAgentContext): Promise<void> {
    const accKey = this.accKey(ctx);

    // Drain any detached persist scheduled from the `finish` chunk.
    const pending = this.pendingPersists.get(accKey);
    if (pending) {
      this.pendingPersists.delete(accKey);
      await pending;
    }

    // Fallback: no `finish` chunk reached us — persist what we have now.
    const acc = this.accumulators.get(accKey);
    if (!acc) return;
    this.accumulators.delete(accKey);
    await this.persistFromAccumulator(acc, ctx);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async persistFromAccumulator(
    acc: Accumulator,
    ctx: StreamingAgentContext,
  ): Promise<void> {
    const hasContent = acc.text.trim().length > 0 || acc.accumulatedParts.length > 0;
    if (!hasContent) return;

    // `goalId` is type-required by StreamingAgentContext; check at runtime
    // anyway so a misuse from a JS caller doesn't lose the message silently.
    if (!ctx.goalId) {
      this.log.warn?.(
        `[StreamPublisherVisitor] Skipping stream message persistence — no goalId. agentId=${acc.agentId}, taskId=${ctx.taskId ?? "<none>"}`,
      );
      return;
    }

    const message: PersistedAssistantMessage = {
      teamId: ctx.teamId,
      goalId: ctx.goalId,
      agentId: acc.agentId || "unknown",
      taskId: ctx.taskId,
      // Match legacy: empty text falls back to a single space so the row exists.
      text: acc.text || " ",
      accumulatedParts: acc.accumulatedParts,
    };

    await this.persistWithRetry(message);
  }

  /**
   * Persist with one retry after `persistRetryMs` (legacy parity).
   * Each attempt error is logged but never re-thrown — a buggy persister
   * MUST NOT halt the agent loop.
   */
  private async persistWithRetry(message: PersistedAssistantMessage): Promise<void> {
    try {
      await this.persistMessage(message);
      return;
    } catch (err) {
      this.log.warn?.(
        `[StreamPublisherVisitor] persistMessage threw — retrying once after ${this.persistRetryMs}ms`,
        err,
      );
    }

    if (this.persistRetryMs <= 0) return;

    await new Promise<void>((resolve) => setTimeout(resolve, this.persistRetryMs));

    try {
      await this.persistMessage(message);
    } catch (err) {
      this.log.warn?.(
        `[StreamPublisherVisitor] persistMessage retry failed — dropping message`,
        err,
      );
    }
  }

  private safePublish(event: StreamPublishEvent): void {
    try {
      this.publish(event);
    } catch (err) {
      this.log.warn?.(`[StreamPublisherVisitor] publish threw — dropping event`, err);
    }
  }
}
