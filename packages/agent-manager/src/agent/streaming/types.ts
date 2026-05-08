/**
 * Agent Streaming & Lifecycle Hook Types
 *
 * Phase 1.1 of the agent-stream-bus refactor.
 * See: docs/features/agent-stream-bus/feature_architecture.md
 *
 * Status: ADDITIVE ONLY — no existing code is wired through these types yet.
 *
 * Design summary:
 *   - `IAgent` is the universal contract every agent (AiSdk, HTTP adapter, child
 *     Ping team, Docker adapter, ...) must satisfy.
 *   - Streaming observation flows through `StreamingHooks` (read-only, fire-and-
 *     forget, per-visitor try/catch). Visitors implement these hooks.
 *   - Task orchestration flows through `TaskLifecycleHooks` — lifecycle tools
 *     (`complete_task`, `bounce_task`, `report_status`, `request_task`) call
 *     into the agent's own hooks. The system plugs handlers in via
 *     `AgentFactory.create(...)`. No EventEmitters, no callback pyramids.
 *   - `AgentContext` carries identifiers (goalId, taskId, teamId, agentId)
 *     into every hook so visitors can route to the correct Socket.IO room,
 *     CRDT doc, persistence row, etc.
 *
 * Wire protocol contract (must be preserved by visitors):
 *   The frontend (`packages/frontend/services/AgentServiceV2.ts`,
 *   `goalSessionStore.ts`, `StreamMessage.tsx`) consumes this exact set of
 *   `StreamPart` types from the AI SDK Data Stream Protocol:
 *     start, text-delta, text-end,
 *     reasoning-start, reasoning-delta, reasoning-end,
 *     tool-input-start, tool-input-delta, tool-input-available,
 *     tool-output-available,
 *     start-step, finish-step, finish, error
 *   Plus internal additions used by SocketEventBroadcaster today:
 *     task-started, task-completed, task-failed,
 *     plan-proposed, plan-approved
 *   Visitors emitting toward the wire MUST preserve these exactly.
 */

// =============================================================================
// AgentContext — flows into every hook
// =============================================================================

/**
 * Per-execution context attached to every lifecycle hook call.
 *
 * Loose form (`goalId` optional). Use this for non-streaming flows or one-shot
 * adapters that have no goal session.
 *
 * Streaming hooks use the stricter `StreamingAgentContext` below — the type
 * system enforces that any agent wired to Socket.IO/CRDT visitors carries a
 * goalId, so `StreamPublisherVisitor` cannot silently skip persistence.
 */
export interface AgentContext {
  /** Team this execution belongs to. Used for room scoping (`team:{teamId}`). */
  teamId: string;

  /** Goal session this execution belongs to. Required for streaming agents. */
  goalId?: string;

  /** Task being executed. Absent for chat/planner runs that aren't a task. */
  taskId?: string;

  /** Agent identifier (role or worker id). */
  agentId: string;

  /** Optional message correlation id for resumable streams. */
  messageId?: string;

  /** Optional thread id (chat session, planner turn). */
  threadId?: string;

  /** User who initiated the work, when known. Used for ownership/auth checks. */
  userId?: string;

  /**
   * Free-form extension bag for visitors that need extra context (e.g. a
   * worker pool may attach per-worker handles here). Keep this small.
   */
  extras?: Readonly<Record<string, unknown>>;
}

/**
 * Strict variant for streaming agents.
 *
 * Adapters that emit to Socket.IO / CRDT / persistence MUST carry a goalId.
 * `AgentFactory.create()` constructs this; the orchestrator never wires a
 * streaming agent without one.
 */
export interface StreamingAgentContext extends AgentContext {
  goalId: string;
}

// =============================================================================
// Stream parts — re-export the wire vocabulary so visitors can be typed
// =============================================================================

/**
 * The discriminated union of stream parts the frontend understands.
 *
 * This vocabulary is the frontend wire contract. Every variant lists ONLY the
 * fields the publisher / persister actually consumes — index signatures are
 * intentionally absent so that adding a new field requires extending the
 * union here. Forward-compatibility for unknown AI SDK parts is handled
 * explicitly via `{ type: "unknown"; raw }` so visitors can spot and skip them.
 *
 * Source of truth for the wire contract:
 *   - packages/frontend/services/AgentServiceV2.ts
 *   - packages/frontend/components/StreamMessage.tsx
 *   - packages/backend/api/socket-types.ts (toStreamPart, toRenderedParts)
 */
export type StreamPart =
  | { type: "start"; messageId?: string }
  | { type: "start-step"; stepIndex?: number }
  | { type: "finish-step"; stepIndex?: number; finishReason?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
  | { type: "text-delta"; id?: string; delta: string }
  | { type: "text-end"; id?: string }
  | { type: "reasoning-start"; id?: string }
  | { type: "reasoning-delta"; id?: string; delta: string }
  | { type: "reasoning-end"; id?: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-input-available"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-output-available"; toolCallId: string; toolName?: string; output: unknown }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName?: string; result: unknown }
  | { type: "finish"; finishReason?: string }
  | { type: "error"; error: string }
  | { type: "task-started"; taskId: string; role: string }
  | { type: "task-completed"; taskId: string; role: string }
  | { type: "task-failed"; taskId: string; role: string; error?: string }
  | { type: "plan-proposed"; planId: string; taskCount: number }
  | { type: "plan-approved"; planId: string }
  /** Forward-compatibility for AI SDK parts the wire doesn't consume yet. */
  | { type: "unknown"; raw: unknown };

// =============================================================================
// StreamingHooks — read-only observation of agent execution
// =============================================================================

/**
 * Read-only streaming hooks. Implemented by visitors
 * (StreamPublisherVisitor, ChannelBVisitor, CrdtStatusVisitor, ...).
 *
 * The interface is split into two sub-interfaces by back-pressure
 * semantics (May 9 2026 review fix #9). Visitors should implement
 * whichever subset they actually need:
 *
 *   - `IStreamingObserver` — fire-and-forget hooks (`onStart`,
 *     `onChunk`, `onStepFinish`). Returning a promise is allowed but the
 *     agent loop does NOT await it. A slow OR rejecting visitor here will
 *     not stall token streaming.
 *   - `IStreamingTerminal` — awaited hooks (`onFinish`, `onError`). The
 *     agent loop awaits these so persistence/cleanup completes before
 *     `runWithHooks()` returns.
 *
 * `StreamingHooks` is the union — any visitor may implement either subset
 * or both. The agent runtime wraps EVERY hook call in try/catch and logs;
 * a throwing/rejecting visitor MUST NOT halt the agent loop. Hooks are
 * called in registration order. The same `StreamingAgentContext` instance
 * is passed to every hook of a single execution; visitors MAY cache state
 * keyed by `taskId`/`messageId`.
 */
export interface IStreamingObserver {
  /** Called once when execution starts (before any streamText() output). FIRE-AND-FORGET. */
  onStart?(ctx: StreamingAgentContext): void | Promise<void>;

  /**
   * Called for each AI SDK stream chunk. This is the primary hook.
   * Mirrors `streamText({ onChunk })`. The same chunk is delivered to every
   * visitor. FIRE-AND-FORGET.
   */
  onChunk?(part: StreamPart, ctx: StreamingAgentContext): void | Promise<void>;

  /**
   * Called when an agentic step finishes. Mirrors
   * `streamText({ onStepFinish })`. Useful for progress notifications,
   * cost tracking, and Channel B summaries. FIRE-AND-FORGET.
   *
   * NOTE: visitors that want progress per step MUST implement this hook;
   * relying on a synthetic `finish-step` chunk is not safe once `AiSdkAgent`
   * is wired to native AI SDK hooks.
   */
  onStepFinish?(step: AgentStepInfo, ctx: StreamingAgentContext): void | Promise<void>;
}

export interface IStreamingTerminal {
  /**
   * Called when the entire run finishes (after the last step). Mirrors
   * `streamText({ onFinish })`. AWAITED — this is when the
   * StreamPublisherVisitor persists the assembled assistant message and
   * `runWithHooks()` will not return until every visitor's `onFinish`
   * resolves (or throws, in which case the loop logs and continues).
   */
  onFinish?(result: AgentRunResult, ctx: StreamingAgentContext): void | Promise<void>;

  /** Called when the run errors. AWAITED so cleanup completes before throw. */
  onError?(error: Error, ctx: StreamingAgentContext): void | Promise<void>;
}

/**
 * Composite of `IStreamingObserver` + `IStreamingTerminal`. Most visitors
 * implement this single union type; the split exists so a visitor can
 * declare which subset it actually owns by `implements`-ing the narrower
 * interface (the runtime accepts either).
 */
export type StreamingHooks = IStreamingObserver & IStreamingTerminal;

/**
 * Lightweight summary of a step. Mirrors what `streamText({ onStepFinish })`
 * surfaces, normalised so non-AiSdk adapters can produce the same shape.
 */
export interface AgentStepInfo {
  stepIndex: number;
  finishReason?: string;
  text?: string;
  toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
  toolResults?: Array<{ toolCallId: string; toolName?: string; result: unknown }>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * Final result of an agent run. The full ModelMessage[] is intentionally
 * `unknown[]` here so this type doesn't depend on `ai`.
 *
 * `output` is set by structured-mode adapters (builders) so callers can
 * receive a typed payload alongside the assistant text.
 */
export interface AgentRunResult {
  text: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** Full ModelMessage[] from the AI SDK response, for persistence. */
  responseMessages?: unknown[];
  /** Accumulated tool calls in this run, for UI cards & persistence. */
  toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown; result?: unknown }>;
  /** Free-form output (structured-mode payload, builder result, etc). */
  output?: unknown;
}

// =============================================================================
// TaskLifecycleHooks — agent → orchestrator
// =============================================================================

/**
 * Lifecycle hooks fired by the agent (typically from inside lifecycle tools
 * such as `complete_task`, `bounce_task`, `report_status`, `request_task`).
 *
 * The `AgentFactory` plugs in handlers that delegate to the existing
 * `GoalManager.onWorkerDone()`, `OrchestratorService.handleTaskFailure()`,
 * etc. — so this is a thin re-shaping of existing orchestration, not a
 * replacement for it.
 *
 * Contract:
 *   - Handlers are awaited. The lifecycle tool MUST await the hook before
 *     returning to the LLM, so subsequent tool calls see a consistent state.
 *   - Returning `false` from `onComplete` indicates the orchestrator rejected
 *     completion (e.g. unmet prerequisites). The tool should surface this back
 *     to the LLM as an actionable error.
 *   - Hooks are optional. Adapters that have no orchestration (e.g. a
 *     standalone HTTP test agent) may leave them undefined.
 */
export interface TaskLifecycleHooks {
  /** Agent reports task complete. Returns false if orchestrator rejected. */
  onComplete?(
    payload: TaskCompletePayload,
    ctx: AgentContext,
  ): Promise<TaskCompleteAck>;

  /** Agent reports a status change ("in_progress", "blocked", etc). */
  onStatusChange?(
    payload: TaskStatusPayload,
    ctx: AgentContext,
  ): Promise<void>;

  /** Agent bounces work (cannot complete; needs replan / fails task). */
  onBounce?(
    payload: TaskBouncePayload,
    ctx: AgentContext,
  ): Promise<void>;

  /** Agent requests a new sub-task be added to the plan. */
  onSubtaskRequest?(
    payload: SubtaskRequestPayload,
    ctx: AgentContext,
  ): Promise<SubtaskRequestAck>;
}

export interface TaskCompletePayload {
  /** Free-form structured output. May be undefined when `summary` is enough. */
  output?: unknown;
  /** Required summary of what was accomplished. */
  summary: string;
  /** Concrete deliverables (file paths, URLs, ...). */
  deliverables?: string[];
  /** Recommended next steps for the user / planner. */
  nextSteps?: string[];
  /**
   * Documents produced by this task. Downstream tasks receive these as
   * `inputDocs`. URI scheme: `workspace:path` | `crdt:docName` | `https://...`.
   */
  producedDocs?: Array<{
    uri: string;
    name: string;
    description?: string;
  }>;
  /** Key decisions made during this task. Downstream tasks must respect these. */
  decisions?: Array<{
    decision: string;
    rationale?: string;
  }>;
  /** Generic artifact references (kept for adapters without producedDocs). */
  artifacts?: Array<{ id: string; type: string; ref?: string }>;
  /** Wall-clock completion time (ms). Defaults to `Date.now()` at hook call. */
  timestamp?: number;
}

export interface TaskCompleteAck {
  accepted: boolean;
  /** When `accepted: false`, an actionable message for the LLM. */
  reason?: string;
}

export interface TaskStatusPayload {
  status: "in_progress" | "blocked" | "needs_input" | "waiting" | string;
  detail?: string;
}

export interface TaskBouncePayload {
  reason: string;
  /**
   * Optional hint to planner about which role should pick up this work.
   * Mirrors the legacy `bounce_task` `suggestedRole` argument.
   */
  suggestedRole?: string;
  /** Optional free-form detail for the planner. */
  detail?: string;
}

export interface SubtaskRequestPayload {
  /**
   * Concatenated `${title}: ${description}` matching the legacy path's
   * `task.description` field, so the orchestrator can persist the same
   * shape without rebuilding it.
   */
  description: string;
  /** Original short title (kept for `task.context.title` parity). */
  title?: string;
  /** Lowercase target role. The orchestrator owns role validation. */
  assignedRole?: string;
  /** Tasks the new task depends on (e.g. `[parentTaskId]` for blocks-me). */
  dependsOn?: string[];
  /**
   * 2..5 priority. Defaults to 3 in `request_task`. Priority 1 is reserved
   * for the planner.
   */
  priority?: number;
  /** `work` | `review` | `collaboration` | `subtask` | `decision`. */
  type?: string;
  /** `independent` | `subtask` | `blocks-me`. */
  relationship?: "independent" | "subtask" | "blocks-me";
  /**
   * Parent task that initiated the request. Used by the orchestrator to
   * set `context.parentTask` and the reverse `dependants` link.
   */
  parentTaskId?: string;
  /** Goal the request belongs to (orchestrator scopes persistence to it). */
  goalId?: string;
  /** Plan the request belongs to. */
  planId?: string;
  /** Free-form context propagated from the LLM call. */
  context?: {
    reason?: string;
    files?: string[];
    artifacts?: string[];
  };
}

export interface SubtaskRequestAck {
  accepted: boolean;
  newTaskId?: string;
  reason?: string;
}

// =============================================================================
// IAgent — the universal contract
// =============================================================================

/**
 * The universal agent interface.
 *
 * Every concrete agent — `AiSdkAgent`, `HttpAgentAdapter`, `PingTeamAdapter`,
 * `DockerAgentAdapter`, ... — implements this. The orchestrator only ever
 * holds a reference of type `IAgent` and never depends on a concrete class.
 *
 * NOTE: This intentionally does NOT extend the legacy `IAgent` defined in
 * `agent/types.ts` (which wraps tasks/conversation). The legacy interface is
 * kept for backward compatibility with the existing AgentFactory; this
 * interface is the going-forward contract used by the orchestrator and
 * `AgentFactory.createForExecution(...)` (Phase 1.7).
 */
export interface IStreamingAgent {
  /** Stable identifier (role or worker id). */
  readonly id: string;

  /** Human-readable display name. */
  readonly name: string;

  /** Logical role this agent plays. */
  readonly role: string;

  /**
   * Streaming observation hooks. Set by `AgentFactory.create(...)` before
   * `run()` is called. Implementers MUST invoke these hooks in the right
   * order during execution and isolate each visitor with try/catch.
   */
  onStreaming?: StreamingHooks;

  /**
   * Task lifecycle hooks. Set by `AgentFactory.create(...)`. The agent's
   * lifecycle tools (`complete_task`, `bounce_task`, ...) call into these
   * hooks instead of importing orchestrator classes directly.
   */
  onTaskLifecycle?: TaskLifecycleHooks;

  /**
   * Execute one turn / one task with streaming + lifecycle hooks invoked.
   *
   * Implementations MUST:
   *   - Invoke `onStreaming.onStart` before any chunk.
   *   - Invoke `onStreaming.onChunk` for every stream part (preserving the
   *     wire vocabulary documented in the StreamPart union).
   *   - Invoke `onStreaming.onStepFinish` per step boundary.
   *   - Invoke `onStreaming.onFinish` exactly once at the end of a successful
   *     run, OR `onStreaming.onError` on failure.
   *   - Wrap each visitor call in try/catch. A throwing visitor must not
   *     break the agent loop.
   *
   * Method is named `runWithHooks` (not `run`) to avoid colliding with the
   * legacy `AiSdkAgent.run(prompt, threadId)` convenience helper used by the
   * builder path. The legacy helper will be removed in Phase 2.
   */
  runWithHooks(input: AgentRunInput): Promise<AgentRunResult>;
}

/**
 * Input to `IStreamingAgent.runWithHooks()`. Lean by design — the heavy
 * context lives on the agent instance (messages, tools) and on the
 * per-execution `StreamingAgentContext` injected by the factory.
 */
export interface AgentRunInput {
  /** User/system message that triggers this turn. */
  message: string;

  /** Per-execution context (goalId, taskId, teamId, agentId, ...). */
  context: StreamingAgentContext;

  /**
   * Optional structured input for non-chat adapters (e.g. an HTTP adapter
   * may pass arbitrary JSON instead of a free-form message).
   */
  payload?: unknown;
}
