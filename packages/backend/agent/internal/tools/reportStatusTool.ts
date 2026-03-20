/**
 * Report Status Tool
 * 
 * Allows agents to signal their progress to the user.
 * Emits task:status events for UI updates.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { EventEmitter } from "events";

/**
 * Status values that agents can report
 */
export const TaskStatusSchema = z.object({
  status: z.enum([
    "in_progress",
    "need_clarification", 
    "ready_for_review",
    "blocked",
  ]).describe("Current task status"),
  summary: z.string().describe("Brief summary of progress or what you need"),
  progress: z.number().min(0).max(100).optional().describe("Optional progress percentage"),
});

export type TaskStatusInput = z.infer<typeof TaskStatusSchema>;

/**
 * Create a report_status tool that emits events
 * 
 * @param taskId - The task ID this tool is bound to
 * @param role - The agent role
 * @param events - EventEmitter to emit status updates
 */
export function createReportStatusTool(
  taskId: string,
  role: string,
  events: EventEmitter
) {
  return tool(
    async (input: TaskStatusInput) => {
      // Emit event for Socket.IO to pick up
      events.emit("task:status", {
        taskId,
        role,
        status: input.status,
        summary: input.summary,
        progress: input.progress,
        timestamp: Date.now(),
      });

      // Return confirmation to the agent
      return `Status reported: ${input.status} - ${input.summary}`;
    },
    {
      name: "report_status",
      description: `Report your current task status to the user. Call this when:
- You've made progress and want to update the user
- You need clarification on requirements  
- Your work is ready for user review
- You are blocked and need help`,
      schema: TaskStatusSchema,
    }
  );
}
