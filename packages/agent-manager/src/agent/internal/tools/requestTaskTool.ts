/**
 * Request Task Tool — Agent-initiated task creation
 *
 * Allows worker agents to create tasks for other roles.
 * Tasks are persisted to CRDT, registered in TaskStore, and integrated into the DAG.
 *
 * Guard rails:
 * - Max 5 agent-created tasks per agent per plan
 * - Priority ceiling at 2 (priority 1 = planner-only CRITICAL)
 * - Planner is notified of all agent-created tasks
 *
 * @see docs/features/task-orchestration/markdown-tasks/diagrams/04-agent-created-tasks.md
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { PromptLoader } from "../../../orchestrator/PromptLoader.js";
import type { AgentContext, TaskLifecycleHooks } from "../../streaming/types.js";

const MAX_AGENT_TASKS_PER_PLAN = 5;
const MAX_AGENT_PRIORITY = 2;

export const RequestTaskSchema = z.object({
  title: z.string().describe("Short title for the task"),
  description: z.string().describe("Detailed description of what needs to be done"),
  targetRole: z.string().describe("Role that should execute this task (lowercase, e.g. 'frontend-dev')"),
  type: z.enum(["work", "review", "collaboration", "subtask", "decision"])
    .default("work")
    .describe("Task type: work (default), review, collaboration, subtask, or decision"),
  priority: z.number().min(2).max(5).default(3)
    .describe("Priority 2-5 (2=high, 3=normal, 5=deferred). Priority 1 is reserved for planner."),
  relationship: z.enum(["independent", "subtask", "blocks-me"])
    .default("independent")
    .describe("independent: no dependency. subtask: child of my task. blocks-me: I can't continue until this is done."),
  context: z.object({
    reason: z.string().optional().describe("Why this task is needed"),
    files: z.array(z.string()).optional().describe("Relevant file paths"),
    artifacts: z.array(z.string()).optional().describe("Relevant artifact references"),
  }).optional().describe("Additional context for the task"),
});

export type RequestTaskInput = z.infer<typeof RequestTaskSchema>;

export interface RequestTaskContext {
  /** Current task ID of the requesting agent */
  taskId: string;
  /** Role of the requesting agent */
  role: string;
  /** Plan ID the current task belongs to */
  planId: string | null;
  /** Goal ID */
  goalId: string | null;
  /** Available team roles (for validation) */
  availableRoles: string[];
  /** TaskStore for creating the task */
  taskStore: any;
  /** DependencyResolver for DAG validation */
  dagResolver: any;
  /** CrdtTaskSync for CRDT persistence */
  crdtTaskSync: any;
  /** v3.0: Database persistence (optional) */
  taskPersistence?: { saveTasks(goalId: string, teamId: string, tasks: any[]): Promise<void>; updateTaskStatus?(taskId: string, goalId: string, status: string, output?: unknown): Promise<void> } | null;
  /** Team ID for persistence */
  teamId?: string;
  /** Callback for notifying orchestrator */
  onTaskCreated?: (data: {
    taskId: string;
    createdBy: string;
    targetRole: string;
    relationship: string;
    parentTaskId: string;
  }) => void;
  /**
   * Phase 1.6: Optional TaskLifecycleHooks. When set, the tool also calls
   * `lifecycleHooks.onSubtaskRequest(payload, lifecycleCtx)` after the typed
   * `onTaskCreated` callback fires. If the hook returns
   * `{ accepted: false, reason }`, the tool surfaces the reason as an error
   * and the previously-created task is left in place (cleanup is the
   * orchestrator's responsibility, since the task is already persisted).
   */
  lifecycleHooks?: TaskLifecycleHooks;
  /** AgentContext required when `lifecycleHooks` is set. */
  lifecycleCtx?: AgentContext;
}

/** Track agent-created task counts per agent role */
// Note: This is a runtime cache only. On restart, counts are re-derived from TaskStore
// in the guard rail check below (Fix #2).
const agentTaskCounts = new Map<string, number>();

/**
 * Create a request_task tool for worker agents.
 * Bound to a specific task + role context.
 */
export function createRequestTaskTool(ctx: RequestTaskContext) {
  return tool(
    async (input: RequestTaskInput) => {
      // ── Guard Rails ─────────────────────────────────────────────────

      // 1. Validate target role exists
      const targetLower = input.targetRole.toLowerCase();
      if (!ctx.availableRoles.some((r) => r.toLowerCase() === targetLower)) {
        return `Error: Role '${input.targetRole}' not found. Available roles: ${ctx.availableRoles.join(", ")}`;
      }

      // 2. Priority ceiling
      if (input.priority < MAX_AGENT_PRIORITY) {
        return `Error: Agent-created tasks cannot have priority higher than ${MAX_AGENT_PRIORITY}. Use priority ${MAX_AGENT_PRIORITY}-5.`;
      }

      // 3. Max tasks per agent per plan — derive from TaskStore for durability (Fix #2)
      const createdByTag = `agent:${ctx.role}`;
      const goalTasks = ctx.goalId && ctx.taskStore.getByGoal
        ? ctx.taskStore.getByGoal(ctx.goalId)
        : (ctx.taskStore.getAll ? ctx.taskStore.getAll() : []);
      const currentCount = goalTasks.filter((t: any) => (t.context as any)?.createdBy === createdByTag).length;
      if (currentCount >= MAX_AGENT_TASKS_PER_PLAN) {
        return `Error: You have already created ${currentCount} tasks (max ${MAX_AGENT_TASKS_PER_PLAN}). Maximum reached.`;
      }

      // ── Create Task ────────────────────────────────────────────────
      // The orchestrator owns ALL state mutations via the hook
      // (`lifecycleHooks.onSubtaskRequest` →
      // `GoalManagerOrchestratorAdapter.createSubtask` → `buildSubtask`).
      // The tool only validates inputs and surfaces the orchestrator's
      // ack to the LLM. Single-owner invariant (May 9 2026 — debt patch
      // #5: legacy local-mutations branch deleted along with WorkerPool's
      // legacy runTask path in patch #2).

      if (!ctx.lifecycleHooks?.onSubtaskRequest || !ctx.lifecycleCtx) {
        return `Error: request_task is missing lifecycleHooks/lifecycleCtx — programmer error.`;
      }
      const ack = await ctx.lifecycleHooks.onSubtaskRequest(
        {
          description: `${input.title}: ${input.description}`,
          title: input.title,
          assignedRole: targetLower,
          dependsOn: input.relationship === "blocks-me" ? [ctx.taskId] : undefined,
          priority: input.priority,
          type: input.type,
          relationship: input.relationship,
          parentTaskId: ctx.taskId,
          goalId: ctx.goalId ?? undefined,
          planId: ctx.planId ?? undefined,
          context: input.context
            ? {
                reason: input.context.reason,
                files: input.context.files,
                artifacts: input.context.artifacts,
              }
            : undefined,
        },
        ctx.lifecycleCtx,
      );
      if (ack && ack.accepted === false) {
        return `ERROR: Orchestrator rejected new task: ${ack.reason ?? "no reason given"}`;
      }
      const finalId = ack?.newTaskId ?? "unknown";

      // Update runtime cache (secondary — TaskStore.getAll() is primary
      // for the per-agent guard rail check at the top of this tool).
      const cacheKey = `${ctx.role}:${ctx.planId}`;
      agentTaskCounts.set(cacheKey, currentCount + 1);

      const relationshipNote = input.relationship === "blocks-me"
        ? ` Your current task (${ctx.taskId}) is now blocked until ${finalId} completes.`
        : input.relationship === "subtask"
        ? ` Created as subtask of ${ctx.taskId}.`
        : "";

      return `Task created: ${finalId} — "${input.title}" assigned to ${targetLower} (priority ${input.priority}).${relationshipNote}`;
    },
    {
      name: "request_task",
      description: PromptLoader.loadTemplate("tools", "request_task", {
        maxTasks: String(MAX_AGENT_TASKS_PER_PLAN),
      }),
      schema: RequestTaskSchema,
    },
  );
}
