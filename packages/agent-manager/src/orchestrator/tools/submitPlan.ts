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
import { PromptLoader } from "../PromptLoader.js";

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
  repoUrl: z.string()
    .refine(
      url => /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)\//.test(url),
      "Only HTTPS URLs from GitHub, GitLab, Bitbucket, or Azure DevOps are allowed",
    )
    .describe("Git repo URL (HTTPS). The workspace for all tasks in this plan. Use the repo URL provided in the goal context."),
  repoBranch: z.string().default("main").describe("Base branch to clone from (default: main)"),
  tasks: z.array(z.object({
    id: z.string().describe("Unique task ID (e.g., task-1, task-2)"),
    title: z.string().describe("Short task title"),
    description: z.string().describe("Detailed description of what to do"),
    assignedRole: z.string().describe("Role to execute this task (must exist in team)"),
    priority: z.number().min(1).max(5).default(3).describe("Priority (1=highest)"),
    complexity: z.enum(["low", "medium", "high"]).default("medium"),
    dependencies: z.array(z.string()).default([]).describe("Task IDs this depends on"),
    onDependencyFail: z.enum(["fail", "skip", "replan"]).default("fail"),
    type: z.enum(["work", "discussion", "review", "research"]).default("work").describe("Task type: work (default), discussion (cross-role alignment), review, research"),
    expectedOutput: z.string().describe("What this task should produce"),
    references: z.array(z.string()).optional().describe("Cross-plan task references: ['plan-001/task-003']. Agents get prior outputs as context."),
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
        // Block submit_plan during research phase
        const state = octx.getState();
        if (state === "researching") {
          return "Error: Cannot submit plan while research tasks are still running. Wait for research to complete, or ask the user to skip research.";
        }

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

        // Store plan as pending on the correct goal context.
        // goalId is always set — planner was created with it via createPlanner(goalId)
        const goalId = octx.currentGoalId;
        if (!goalId) {
          return "Error: No goalId set — this is a bug. The planner should always have a goalId.";
        }

        octx.setPendingPlan(plan as any, goalId);

        // Save plan
        if (octx.planStore) {
          await octx.planStore.savePlan(plan, { goalId, status: "pending" });
        }

        // Invoke callback for UI (shows plan in frontend)
        octx.callbacks.onPlanProposed?.({
          plan,
          teamId: octx.teamId,
          goalId,
          timestamp: new Date().toISOString(),
        });

        // Set to awaiting_approval — user must review and approve
        octx.setState("awaiting_approval");

        return `Plan submitted with ${plan.tasks.length} task(s). Awaiting user approval. The user will review your plan document and approve or request changes.`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error submitting plan: ${errorMessage}`;
      }
    },
    {
      name: "submit_plan",
      description: PromptLoader.loadTemplate("tools", "submit_plan"),
      schema: SubmitPlanSchema,
    },
  );
}
