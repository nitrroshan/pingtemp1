/**
 * GoalManagerOrchestratorAdapter — Phase 1.8a of the agent-stream-bus
 * refactor.
 *
 * Implements `AgentRuntimeOrchestrator` by delegating to the existing
 * `GoalManager` + `TaskStore` + `DependencyResolver`. This is the bridge
 * that lets `AgentRuntimeFactory.wire(...)` route lifecycle hook calls
 * back into today's orchestration without each wiring caller having to
 * import GoalManager directly.
 *
 * Status: ADDITIVE. No caller is wired to this yet; Step 1.8b adds an
 * opt-in feature flag in `WorkerPool`.
 *
 * Parity contract (what each method must reproduce):
 *
 *   - `onWorkerDone` → `GoalManager.onWorkerDone()`. Same shape, same
 *     side effects (workspace merge, complete task, cascade dependents).
 *
 *   - `handleTaskFailure` → `GoalManager.handleTaskFailure(taskId, reason)`.
 *
 *   - `updateLastReportedStatus` → `task.lastReportedStatus = status`.
 *     Mirrors the field write `OrchestratorService.onStatusUpdate` does
 *     today; this drives the dispatch auto-complete guard.
 *
 *   - `createSubtask` → reproduces the local mutations the legacy
 *     `request_task` tool did: build the Task object from the rich
 *     `SubtaskRequestPayload`, validate cycles when `relationship ==
 *     "blocks-me"`, persist via `taskStore.create`, optionally append
 *     prerequisite, rebuild the DAG. Returns
 *     `{ accepted: true, newTaskId }` on success.
 *
 * Notes:
 *   - The adapter intentionally uses the same task-id convention as the
 *     legacy `request_task` (`<goalPrefix>-task-N`). When Phase 2 moves
 *     TaskStore into per-goal scopes this becomes natural.
 *   - Errors from delegate methods bubble up; `AgentRuntimeFactory`
 *     wraps them into `{ accepted: false, reason }` for the LLM-facing
 *     response.
 */

import { rootLogger } from "../logging.js";
import { buildSubtask } from "./buildSubtask.js";
import type {
  AgentRuntimeOrchestrator,
} from "../agent/runtime/AgentRuntimeFactory.js";
import type {
  StreamingAgentContext,
  SubtaskRequestPayload,
  SubtaskRequestAck,
} from "../agent/streaming/types.js";

const logger = rootLogger.child({ module: "GoalManagerOrchestratorAdapter" });

// =============================================================================
// Minimal interfaces for the delegates
//
// We intentionally take small structural interfaces (not the concrete
// GoalManager / TaskStore / DependencyResolver classes) so this adapter
// can be unit-tested without spinning up the whole orchestrator stack.
// =============================================================================

export interface IGoalManagerLite {
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

  handleTaskFailure(taskId: string, reason: string): Promise<void>;
}

/**
 * Subset of TaskStore used by the adapter. Reads + writes both happen here;
 * the underlying TaskStore handles MongoDB write-through.
 */
export interface ITaskStoreLite {
  get(id: string): any | undefined;
  getByGoal(goalId: string): any[];
  create(task: any): Promise<void>;
  remove(id: string): boolean;
  updateStatus(id: string, status: string): Promise<void>;
  addPrerequisite(taskId: string, prerequisiteTaskId: string): Promise<void>;
}

export interface IDependencyResolverLite {
  rebuild(source: any): void;
  rebuildForGoal?(source: any, goalId: string): void;
  validateDependencies?(taskId: string, deps: string[]): string | null;
}

export interface GoalManagerOrchestratorAdapterDeps {
  goalManager: IGoalManagerLite;
  taskStore: ITaskStoreLite;
  dagResolver: IDependencyResolverLite;
  /**
   * Planner-notification + state-broadcast hook fired AFTER a successful
   * `createSubtask`. Wire this to the existing
   * `OrchestratorCallbacks.onTaskCreated` (which sends the planner the
   * `task-created` prompt, broadcasts state, and triggers
   * `dispatchReadyTasks()`). Fire-and-forget; failures MUST NOT roll back
   * the persisted subtask.
   *
   * Required (May 9 2026 review fix — was previously optional as a test
   * seam). Tests that don't care about the planner-notification fan-out
   * should pass an explicit `async () => {}` no-op.
   */
  notifyTaskCreated: (data: {
    taskId: string;
    createdBy: string;
    targetRole: string;
    relationship: string;
    parentTaskId: string;
  }) => void | Promise<void>;
}

// =============================================================================
// Implementation
// =============================================================================

export class GoalManagerOrchestratorAdapter implements AgentRuntimeOrchestrator {
  private readonly goalManager: IGoalManagerLite;
  private readonly taskStore: ITaskStoreLite;
  private readonly dagResolver: IDependencyResolverLite;
  private readonly notifyTaskCreatedDelegate: GoalManagerOrchestratorAdapterDeps["notifyTaskCreated"];

  constructor(deps: GoalManagerOrchestratorAdapterDeps) {
    this.goalManager = deps.goalManager;
    this.taskStore = deps.taskStore;
    this.dagResolver = deps.dagResolver;
    this.notifyTaskCreatedDelegate = deps.notifyTaskCreated;
  }

  // ---------------------------------------------------------------------------
  // AgentRuntimeOrchestrator
  // ---------------------------------------------------------------------------

  async onWorkerDone(data: {
    taskId: string;
    role: string;
    summary: string;
    deliverables?: string[];
    nextSteps?: string[];
    producedDocs?: Array<{ uri: string; name: string; description?: string }>;
    decisions?: Array<{ decision: string; rationale?: string }>;
    timestamp: number;
  }): Promise<void> {
    // Mirror the legacy `complete_task` callback path in WorkerPool:
    // mark `completionSource = "tool"` BEFORE delegating so the dispatch
    // auto-complete guard can see it.
    const task = this.taskStore.get(data.taskId);
    if (task) task.completionSource = "tool";

    await this.goalManager.onWorkerDone(data);
  }

  async handleTaskFailure(taskId: string, reason: string): Promise<void> {
    await this.goalManager.handleTaskFailure(taskId, reason);
  }

  updateLastReportedStatus(taskId: string, status: string): void {
    const task = this.taskStore.get(taskId);
    if (!task) return;
    task.lastReportedStatus = status;
  }

  /**
   * Planner notification + state broadcast hook. Required: callers must
   * pass an explicit no-op (`async () => {}`) if they don't care about
   * the fan-out. Forwards to the existing
   * `OrchestratorCallbacks.onTaskCreated` path which sends the
   * `task-created` prompt to the planner, broadcasts task state, and
   * triggers `dispatchReadyTasks()`.
   */
  async notifyTaskCreated(data: {
    taskId: string;
    createdBy: string;
    targetRole: string;
    relationship: string;
    parentTaskId: string;
  }): Promise<void> {
    try {
      await this.notifyTaskCreatedDelegate(data);
    } catch (err) {
      // Fire-and-forget contract: planner notification failures MUST NOT
      // roll back the persisted subtask.
      logger.warn(
        `notifyTaskCreated delegate threw for ${data.taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async createSubtask(
    payload: SubtaskRequestPayload,
    ctx: StreamingAgentContext,
  ): Promise<SubtaskRequestAck> {
    if (!payload.assignedRole) {
      return { accepted: false, reason: "createSubtask: assignedRole is required" };
    }
    if (!ctx.taskId) {
      return { accepted: false, reason: "createSubtask: parent ctx.taskId is required" };
    }

    // All core mutations live in the shared `buildSubtask` helper so this
    // adapter and the legacy `request_task` tool can't drift (May 9 2026
    // review fix #4 — see `./buildSubtask.ts`).
    return buildSubtask(
      {
        createdBy: `agent:${ctx.agentId}`,
        parentTaskId: ctx.taskId,
        goalId: payload.goalId ?? ctx.goalId,
        planId: payload.planId ?? null,
        description: payload.description,
        title: payload.title,
        assignedRole: payload.assignedRole,
        priority: payload.priority ?? 3,
        type: payload.type,
        relationship: payload.relationship ?? "independent",
        context: payload.context,
      },
      {
        taskStore: this.taskStore,
        dagResolver: this.dagResolver,
      },
    );
  }
}
