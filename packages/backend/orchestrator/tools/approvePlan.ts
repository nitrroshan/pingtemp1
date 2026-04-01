/**
 * approve_plan Tool
 *
 * Approves the pending plan and adds all tasks to MemoryManager.
 * Tasks with no dependencies become immediately ready for workers.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { OrchestratorContext } from "../types.js";
import type { ApprovePlanResult } from "../schemas.js";

/**
 * Creates the approve_plan tool with injected context
 */
export function createApprovePlanTool(context: OrchestratorContext) {
  return tool(
    async (): Promise<ApprovePlanResult> => {
      try {
        const plan = context.getPendingPlan();

        if (!plan) {
          return {
            status: "no_pending_plan",
            error: "No pending plan to approve. Create a plan first.",
          };
        }

        // Add each task to MemoryManager
        // MemoryManager handles dependency tracking internally
        let tasksQueued = 0;

        // Build dependants map (reverse of dependencies)
        const dependantsMap = new Map<string, string[]>();
        for (const task of plan.tasks) {
          for (const depId of task.dependencies) {
            const existing = dependantsMap.get(depId) || [];
            existing.push(task.id);
            dependantsMap.set(depId, existing);
          }
        }

        for (const task of plan.tasks) {
          // Convert TaskItem to MemoryManager Task format
          const memoryTask = {
            id: task.id,
            description: `${task.title}: ${task.description}`,
            assigned_role: task.assignedRole.toLowerCase(),
            status: "pending" as const,
            prerequisites: new Map<string, boolean>(
              task.dependencies.map((depId: string) => [depId, false]),
            ),
            dependants: dependantsMap.get(task.id) || [],
            context: {
              title: task.title,
              planId: plan.planId,
              goal: plan.goal,
              priority: task.priority,
              complexity: task.complexity,
              expectedOutput: task.expectedOutput,
            },
          };

          context.memoryManager.addTask(memoryTask);
          tasksQueued++;
        }

        // Clear pending plan
        context.setPendingPlan(null);

        // Update orchestrator state
        context.setState("executing");

        // Emit event for UI
        context.events.emit("plan:approved", {
          planId: plan.planId,
          teamId: context.teamId,
          tasksQueued,
          timestamp: new Date().toISOString(),
        });

        return {
          status: "execution_started",
          tasksQueued,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("[approve_plan] Error:", errorMessage);

        return {
          status: "error",
          error: `Failed to approve plan: ${errorMessage}`,
        };
      }
    },
    {
      name: "approve_plan",
      description: `Approve the pending plan and start task execution.
Call this tool after the user has reviewed and approved the proposed plan.
All tasks will be added to the queue and workers will begin executing them.`,
      schema: z.object({}), // No input needed
    },
  );
}
