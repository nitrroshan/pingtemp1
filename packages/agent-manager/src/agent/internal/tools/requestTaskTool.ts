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
  /** Callback for notifying orchestrator */
  onTaskCreated?: (data: {
    taskId: string;
    createdBy: string;
    targetRole: string;
    relationship: string;
    parentTaskId: string;
  }) => void;
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
      const currentCount = ctx.taskStore.getAll
        ? ctx.taskStore.getAll().filter((t: any) => (t.context as any)?.createdBy === createdByTag).length
        : (agentTaskCounts.get(`${ctx.role}:${ctx.planId || "default"}`) || 0);
      if (currentCount >= MAX_AGENT_TASKS_PER_PLAN) {
        return `Error: You have already created ${currentCount} tasks (max ${MAX_AGENT_TASKS_PER_PLAN}). Maximum reached.`;
      }

      // ── Create Task ────────────────────────────────────────────────

      // R6-5 FIX: Use sequential task IDs consistent with planner (task-N format)
      const existingNums = ctx.taskStore.getAll
        ? ctx.taskStore.getAll().map((t: any) => {
            const m = t.id.match(/^task-(\d+)$/);
            return m ? parseInt(m[1], 10) : 0;
          })
        : [0];
      const newTaskId = `task-${Math.max(0, ...existingNums) + 1}`;

      // Build the Task object
      const dependencies: string[] = [];
      if (input.relationship === "subtask" || input.relationship === "blocks-me") {
        // The new task doesn't depend on the current task for subtask/blocks-me
        // (the dependency goes the other direction for blocks-me)
      }

      const newTask = {
        id: newTaskId,
        description: `${input.title}: ${input.description}`,
        assigned_role: targetLower,
        status: "pending" as const,
        priority: input.priority,
        prerequisites: new Map<string, boolean>(
          dependencies.map((d) => [d, false] as [string, boolean]),
        ),
        // Fix #10: Set dependants for blocks-me (reverse link)
        dependants: input.relationship === "blocks-me" ? [ctx.taskId] : [] as string[],
        context: {
          title: input.title,
          planId: ctx.planId,
          createdBy: `agent:${ctx.role}`,
          type: input.type,
          parentTask: input.relationship === "subtask" ? ctx.taskId : null,
          expectedOutput: "",
          reason: input.context?.reason || `Created by ${ctx.role} during task ${ctx.taskId}`,
          files: input.context?.files || [],
          artifacts: input.context?.artifacts || [],
          relatedTasks: [ctx.taskId],
        },
      };

      // Register in TaskStore
      try {
        ctx.taskStore.create(newTask);
      } catch (err: any) {
        return `Error creating task: ${err.message}`;
      }

      // Handle "blocks-me" relationship — add new task as prerequisite to current task
      if (input.relationship === "blocks-me") {
        const currentTask = ctx.taskStore.get(ctx.taskId);
        if (currentTask) {
          currentTask.prerequisites.set(newTaskId, false);
          // Validate no cycle
          const cycleErr = ctx.dagResolver.validateDependencies?.(
            ctx.taskId,
            Array.from(currentTask.prerequisites.keys()),
          );
          if (cycleErr) {
            // Rollback
            currentTask.prerequisites.delete(newTaskId);
            ctx.taskStore.remove(newTaskId);
            return `Error: Adding this dependency would create a cycle: ${cycleErr}`;
          }
        }
      }

      // Rebuild DAG
      try {
        ctx.dagResolver.rebuild(ctx.taskStore);
      } catch (err: any) {
        return `Error rebuilding DAG: ${err.message}`;
      }

      // Persist to CRDT
      if (ctx.crdtTaskSync) {
        try {
          await ctx.crdtTaskSync.persistTask(newTask);
          await ctx.crdtTaskSync.updateIndex(ctx.taskStore.getAll());
        } catch (err: any) {
          // Non-fatal — task is in TaskStore, CRDT will sync later
        }
      }

      // Update runtime cache (secondary — TaskStore.getAll() is primary for guard rail check)
      const cacheKey = `${ctx.role}:${ctx.planId || "default"}`;
      agentTaskCounts.set(cacheKey, currentCount + 1);

      // Notify orchestrator
      ctx.onTaskCreated?.({
        taskId: newTaskId,
        createdBy: `agent:${ctx.role}`,
        targetRole: targetLower,
        relationship: input.relationship,
        parentTaskId: ctx.taskId,
      });

      const relationshipNote = input.relationship === "blocks-me"
        ? ` Your current task (${ctx.taskId}) is now blocked until ${newTaskId} completes.`
        : input.relationship === "subtask"
        ? ` Created as subtask of ${ctx.taskId}.`
        : "";

      return `Task created: ${newTaskId} — "${input.title}" assigned to ${targetLower} (priority ${input.priority}).${relationshipNote}`;
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
