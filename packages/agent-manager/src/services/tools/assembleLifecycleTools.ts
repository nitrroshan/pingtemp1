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

// ── Public types ────────────────────────────────────────────────────────────

export interface LifecycleToolCallbacks {
  onStatusUpdate?: (data: { taskId: string; role: string; status: string; summary: string; progress?: number; timestamp: number }) => void;
  onAgentComplete?: (data: { taskId: string; role: string; summary: string; deliverables: string[]; nextSteps: string[]; timestamp: number }) => void;
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
}

export interface AssembleLifecycleToolsParams {
  taskId: string;
  roleKey: string;
  callbacks: LifecycleToolCallbacks;
  taskServices: TaskServices;
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
  const { taskId, roleKey, callbacks, taskServices } = params;
  const tools: any[] = [];

  // Shared state between lifecycle tools — enables blocked guard
  const agentState: AgentState = { lastStatus: "in_progress" };

  // report_status
  tools.push(
    createReportStatusTool(taskId, roleKey, (data) => {
      agentState.lastStatus = data.status;
      callbacks.onStatusUpdate?.(data);
    }),
  );

  // complete_task (uses agentState for blocked guard)
  tools.push(
    createCompleteTaskTool(
      taskId,
      roleKey,
      (data) => callbacks.onAgentComplete?.(data),
      agentState,
    ),
  );

  // request_task + bounce_task (only when task services are available)
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
        onTaskCreated: (data) => callbacks.onTaskCreated?.(data),
      }),
    );

    tools.push(
      createBounceTaskTool({
        taskId,
        role: roleKey,
        availableRoles: taskServices.teamRoles,
        taskStore: taskServices.taskStore,
        crdtTaskSync: taskServices.crdtTaskSync,
        onBounce: (data) => callbacks.onBounce?.(data),
      }),
    );
  }

  return { tools, agentState };
}
