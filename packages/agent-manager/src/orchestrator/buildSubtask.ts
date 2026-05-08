/**
 * Shared subtask-construction helper.
 *
 * Encapsulates the core mutations that BOTH the legacy `request_task` tool
 * branch (in `agent/internal/tools/requestTaskTool.ts`) and the new
 * `GoalManagerOrchestratorAdapter.createSubtask` perform when an agent
 * asks for a new task:
 *
 *   1. Generate a goal-scoped sequential task id (`<goal-slug>-task-N`).
 *   2. Build the task object with prerequisites / dependants / context.
 *   3. Persist via `taskStore.create()`.
 *   4. For `blocks-me`, add the new task as a prerequisite of the parent
 *      AFTER validating the resulting DAG would be acyclic; rollback
 *      `taskStore.create()` if a cycle would be introduced.
 *   5. Rebuild the DAG (per-goal when supported, otherwise team-wide).
 *
 * Design (May 9 2026 review fix #4): centralizing this here removes the
 * 80-line duplication between the two callers. When the legacy tool
 * branch is deleted (Patch #2), only the adapter still calls this helper.
 *
 * Caller-specific concerns (NOT in this helper):
 *   - per-agent task-count guard (`MAX_AGENT_TASKS_PER_PLAN`)
 *   - planner notification / dispatch (`onTaskCreated`)
 *   - return-string formatting for the LLM
 *   - lifecycle hook fan-out (legacy mode's dual orchestration owner)
 */

import { rootLogger } from "../logging.js";

const logger = rootLogger.child({ module: "buildSubtask" });

export type SubtaskRelationship = "subtask" | "blocks-me" | "independent";

export interface BuildSubtaskInput {
  /** Caller-supplied (`agent:${roleOrAgentId}`) — embedded in `context.createdBy`. */
  createdBy: string;
  /** Parent task this request originated from. */
  parentTaskId: string;
  /** Goal scope (id-prefix + scoping for ID generation). May be undefined for legacy. */
  goalId?: string;
  /** Plan scope. */
  planId?: string | null;
  /** Pre-formatted description to store on the task (e.g. `${title}: ${desc}`). */
  description: string;
  /** Optional title for the context.title field. */
  title?: string;
  /** Lowercase role that will own the new task. */
  assignedRole: string;
  /** Priority 1 (lowest) – 5 (highest). */
  priority: number;
  /** Task type tag (planning/research/implementation/etc.). */
  type?: string;
  /** Relationship to the parent task. */
  relationship: SubtaskRelationship;
  /** Optional context fields propagated to the new task. */
  context?: {
    reason?: string;
    files?: string[];
    artifacts?: string[];
  };
}

export interface BuildSubtaskServices {
  taskStore: {
    get(id: string): any;
    getByGoal?(goalId: string): any[];
    getAll?(): any[];
    create(t: any): Promise<void> | void;
    remove(id: string): boolean;
    updateStatus(id: string, status: string): Promise<void> | void;
    addPrerequisite(parentId: string, prereqId: string): Promise<void> | void;
  };
  dagResolver: {
    rebuild(source: any): void;
    rebuildForGoal?(source: any, goalId: string): void;
    validateDependencies?(taskId: string, deps: string[]): string | null;
  };
}

export type BuildSubtaskResult =
  | { accepted: true; newTaskId: string }
  | { accepted: false; reason: string };

/**
 * Core subtask construction. Both legacy `request_task` and
 * `GoalManagerOrchestratorAdapter.createSubtask` route through here.
 */
export async function buildSubtask(
  input: BuildSubtaskInput,
  services: BuildSubtaskServices,
): Promise<BuildSubtaskResult> {
  const { taskStore, dagResolver } = services;

  // 1. Generate goal-scoped sequential id.
  const goalPrefix = input.goalId ? input.goalId.slice(0, 8) : "";
  const goalTasks = input.goalId
    ? (taskStore.getByGoal?.(input.goalId) ?? [])
    : (taskStore.getAll?.() ?? []);
  const existingNums = goalTasks.map((t: any) => {
    const m = (t.id as string).match(/task-(\d+)$/);
    return m && m[1] ? parseInt(m[1], 10) : 0;
  });
  const nextNum = Math.max(0, ...existingNums) + 1;
  const newTaskId = goalPrefix ? `${goalPrefix}-task-${nextNum}` : `task-${nextNum}`;

  // 2. Build the task object. Shape mirrors what both callers were
  //    constructing inline before this helper.
  const newTask = {
    id: newTaskId,
    description: input.description,
    assigned_role: input.assignedRole,
    status: "pending" as const,
    priority: input.priority,
    goalId: input.goalId || undefined,
    planId: input.planId || undefined,
    prerequisites: new Map<string, boolean>(),
    // blocks-me reverse link: parent depends on this new task.
    dependants: input.relationship === "blocks-me" ? [input.parentTaskId] : [],
    context: {
      title: input.title,
      planId: input.planId,
      createdBy: input.createdBy,
      type: input.type,
      parentTask: input.relationship === "subtask" ? input.parentTaskId : null,
      expectedOutput: "",
      reason: input.context?.reason ?? `Created by ${input.createdBy} during task ${input.parentTaskId}`,
      files: input.context?.files ?? [],
      artifacts: input.context?.artifacts ?? [],
      relatedTasks: [input.parentTaskId],
    },
  };

  // 3. Persist via TaskStore (write-through to MongoDB + event bus).
  try {
    await taskStore.create(newTask);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`buildSubtask: taskStore.create failed (newTaskId=${newTaskId}): ${reason}`);
    return { accepted: false, reason };
  }

  // 4. blocks-me: validate cycle BEFORE persisting the prerequisite, then add it.
  if (input.relationship === "blocks-me") {
    const parent = taskStore.get(input.parentTaskId);
    if (parent) {
      const testPrereqs = new Map(parent.prerequisites as Map<string, boolean>);
      testPrereqs.set(newTaskId, false);
      const cycleErr = dagResolver.validateDependencies?.(
        input.parentTaskId,
        Array.from(testPrereqs.keys()),
      );
      if (cycleErr) {
        // Rollback the just-created task.
        try { await taskStore.updateStatus(newTaskId, "discarded"); } catch { /* best-effort */ }
        taskStore.remove(newTaskId);
        return {
          accepted: false,
          reason: `Adding this dependency would create a cycle: ${cycleErr}`,
        };
      }
      await taskStore.addPrerequisite(input.parentTaskId, newTaskId);
    }
  }

  // 5. Rebuild DAG (prefer per-goal when supported). On failure we MUST
  //    roll back the just-created task — otherwise we'd leave a pending
  //    task orphaned in the store with no planner notification + no
  //    dispatch (May 9 2026 review fix #2). Symmetric with the cycle
  //    rollback above.
  try {
    if (input.goalId && dagResolver.rebuildForGoal) {
      dagResolver.rebuildForGoal(taskStore, input.goalId);
    } else {
      dagResolver.rebuild(taskStore);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`buildSubtask: dagResolver.rebuild failed (rolling back ${newTaskId}): ${reason}`);
    try { await taskStore.updateStatus(newTaskId, "discarded"); } catch { /* best-effort */ }
    taskStore.remove(newTaskId);
    return { accepted: false, reason };
  }

  return { accepted: true, newTaskId };
}
