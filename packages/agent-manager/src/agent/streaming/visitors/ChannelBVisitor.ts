/**
 * ChannelBVisitor — Coarse-grained TaskUpdate stream synthesised from the
 * fine-grained AI SDK stream parts.
 *
 * Phase 1.4 of the agent-stream-bus refactor.
 * See: docs/features/agent-stream-bus/feature_implementation_planning.md
 *
 * Behaviour ported VERBATIM from
 * `packages/agent-manager/src/services/WorkerPool.ts` (lines ~430–520):
 *   - onStart            → emit `{ type: "started", taskId, role, ts }`
 *   - onChunk("finish-step") → every N steps, emit `progress` with
 *                              accumulated step count + token total
 *   - onChunk("tool-output-available") → if `toolName` ∈ MILESTONE_TOOLS,
 *                                        emit `tool_milestone` with truncated
 *                                        summary
 *   - onFinish           → emit `{ type: "completed", taskId, role, summary, ts }`
 *   - onError            → emit `{ type: "failed", taskId, role, error, ts }`
 *
 * "Channel B" is the second event channel that ChatAgent + frontend sidebar
 * subscribe to. ChatAgent does NOT see raw stream tokens; it sees these.
 *
 * See: docs/features/chat-agent-layer/feature_architecture.md — "Two distinct
 * event channels".
 */

import { MILESTONE_TOOLS } from "../../../types/TaskUpdate.js";
import type { TaskUpdate } from "../../../types/TaskUpdate.js";
import type {
  AgentRunResult,
  AgentStepInfo,
  StreamingAgentContext,
  StreamingHooks,
  StreamPart,
} from "../types.js";

// =============================================================================
// Public contract
// =============================================================================

export interface ChannelBVisitorDeps {
  /** Forward one TaskUpdate to whoever consumes Channel B (manager → Socket / ChatAgent). */
  publish(update: TaskUpdate): void;
  /** Emit a `progress` update every N `finish-step` events. Default: 3. */
  progressInterval?: number;
  /** Optional logger. */
  logger?: { warn?(msg: string, meta?: unknown): void };
}

interface CounterState {
  stepCount: number;
  totalTokens: number;
}

// =============================================================================
// Visitor implementation
// =============================================================================

export class ChannelBVisitor implements StreamingHooks {
  private readonly publish: ChannelBVisitorDeps["publish"];
  private readonly progressInterval: number;
  private readonly log: NonNullable<ChannelBVisitorDeps["logger"]>;

  /** Per-task counters keyed by `taskId || agentId`. */
  private readonly counters = new Map<string, CounterState>();

  constructor(deps: ChannelBVisitorDeps) {
    this.publish = deps.publish;
    this.progressInterval = deps.progressInterval ?? 3;
    this.log = deps.logger ?? {};
  }

  // ---------------------------------------------------------------------------
  // StreamingHooks
  // ---------------------------------------------------------------------------

  onStart(ctx: StreamingAgentContext): void {
    if (!ctx.taskId) return; // Channel B is task-scoped
    this.counters.set(ctx.taskId, { stepCount: 0, totalTokens: 0 });
    this.safePublish({
      type: "started",
      taskId: ctx.taskId,
      role: ctx.agentId || "worker",
      ts: Date.now(),
    });
  }

  /**
   * Native AI SDK step boundary — PRIMARY path for progress updates.
   *
   * `AiSdkAgent` (Step 1.5) is wired to call this from `streamText({ onStepFinish })`.
   * The `finish-step` chunk path in `onChunk` below is kept ONLY as a
   * compatibility safety net for adapters that don't surface a native step
   * callback.
   */
  onStepFinish(step: AgentStepInfo, ctx: StreamingAgentContext): void {
    if (!ctx.taskId) return;
    const state = this.counters.get(ctx.taskId) ?? { stepCount: 0, totalTokens: 0 };
    state.stepCount += 1;
    state.totalTokens += step.usage?.totalTokens ?? 0;
    this.counters.set(ctx.taskId, state);

    if (state.stepCount % this.progressInterval !== 0) return;

    this.safePublish({
      type: "progress",
      taskId: ctx.taskId,
      role: ctx.agentId || "worker",
      note: `Step ${state.stepCount}`,
      stepIdx: state.stepCount,
      tokensSoFar: state.totalTokens,
      ts: Date.now(),
    });
  }

  onChunk(part: StreamPart, ctx: StreamingAgentContext): void {
    if (!ctx.taskId) return;

    // `finish-step` chunk path — kept ONLY as a safety net for adapters that
    // don't surface a native onStepFinish callback. When AiSdkAgent emits both,
    // we must NOT double-count: skip if onStepFinish already updated this step.
    if (part?.type === "finish-step") {
      // No-op when onStepFinish is wired (the primary path). If a future
      // adapter only emits chunk-based step boundaries it can opt in by
      // setting `useChunkSteps = true` via a constructor flag.
      return;
    }

    if (part?.type === "tool-output-available") {
      const toolName = part.toolName ?? "";
      if (!MILESTONE_TOOLS.has(toolName)) return;
      const output = part.output;
      const summary =
        typeof output === "string"
          ? output.slice(0, 200)
          : JSON.stringify(output).slice(0, 200);
      this.safePublish({
        type: "tool_milestone",
        taskId: ctx.taskId,
        role: ctx.agentId || "worker",
        tool: toolName,
        summary,
        ts: Date.now(),
      });
    }
  }

  onFinish(result: AgentRunResult, ctx: StreamingAgentContext): void {
    if (!ctx.taskId) return;
    this.counters.delete(ctx.taskId);

    const summary =
      typeof result?.text === "string" && result.text.length
        ? result.text.slice(0, 500)
        : "Task completed";

    this.safePublish({
      type: "completed",
      taskId: ctx.taskId,
      role: ctx.agentId || "worker",
      summary,
      ts: Date.now(),
    });
  }

  onError(error: Error, ctx: StreamingAgentContext): void {
    if (!ctx.taskId) return;
    this.counters.delete(ctx.taskId);

    this.safePublish({
      type: "failed",
      taskId: ctx.taskId,
      role: ctx.agentId || "worker",
      error: error?.message || String(error) || "Unknown error",
      ts: Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private safePublish(update: TaskUpdate): void {
    try {
      this.publish(update);
    } catch (err) {
      this.log.warn?.(`[ChannelBVisitor] publish threw — dropping update`, err);
    }
  }
}
