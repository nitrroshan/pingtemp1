/**
 * Complete Task Tool
 * 
 * Allows agents to signal task completion.
 * This is the proper way for agents to mark their work as done.
 * 
 * In auto mode: Agent calls this when it has finished the task
 * In interactive mode: User manually completes via UI (this tool is optional)
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { EventEmitter } from "events";

/**
 * Schema for task completion
 */
export const CompleteTaskSchema = z.object({
  summary: z.string().describe("Summary of what was accomplished"),
  deliverables: z.array(z.string()).optional().describe("List of deliverables or outputs produced"),
  nextSteps: z.array(z.string()).optional().describe("Recommended next steps for the user"),
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

/**
 * Create a complete_task tool that signals task completion
 * 
 * @param taskId - The task ID this tool is bound to
 * @param role - The agent role
 * @param events - EventEmitter to emit completion events
 */
export function createCompleteTaskTool(
  taskId: string,
  role: string,
  events: EventEmitter
) {
  return tool(
    async (input: CompleteTaskInput) => {
      // Emit event for OrchestratorService/AgentManager to handle
      events.emit("task:agent-complete", {
        taskId,
        role,
        summary: input.summary,
        deliverables: input.deliverables || [],
        nextSteps: input.nextSteps || [],
        timestamp: Date.now(),
      });

      // Return confirmation to the agent
      return `Task marked complete. Summary: ${input.summary}`;
    },
    {
      name: "complete_task",
      description: `Mark the current task as complete. Call this ONLY when:
- You have fully accomplished the task objectives
- All deliverables are ready
- No further work is needed from you on this task

Do NOT call this if:
- You need more information from the user
- The task is partially done
- You're waiting for user feedback`,
      schema: CompleteTaskSchema,
    }
  );
}
