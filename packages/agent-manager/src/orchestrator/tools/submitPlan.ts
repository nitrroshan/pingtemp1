/**
 * submit_plan Tool
 *
 * Accepts a plan directly from the planner agent (no PlanBuilder intermediary).
 * Validates the DAG via DependencyResolver, stores in PlanStore, emits plan:proposed.
 *
 * This replaces createPlan.ts for PLANNER_MODE=agent.
 * The old create_plan tool is kept for PLANNER_MODE=legacy.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { OrchestratorContext } from "../types.js";
import type { DependencyResolver } from "../DependencyResolver.js";
import { toGoalId } from "../../plugin/utils.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

const TaskContextSchema = z.object({
  notes: z.string().optional(),
  files: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  relatedTasks: z.array(z.string()).optional(),
}).optional();

export const SubmitPlanSchema = z.object({
  planId: z.string().describe("Unique identifier for this plan"),
  goal: z.string().describe("The user's goal this plan addresses"),
  tasks: z.array(z.object({
    id: z.string().describe("Unique task ID (e.g., task-1, task-2)"),
    title: z.string().describe("Short task title"),
    description: z.string().describe("Detailed description of what to do"),
    assignedRole: z.string().describe("Role to execute this task (must exist in team)"),
    priority: z.number().min(1).max(5).default(3).describe("Priority (1=highest)"),
    complexity: z.enum(["low", "medium", "high"]).default("medium"),
    dependencies: z.array(z.string()).default([]).describe("Task IDs this depends on"),
    onDependencyFail: z.enum(["fail", "skip", "replan"]).default("fail"),
    expectedOutput: z.string().describe("What this task should produce"),
    context: TaskContextSchema,
  })).min(1).describe("At least one task required"),
});

// ─── Tool Factory ─────────────────────────────────────────────────────────────

export interface SubmitPlanContext {
  orchestratorContext: OrchestratorContext;
  dagResolver: DependencyResolver;
}

export function createSubmitPlanTool(ctx: SubmitPlanContext) {
  const { orchestratorContext: octx, dagResolver } = ctx;

  return tool(
    async (plan) => {
      try {
        // Validate all assigned roles exist
        for (const task of plan.tasks) {
          const lowerRole = task.assignedRole.toLowerCase();
          if (!octx.teamRoles.some((r) => r.toLowerCase() === lowerRole)) {
            return `Error: Role '${task.assignedRole}' not found. Available roles: ${octx.teamRoles.join(", ")}`;
          }
        }

        // Validate DAG via DependencyResolver
        dagResolver.buildFromTasks(plan.tasks);
        const dagError = dagResolver.validate();
        if (dagError) {
          return `Error: Invalid plan DAG — ${dagError}. Please fix dependencies and resubmit.`;
        }

        // Store plan as pending, then auto-approve to create tasks immediately.
        // In planner mode, the user has already been consulted via conversation.
        // No separate approval step needed.
        octx.setPendingPlan(plan as any);

        // Derive goalId
        const goalId = toGoalId(plan.goal || plan.planId);

        // Save plan
        if (octx.planStore) {
          await octx.planStore.savePlan(plan, { goalId, status: "pending" });
        }

        // Invoke callback for UI (shows plan in frontend)
        octx.callbacks.onPlanProposed?.({
          plan,
          teamId: octx.teamId,
          timestamp: new Date().toISOString(),
        });

        // Auto-approve: the planner has already discussed the plan with the user.
        // This creates tasks in TaskStore and starts execution.
        octx.setState("executing");

        return `Plan submitted and approved with ${plan.tasks.length} task(s). Tasks are now being dispatched to workers.`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error submitting plan: ${errorMessage}`;
      }
    },
    {
      name: "submit_plan",
      description: `Submit a task plan and start execution. The plan must have:
- Valid task IDs with no duplicate IDs  
- Dependencies that form a valid DAG (no cycles)
- Roles assigned only from the available team roles
- DEPENDENCIES ARE CRITICAL: tasks that need output from earlier tasks MUST list dependencies.
  Example: frontend depends on backend API, testing depends on implementation, deployment depends on everything.
  Only tasks with zero dependencies will run first. Others wait for their dependencies to complete.
Plan is auto-approved and tasks begin executing immediately.`,
      schema: SubmitPlanSchema,
    },
  );
}
