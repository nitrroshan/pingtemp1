/**
 * Bounce Task Tool — Quick task reassignment for workers
 *
 * When an agent discovers it lacks the expertise for a task,
 * it bounces the task back with a reason and optional suggested role.
 * Simpler interface than the planner's reassign_task tool.
 *
 * @see docs/features/task-orchestration/markdown-tasks/feature_architecture.md
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { PromptLoader } from "../../../orchestrator/PromptLoader.js";

export const BounceTaskSchema = z.object({
  reason: z.string().describe("Why you can't complete this task"),
  suggestedRole: z.string().optional().describe("Suggested role that should handle this task (optional)"),
});

export type BounceTaskInput = z.infer<typeof BounceTaskSchema>;

export interface BounceTaskContext {
  /** Current task ID */
  taskId: string;
  /** Current agent role */
  role: string;
  /** Available team roles */
  availableRoles: string[];
  /** TaskStore reference */
  taskStore: any;
  /** CrdtTaskSync for CRDT persistence */
  crdtTaskSync: any;
  /** Callback for notifying orchestrator */
  onBounce?: (data: {
    taskId: string;
    role: string;
    reason: string;
    suggestedRole?: string;
    timestamp: number;
  }) => void;
}

/**
 * Create a bounce_task tool for worker agents.
 * Agent declares "I can't do this" — task goes back to queue for reassignment.
 */
export function createBounceTaskTool(ctx: BounceTaskContext) {
  return tool(
    async (input: BounceTaskInput) => {
      // Validate suggested role if provided
      if (input.suggestedRole) {
        const suggestedLower = input.suggestedRole.toLowerCase();
        if (!ctx.availableRoles.some((r) => r.toLowerCase() === suggestedLower)) {
          return `Warning: Suggested role '${input.suggestedRole}' not found. Available: ${ctx.availableRoles.join(", ")}. Task bounced anyway.`;
        }
      }

      const task = ctx.taskStore.get(ctx.taskId);
      if (!task) {
        return `Error: Task ${ctx.taskId} not found.`;
      }

      // Fix #9: Validate task status before bouncing
      if (task.status === "completed") {
        return `Error: Cannot bounce a completed task.`;
      }
      if (task.status === "failed") {
        return `Error: Task is already failed.`;
      }
      if (task.status !== "in_progress") {
        return `Warning: Task is in state "${task.status}", not "in_progress". Cannot bounce.`;
      }

      // Update task status back to failed (allows retry as ready)
      try {
        await ctx.taskStore.updateStatus(ctx.taskId, "failed");
      } catch {
        // May already be in a terminal state
      }

      // Sync to CRDT
      if (ctx.crdtTaskSync) {
        try {
          await ctx.crdtTaskSync.syncStatus(ctx.taskId, "failed", {
            bounced: true,
            bouncedBy: ctx.role,
            reason: input.reason,
            suggestedRole: input.suggestedRole,
          });
        } catch {
          // Non-fatal
        }
      }

      // Notify orchestrator (planner will see this and can reassign)
      await ctx.onBounce?.({
        taskId: ctx.taskId,
        role: ctx.role,
        reason: input.reason,
        suggestedRole: input.suggestedRole,
        timestamp: Date.now(),
      });

      const suggestion = input.suggestedRole
        ? ` Suggested reassignment to: ${input.suggestedRole}.`
        : "";
      return `Task ${ctx.taskId} bounced. Reason: ${input.reason}.${suggestion} The planner will reassign it.`;
    },
    {
      name: "bounce_task",
      description: PromptLoader.loadTemplate("tools", "bounce_task"),
      schema: BounceTaskSchema,
    },
  );
}
