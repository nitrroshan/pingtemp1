/**
 * get_status Tool
 *
 * Returns current execution status - task counts by status and per-task details.
 * Useful for the Orchestrator to monitor progress and report to users.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { OrchestratorContext } from "../types.js";
import type { TaskStatusSummary } from "../schemas.js";

/**
 * Creates the get_status tool with injected context
 */
export function createGetStatusTool(context: OrchestratorContext) {
  return tool(
    async (): Promise<TaskStatusSummary> => {
      try {
        // Get all tasks from provider (works with both MemoryManager and TaskStore)
        const allTasks = context.memoryManager.getAllTasks();

        // Count by status
        const counts = {
          ready: 0,
          pending: 0,
          inProgress: 0,
          completed: 0,
          failed: 0,
        };

        const taskSummaries = allTasks.map((task) => {
          // Determine status
          let status:
            | "ready"
            | "pending"
            | "in_progress"
            | "completed"
            | "failed" = task.status || "pending";

          // Map status variations
          if (status === "in_progress") {
            counts.inProgress++;
          } else if (status === "completed") {
            counts.completed++;
          } else if (status === "failed") {
            counts.failed++;
          } else if (status === "ready") {
            counts.ready++;
          } else {
            counts.pending++;
            status = "pending";
          }

          return {
            id: task.id,
            title: (task as any).title || (task.context as any)?.title || task.id,
            status,
            assignedRole: task.assigned_role || "unknown",
          };
        });

        return {
          total: allTasks.length,
          ready: counts.ready,
          inProgress: counts.inProgress,
          completed: counts.completed,
          failed: counts.failed,
          tasks: taskSummaries,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("[get_status] Error:", errorMessage);

        // Return empty status on error
        return {
          total: 0,
          ready: 0,
          inProgress: 0,
          completed: 0,
          failed: 0,
          tasks: [],
        };
      }
    },
    {
      name: "get_status",
      description: `Get the current execution status of all tasks.
Returns counts of tasks by status (ready, in_progress, completed, failed) 
and a list of all tasks with their current status.
Use this to monitor progress and report to the user.`,
      schema: z.object({}), // No input needed
    },
  );
}
