/**
 * AgentRuntimeFactory — Phase 1.7 of the agent-stream-bus refactor.
 *
 * The ONE wiring point that turns a freshly-loaded `IStreamingAgent` (e.g.
 * `AiSdkAgent`) into a fully-wired, ready-to-run agent:
 *
 *   1. `agent.onStreaming` ← composite visitor (StreamPublisher +
 *      ChannelB + Crdt + ErrorChannel + any custom visitors).
 *   2. `agent.onTaskLifecycle` ← orchestration hooks delegating to
 *      `GoalManager.onWorkerDone()` / `handleTaskFailure()` / TaskStore /
 *      DependencyResolver via `GoalManagerOrchestratorAdapter`.
 *   3. Lifecycle tools assembled and returned so the caller can inject
 *      them into the agent's tool list. Hooks is the only orchestration
 *      mode; the legacy callback fan-out path was deleted May 9 2026
 *      (debt patch #5). Each lifecycle tool delegates to its hook so
 *      there is exactly one orchestration owner per tool call.
 *
 * Design:
 *   - This factory is per-team. Construct it once during AgentManager /
 *     OrchestratorService bootstrap with the team's GoalManager + visitor
 *     wiring, then call `wire(agent, executionContext)` per task to get a
 *     ready agent.
 *   - The factory does NOT load definitions or instantiate `AiSdkAgent` —
 *     that stays with the existing `AgentFactory` (definition loader).
 *     `WorkerPool.runTask()` invokes both: the definition factory creates
 *     the `IStreamingAgent`, then this runtime factory wires it.
 */

import { rootLogger } from "../../logging.js";
import { assembleLifecycleTools } from "../../services/tools/assembleLifecycleTools.js";
import type {
  AgentContext,
  IStreamingAgent,
  StreamingAgentContext,
  StreamingHooks,
  TaskCompletePayload,
  TaskCompleteAck,
  TaskBouncePayload,
  TaskStatusPayload,
  SubtaskRequestPayload,
  SubtaskRequestAck,
  TaskLifecycleHooks,
} from "../streaming/types.js";

const logger = rootLogger.child({ module: "AgentRuntimeFactory" });

// =============================================================================
// Public types
// =============================================================================

/**
 * Per-team orchestration deps that lifecycle hooks delegate to.
 *
 * These are intentionally typed as small interfaces (not concrete classes)
 * so the runtime factory can be unit-tested without spinning up a
 * GoalManager + TaskStore.
 */
export interface AgentRuntimeOrchestrator {
  /**
   * Mark the worker done; merges workspace + completes task + cascades
   * dependents. Parity with `GoalManager.onWorkerDone()`.
   */
  onWorkerDone(data: {
    taskId: string;
    role: string;
    summary: string;
    deliverables?: string[];
    nextSteps?: string[];
    producedDocs?: Array<{ uri: string; name: string; description?: string }>;
    decisions?: Array<{ decision: string; rationale?: string }>;
    timestamp: number;
  }): Promise<void>;

  /**
   * Handle bounce_task — mark failed + cascade. Parity with
   * `GoalManager.handleTaskFailure(taskId, reason)`.
   */
  handleTaskFailure(taskId: string, reason: string): Promise<void>;

  /**
   * Create a new task from a subtask request. Returns the orchestrator-assigned
   * task id (the tool reads this to surface back to the LLM). Parity with
   * the legacy `request_task` local mutations + `dagResolver.rebuild`.
   *
   * Returning `{ accepted: false, reason }` rejects creation; the tool
   * surfaces `reason` to the LLM as an actionable error.
   */
  createSubtask(payload: SubtaskRequestPayload, ctx: StreamingAgentContext)
    : Promise<SubtaskRequestAck>;

  /**
   * Update task's last reported status (drives auto-complete guard +
   * Channel B). Parity with `task.lastReportedStatus = data.status`.
   */
  updateLastReportedStatus(taskId: string, status: string): void;

  /**
   * Notify downstream listeners that a new task was created via
   * `request_task` — fire-and-forget. Parity with the legacy
   * `OrchestratorCallbacks.onTaskCreated` path which:
   *   - emits a state broadcast,
   *   - notifies the planner with the `task-created` prompt,
   *   - kicks `dispatchReadyTasks()` so newly-ready tasks dispatch.
   *
   * Required in the production interface so callers can't accidentally
   * forget to wire it (May 9 2026 review fix — was previously optional
   * as a test seam). Tests that don't care about the planner-notification
   * fan-out should pass an explicit `async () => {}` no-op.
   */
  notifyTaskCreated(
    payload: {
      taskId: string;
      createdBy: string;
      targetRole: string;
      relationship: string;
      parentTaskId: string;
    },
    ctx: StreamingAgentContext,
  ): void | Promise<void>;
}

/**
 * Optional hook to short-circuit / decorate `onComplete` before the
 * orchestrator handles it. Returning `{ accepted: false, reason }` rejects
 * completion (the tool surfaces `reason` to the LLM). Returning
 * `{ accepted: true }` (or `undefined`) allows orchestration to proceed.
 *
 * Used today by collab-task auto-close + report-doc validation that lives
 * outside the orchestrator. Optional — most callers will not need it.
 */
export type OnCompletePolicy = (
  payload: TaskCompletePayload,
  ctx: StreamingAgentContext,
) => Promise<TaskCompleteAck | undefined> | TaskCompleteAck | undefined;

/**
 * Per-team services available to lifecycle tools (taskStore + dagResolver
 * are needed by `request_task`/`bounce_task` for guard rails even in hooks
 * mode). These are READ-ONLY in hooks mode — the orchestrator owns mutations.
 */
export interface AgentRuntimeTaskServices {
  taskStore: any;
  dagResolver: any;
  teamRoles: string[];
  crdtTaskSync: any;
  taskPersistence?: any;
  teamId?: string;
}

/**
 * Per-execution wiring config. Called once per task / per agent run.
 */
export interface AgentRuntimeWireConfig {
  /** The agent to wire (already constructed + initialized). */
  agent: IStreamingAgent;

  /**
   * The execution context for this run. `goalId` is REQUIRED because hooks
   * are wired to streaming visitors that broadcast to goal-scoped Socket.IO
   * rooms.
   */
  context: StreamingAgentContext;

  /** Plan id for the task (passed through to lifecycle tools). */
  planId?: string | null;

  /**
   * Optional policy that runs BEFORE `orchestrator.onWorkerDone()` on
   * `complete_task`. Use this for pre-completion validation that can reject
   * the call (e.g. blocked guard, report-doc check that's already handled
   * inside the tool, or future custom policies).
   */
  onCompletePolicy?: OnCompletePolicy;

  /**
   * Optional extra streaming visitors composed into the agent's hooks.
   * The default visitors (`StreamPublisher`, `ChannelB`, `Crdt`) are
   * attached at AgentRuntimeFactory construction time. Use this to layer
   * per-execution visitors (e.g. cost tracking) without touching the
   * factory.
   */
  extraStreamingHooks?: StreamingHooks[];

  /**
   * Optional terminal-acceptance callback. Called AFTER orchestration
   * accepts a `complete_task` or `bounce_task` invocation — i.e. the
   * orchestrator returned without throwing AND the hook ack was
   * `accepted: true`. Wire this to `agent.markTerminated(kind)` so the
   * `streamText` loop's stop condition exits cleanly.
   *
   * If the orchestration handler throws OR returns `accepted: false`
   * (e.g. complete_task rejected for missing report doc), this is NOT
   * called — leaving the agent free to read the error string from the
   * tool result and self-correct in the next step.
   */
  onTerminated?: (kind: "complete" | "bounce") => void;
}

export interface AgentRuntimeFactoryDeps {
  /**
   * Default streaming hooks composed onto every wired agent. Typically the
   * StreamPublisher + ChannelB + Crdt visitors built once per team.
   */
  defaultStreamingHooks: StreamingHooks[];

  /** Orchestration handlers (per-team). */
  orchestrator: AgentRuntimeOrchestrator;

  /** Task-lifecycle services (per-team). */
  taskServices: AgentRuntimeTaskServices;
}

export interface WiredAgent {
  agent: IStreamingAgent;
  /** Lifecycle tools to inject into the agent (caller decides when).
   *  Empty when wired in stream-only mode (no `taskId`). */
  lifecycleTools: any[];
  /** Shared agentState for the blocked guard between report_status + complete_task.
   *  `undefined` when wired in stream-only mode (no lifecycle tools). */
  agentState: { lastStatus: string } | undefined;
}

// =============================================================================
// Implementation
// =============================================================================

export class AgentRuntimeFactory {
  private readonly defaultStreamingHooks: StreamingHooks[];
  private readonly orchestrator: AgentRuntimeOrchestrator;
  private readonly taskServices: AgentRuntimeTaskServices;

  constructor(deps: AgentRuntimeFactoryDeps) {
    this.defaultStreamingHooks = [...deps.defaultStreamingHooks];
    this.orchestrator = deps.orchestrator;
    this.taskServices = deps.taskServices;
  }

  /**
   * Wire an agent for streaming (and optionally for full task execution).
   *
   * Single entry point — the presence of `context.taskId` decides what
   * gets wired:
   *
   *   - **Stream-only** (`taskId` is missing): only `agent.onStreaming` is
   *     installed. Used for ChatAgent + planner where there's no
   *     `complete_task`/`bounce_task`/`request_task` to assemble.
   *   - **Full task execution** (`taskId` is set): `agent.onStreaming` AND
   *     `agent.onTaskLifecycle` are installed, and the lifecycle tools
   *     are returned for the caller to inject into the agent's tool list.
   *
   * Idempotent: calling twice on the same agent overwrites the previous
   * wiring. The new visitors take effect on the next `runWithHooks()`.
   *
   * (Previously this was split into `wire()` + `wireStreamingOnly()` —
   * collapsed May 9 2026 because the only difference was whether lifecycle
   * tools got assembled.)
   */
  wire(config: AgentRuntimeWireConfig): WiredAgent {
    const { agent, context, planId, onCompletePolicy, onTerminated } = config;

    if (!context.goalId) {
      // StreamingAgentContext requires goalId at compile time, but a JS
      // caller could still pass a loose object. Fail loudly here so a
      // streaming agent can never be wired without a goal.
      throw new Error(
        `AgentRuntimeFactory.wire: context.goalId is required for streaming agents (agent=${agent.id})`,
      );
    }

    // 1. Compose streaming hooks (defaults + per-execution extras). Always
    //    wired regardless of mode.
    agent.onStreaming = this.composeStreamingHooks([
      ...this.defaultStreamingHooks,
      ...(config.extraStreamingHooks ?? []),
    ]);

    // 2. Stream-only mode (no taskId): we're done.
    if (!context.taskId) {
      logger.debug(
        `Wired stream-only agent ${agent.id} for goal=${context.goalId}`,
      );
      return { agent, lifecycleTools: [], agentState: undefined };
    }

    // 3. Full task execution: wire lifecycle hooks + tools.
    const lifecycleHooks = this.buildLifecycleHooks(onCompletePolicy);
    agent.onTaskLifecycle = lifecycleHooks;

    // 4. Assemble the four lifecycle tools. Hooks is the only orchestration
    //    mode (May 9 2026 — debt patch #5: `executionMode` flag deleted).
    const { tools: lifecycleTools, agentState } = assembleLifecycleTools({
      taskId: context.taskId,
      roleKey: context.agentId,
      // Typed callbacks are no longer forwarded — the lifecycleHooks below
      // are the single orchestration owner.
      callbacks: {},
      taskServices: {
        taskStore: this.taskServices.taskStore,
        dagResolver: this.taskServices.dagResolver,
        teamRoles: this.taskServices.teamRoles,
        crdtTaskSync: this.taskServices.crdtTaskSync,
        planId: planId ?? null,
        goalId: context.goalId,
        taskPersistence: this.taskServices.taskPersistence ?? null,
        teamId: this.taskServices.teamId,
      },
      lifecycleHooks,
      lifecycleCtx: context,
      onTerminated,
    });

    logger.debug(
      `Wired agent ${agent.id} for task=${context.taskId} goal=${context.goalId} (lifecycleTools=${lifecycleTools.length})`,
    );

    return { agent, lifecycleTools, agentState };
  }

  /**
   * @deprecated Use `wire()` without `context.taskId` instead.
   * Kept as a thin alias for callers (mostly tests) that were written
   * against the old two-method API.
   */
  wireStreamingOnly(config: {
    agent: IStreamingAgent;
    context: StreamingAgentContext;
    extraStreamingHooks?: StreamingHooks[];
  }): IStreamingAgent {
    this.wire(config as AgentRuntimeWireConfig);
    return config.agent;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Compose multiple StreamingHooks objects into one.
   *
   * Per-visitor isolation contract (StreamingHooks docstring):
   *   - Each visitor's hook call is wrapped in its OWN try/catch. A
   *     throwing/rejecting visitor MUST NOT prevent later visitors from
   *     receiving the same event. AiSdkAgent's `safeHook`/`safeHookAsync`
   *     only wraps the composite call, so we must isolate per-visitor here.
   *   - Awaited hooks (`onFinish`/`onError`) use `Promise.allSettled` so a
   *     slow OR rejecting visitor doesn't serialize or abort cleanup.
   */
  private composeStreamingHooks(parts: StreamingHooks[]): StreamingHooks {
    /**
     * Fire-and-forget visitor invoker. Catches sync throws AND attaches
     * `.catch()` to promise-like returns so a rejecting async visitor
     * cannot become an unhandled rejection AND cannot prevent later
     * visitors from receiving the same event.
     *
     * The composite hook itself still returns `void` (StreamingHooks
     * contract for `onStart` / `onChunk` / `onStepFinish`), so callers
     * like `AiSdkAgent.safeHookAsync` need not change.
     */
    const dispatchSync = (label: string, fn: () => void | Promise<unknown> | unknown): void => {
      try {
        const out = fn();
        if (out && typeof (out as any).then === "function") {
          (out as Promise<unknown>).catch((err) => {
            logger.warn(`[AgentRuntimeFactory] visitor ${label} rejected — swallowing: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      } catch (err) {
        logger.warn(`[AgentRuntimeFactory] visitor ${label} threw — swallowing: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    const safeAsync = async (label: string, fn: () => unknown | Promise<unknown>): Promise<void> => {
      try { await fn(); }
      catch (err) {
        logger.warn(`[AgentRuntimeFactory] visitor ${label} rejected — swallowing: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    return {
      onStart: (ctx) => {
        let i = 0;
        for (const p of parts) {
          const idx = i++;
          if (p.onStart) dispatchSync(`onStart[${idx}]`, () => p.onStart!(ctx));
        }
      },
      onChunk: (chunk, ctx) => {
        let i = 0;
        for (const p of parts) {
          const idx = i++;
          if (p.onChunk) dispatchSync(`onChunk[${idx}]`, () => p.onChunk!(chunk, ctx));
        }
      },
      onStepFinish: (step, ctx) => {
        let i = 0;
        for (const p of parts) {
          const idx = i++;
          if (p.onStepFinish) dispatchSync(`onStepFinish[${idx}]`, () => p.onStepFinish!(step, ctx));
        }
      },
      onFinish: async (result, ctx) => {
        // Per-visitor isolation: each visitor's promise is wrapped in safeAsync,
        // so one rejection cannot abort another. Promise.all over wrapped
        // promises means visitors run in parallel without serialization.
        await Promise.all(
          parts.map((p, i) =>
            p.onFinish ? safeAsync(`onFinish[${i}]`, () => p.onFinish!(result, ctx)) : Promise.resolve(),
          ),
        );
      },
      onError: async (error, ctx) => {
        await Promise.all(
          parts.map((p, i) =>
            p.onError ? safeAsync(`onError[${i}]`, () => p.onError!(error, ctx)) : Promise.resolve(),
          ),
        );
      },
    };
  }

  /**
  /**
   * Build lifecycle hooks bound to a single execution. These are what the
   * lifecycle tools call into to drive orchestration (one orchestration
   * owner per tool call — hooks is the only mode after Patch #5).
   */
  private buildLifecycleHooks(
    onCompletePolicy?: OnCompletePolicy,
  ): TaskLifecycleHooks {
    return {
      onComplete: async (
        payload: TaskCompletePayload,
        ctx: AgentContext,
      ): Promise<TaskCompleteAck> => {
        // Optional pre-orchestration policy hook (e.g. report-doc check).
        if (onCompletePolicy) {
          const policyResult = await onCompletePolicy(
            payload,
            ctx as StreamingAgentContext,
          );
          if (policyResult && policyResult.accepted === false) {
            return policyResult;
          }
        }

        if (!ctx.taskId || !ctx.agentId) {
          return {
            accepted: false,
            reason: `onComplete: missing taskId/agentId in context (programmer error).`,
          };
        }

        try {
          await this.orchestrator.onWorkerDone({
            taskId: ctx.taskId,
            role: ctx.agentId,
            summary: payload.summary,
            deliverables: payload.deliverables,
            nextSteps: payload.nextSteps,
            producedDocs: payload.producedDocs,
            decisions: payload.decisions,
            timestamp: payload.timestamp ?? Date.now(),
          });
          return { accepted: true };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          logger.warn(
            `onComplete delegate threw for task ${ctx.taskId}: ${reason}`,
          );
          return { accepted: false, reason };
        }
      },

      onStatusChange: async (
        payload: TaskStatusPayload,
        ctx: AgentContext,
      ) => {
        if (!ctx.taskId) return;
        try {
          this.orchestrator.updateLastReportedStatus(ctx.taskId, payload.status);
        } catch (err) {
          logger.warn(
            `onStatusChange delegate threw for task ${ctx.taskId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },

      onBounce: async (payload: TaskBouncePayload, ctx: AgentContext) => {
        if (!ctx.taskId) return;
        const reason =
          payload.suggestedRole != null
            ? `${payload.reason} (suggested role: ${payload.suggestedRole})`
            : payload.reason;
        try {
          await this.orchestrator.handleTaskFailure(ctx.taskId, reason);
        } catch (err) {
          logger.warn(
            `onBounce delegate threw for task ${ctx.taskId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },

      onSubtaskRequest: async (
        payload: SubtaskRequestPayload,
        ctx: AgentContext,
      ): Promise<SubtaskRequestAck> => {
        let ack: SubtaskRequestAck;
        try {
          ack = await this.orchestrator.createSubtask(
            payload,
            ctx as StreamingAgentContext,
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          logger.warn(
            `onSubtaskRequest delegate threw for task ${ctx.taskId}: ${reason}`,
          );
          return { accepted: false, reason };
        }

        // Planner notification + state broadcast + dispatch — parity with the
        // legacy `onTaskCreated` flow. Fire-and-forget; failures here MUST
        // NOT roll back the persisted subtask (the orchestrator owns it).
        // `notifyTaskCreated` is required on the orchestrator interface
        // (May 9 2026 review fix); callers that don't need fan-out pass
        // an explicit no-op.
        if (
          ack.accepted &&
          ack.newTaskId &&
          ctx.taskId &&
          payload.assignedRole
        ) {
          try {
            await this.orchestrator.notifyTaskCreated(
              {
                taskId: ack.newTaskId,
                createdBy: `agent:${ctx.agentId}`,
                targetRole: payload.assignedRole,
                relationship: payload.relationship ?? "independent",
                parentTaskId: ctx.taskId,
              },
              ctx as StreamingAgentContext,
            );
          } catch (err) {
            logger.warn(
              `notifyTaskCreated delegate threw for new task ${ack.newTaskId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return ack;
      },
    };
  }
}
