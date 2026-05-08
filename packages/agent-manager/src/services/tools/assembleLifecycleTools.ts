/**
 * assembleLifecycleTools — builds the set of task-lifecycle tools
 * (report_status, complete_task, request_task, bounce_task) that every
 * worker agent receives.
 *
 * Extracted from WorkerPool.runTask() so tool wiring is testable and
 * WorkerPool stays focused on worker lifecycle.
 */

import {
  createReportStatusTool,
  createCompleteTaskTool,
  createRequestTaskTool,
  createBounceTaskTool,
} from "../../agent/internal/tools/index.js";
import type { AgentContext, TaskLifecycleHooks } from "../../agent/streaming/types.js";

// ── Public types ───────────────────────────────────────────────

export interface LifecycleToolCallbacks {
  onStatusUpdate?: (data: { taskId: string; role: string; status: string; summary: string; progress?: number; timestamp: number }) => void;
  onAgentComplete?: (data: {
    taskId: string;
    role: string;
    summary: string;
    deliverables: string[];
    nextSteps: string[];
    /** Phase 1.6 fix: type now matches what completeTaskTool actually passes. */
    producedDocs?: Array<{ uri: string; name: string; description?: string }>;
    /** Phase 1.6 fix: type now matches what completeTaskTool actually passes. */
    decisions?: Array<{ decision: string; rationale?: string }>;
    timestamp: number;
  }) => void;
  onTaskCreated?: (data: { taskId: string; createdBy: string; targetRole: string; relationship: string; parentTaskId: string }) => void;
  onBounce?: (data: { taskId: string; role: string; reason: string; suggestedRole?: string; timestamp: number }) => void;
}

export interface TaskServices {
  taskStore: { getAll(): any[]; get(id: string): any; create(t: any): void; remove(id: string): boolean; updateStatus(id: string, s: string): void } | null;
  dagResolver: { rebuild(source: any): void; validateDependencies?(taskId: string, deps: string[]): string | null } | null;
  teamRoles: string[];
  crdtTaskSync: { persistTask(t: any): Promise<void>; syncStatus(id: string, s: string, o?: any): Promise<void>; updateIndex(tasks: any[]): Promise<void> } | null;
  planId: string | null;
  goalId: string | null;
  taskPersistence?: { saveTasks(goalId: string, teamId: string, tasks: any[]): Promise<void>; updateTaskStatus(taskId: string, goalId: string, status: string, output?: unknown): Promise<void> } | null;
  teamId?: string;
}

export interface AssembleLifecycleToolsParams {
  taskId: string;
  roleKey: string;
  /**
   * @deprecated Hooks is now the only orchestration path (May 9 2026 —
   * debt patch #5). The typed callbacks are no longer forwarded; the
   * field is retained on the type only for back-compat with callers
   * still passing it.
   */
  callbacks: LifecycleToolCallbacks;
  taskServices: TaskServices;
  /**
   * TaskLifecycleHooks — REQUIRED. Hooks is the only orchestration mode
   * (debt patch #5). Each lifecycle tool delegates to the corresponding
   * hook (`onComplete` / `onBounce` / `onSubtaskRequest` / `onStatusChange`).
   */
  lifecycleHooks?: TaskLifecycleHooks;
  lifecycleCtx?: AgentContext;
  /**
   * Terminal-acceptance callback. Called AFTER the orchestration hook has
   * accepted (`complete_task` returns `accepted: true`, or `bounce_task`
   * returns without throwing). Wire this to `agent.markTerminated(kind)`
   * so the streamText loop's stop condition exits cleanly.
   *
   * NOT called if the hook throws or returns `accepted: false` (e.g.
   * `complete_task` rejected for missing report doc) — leaving the agent
   * free to read the error and self-correct in the next step.
   */
  onTerminated?: (kind: "complete" | "bounce") => void;
}

/**
 * Shared mutable state between report_status and complete_task.
 * complete_task uses lastStatus to enforce the "blocked → can't complete" guard.
 */
export interface AgentState {
  lastStatus: string;
}

export interface LifecycleToolsResult {
  tools: any[];
  agentState: AgentState;
}

// ── Assembly function ───────────────────────────────────────────────────────

export function assembleLifecycleTools(
  params: AssembleLifecycleToolsParams,
): LifecycleToolsResult {
  const {
    taskId,
    roleKey,
    taskServices,
    lifecycleHooks,
    lifecycleCtx,
    onTerminated,
  } = params;

  // Hooks is now the only orchestration mode (May 9 2026 — debt patch #5).
  // The legacy callback fan-out path was deleted along with the legacy
  // WorkerPool.runTask branch (patch #2). Tools now have exactly one
  // orchestration owner: the hook. The typed `callbacks` parameter is
  // kept on the type for back-compat with mixed callers but is no longer
  // forwarded.
  if (!lifecycleHooks || !lifecycleCtx) {
    throw new Error(
      `assembleLifecycleTools: lifecycleHooks and lifecycleCtx are required (hooks is now the only mode)`,
    );
  }

  const tools: any[] = [];

  // Shared state between lifecycle tools — enables blocked guard.
  const agentState: AgentState = { lastStatus: "in_progress" };

  // ---- report_status ----
  // The hook is the only orchestration listener. We still update agentState
  // locally so the complete_task blocked-guard works.
  tools.push(
    createReportStatusTool(
      taskId,
      roleKey,
      (data) => { agentState.lastStatus = data.status; },
      lifecycleHooks,
      lifecycleCtx,
    ),
  );

  // ---- complete_task ----
  // The tool itself calls `onTerminated('complete')` AFTER the hook
  // returns `accepted: true`. No typed callback — the hook IS the
  // orchestration call.
  tools.push(
    createCompleteTaskTool(
      taskId,
      roleKey,
      undefined,
      agentState,
      lifecycleHooks,
      lifecycleCtx,
      onTerminated,
    ),
  );

  // ---- request_task + bounce_task (only when task services are available) ----
  if (taskServices.taskStore && taskServices.dagResolver) {
    tools.push(
      createRequestTaskTool({
        taskId,
        role: roleKey,
        planId: taskServices.planId,
        goalId: taskServices.goalId,
        availableRoles: taskServices.teamRoles,
        taskStore: taskServices.taskStore,
        dagResolver: taskServices.dagResolver,
        crdtTaskSync: taskServices.crdtTaskSync,
        taskPersistence: taskServices.taskPersistence || null,
        teamId: taskServices.teamId,
        lifecycleHooks,
        lifecycleCtx,
      }),
    );

    // The tool itself calls `onTerminated('bounce')` after the hook
    // returns without throwing.
    tools.push(
      createBounceTaskTool({
        taskId,
        role: roleKey,
        availableRoles: taskServices.teamRoles,
        taskStore: taskServices.taskStore,
        crdtTaskSync: taskServices.crdtTaskSync,
        lifecycleHooks,
        lifecycleCtx,
        onTerminated,
      }),
    );
  }

  return { tools, agentState };
}
