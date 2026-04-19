/**
 * submit_research Tool — Pre-Plan Research Phase
 *
 * Allows the planner to create research tasks BEFORE submitting a plan.
 * Research tasks run via the normal task pipeline, but the planner can't
 * call submit_plan until all research tasks complete or are cancelled.
 *
 * Flow: idle → researching → (tasks complete) → planning → submit_plan → executing
 *
 * @see docs/features/task-orchestration/markdown-tasks/feature_architecture.md
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { OrchestratorContext } from "../types.js";
import type { DependencyResolver } from "../DependencyResolver.js";
import { PromptLoader } from "../PromptLoader.js";

const ResearchTaskSchema = z.object({
  id: z.string().describe("Unique research task ID (e.g., pre-001)"),
  title: z.string().describe("Short title for the research task"),
  description: z.string().describe("What to investigate"),
  assignedRole: z.string().describe("Role that should execute (e.g., researcher)"),
  expectedOutput: z.string().describe("What the research should produce"),
});

export const SubmitResearchSchema = z.object({
  tasks: z.array(ResearchTaskSchema).min(1)
    .describe("Research tasks to execute before planning"),
  reason: z.string()
    .describe("Why research is needed before planning (shown to user)"),
});

export type SubmitResearchInput = z.infer<typeof SubmitResearchSchema>;

export interface SubmitResearchContext {
  orchestratorContext: OrchestratorContext;
  dagResolver: DependencyResolver;
}

export function createSubmitResearchTool(ctx: SubmitResearchContext) {
  const { orchestratorContext: octx } = ctx;

  return tool(
    async (input: SubmitResearchInput) => {
      // Guard: can only submit research from idle or gathering state
      const state = octx.getState();
      if (state === "executing") {
        return "Error: Cannot submit research while tasks are executing. Use add_tasks instead.";
      }
      if (state === "researching") {
        return "Error: Research already in progress. Wait for current research to complete, or cancel pending tasks.";
      }

      // Validate roles exist
      for (const task of input.tasks) {
        const lowerRole = task.assignedRole.toLowerCase();
        if (!octx.teamRoles.some((r) => r.toLowerCase() === lowerRole)) {
          return `Error: Role '${task.assignedRole}' not found. Available: ${octx.teamRoles.join(", ")}`;
        }
      }

      // R2-#3 FIX: Use consistent method name (.create matches approvePlan pattern)
      // TaskStore may not have .addTask() — it uses .create()
      const taskStore = octx.taskProvider as any;
      const createdTasks: any[] = [];
      for (const task of input.tasks) {
        const createFn = taskStore.create || taskStore.addTask;
        if (!createFn) {
          return `Error: TaskStore does not support task creation. Internal error.`;
        }
        const taskObj = {
          id: task.id,
          description: `[Research] ${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending",
          priority: 1, // Research tasks are high priority — they block planning
          prerequisites: new Map<string, boolean>(),
          dependants: [],
          context: {
            title: task.title,
            type: "research",
            createdBy: "planner",
            planId: null,
            phase: "pre-plan",
            expectedOutput: task.expectedOutput,
          },
        };
        createFn.call(taskStore, taskObj);
        createdTasks.push(taskObj);
      }

      // Final-review fix #3: Persist research tasks to CRDT + rebuild DAG
      // This makes research tasks visible to agents via collab tool
      try {
        // Get CRDT stores via orchestrator context (if available)
        const crdtSync = (octx as any).crdtTaskSync?.get?.();
        if (crdtSync) {
          for (const task of createdTasks) {
            await crdtSync.persistTask(task);
          }
          await crdtSync.updateIndex(taskStore.getAll ? taskStore.getAll() : []);
        }
      } catch (err) {
        // Non-fatal — tasks exist in TaskStore even if CRDT fails
      }

      // Rebuild DAG to validate research tasks
      try {
        ctx.dagResolver.rebuild(taskStore);
      } catch (err) {
        // Non-fatal for research tasks (no dependencies)
      }

      // Transition to researching state
      octx.setState("researching");

      // Notify frontend
      octx.callbacks.onPlanProposed?.({
        plan: {
          planId: "research-phase",
          goal: input.reason,
          tasks: input.tasks,
        },
        teamId: octx.teamId,
        timestamp: new Date().toISOString(),
      } as any);  // phase: research is an extension — cast for now

      return `Research phase started with ${input.tasks.length} task(s): ${input.tasks.map(t => t.id).join(", ")}. ` +
        `Reason: ${input.reason}. ` +
        `I'll wait for research to complete before creating the plan. ` +
        `You can still chat with the user while research runs.`;
    },
    {
      name: "submit_research",
      description: PromptLoader.loadTemplate("tools", "submit_research"),
      schema: SubmitResearchSchema,
    },
  );
}
