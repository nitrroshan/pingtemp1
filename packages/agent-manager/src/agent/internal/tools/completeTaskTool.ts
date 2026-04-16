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
import { PromptLoader } from "../../../orchestrator/PromptLoader.js";

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
 * @param onComplete - Callback invoked on task completion
 * @param agentState - Shared state with report_status for blocked guard
 */
export function createCompleteTaskTool(
  taskId: string,
  role: string,
  onComplete?: (data: { taskId: string; role: string; summary: string; deliverables: string[]; nextSteps: string[]; timestamp: number }) => void,
  agentState?: { lastStatus: string },
) {
  return tool(
    async (input: CompleteTaskInput) => {
      // Blocked guard: reject completion if agent reported "blocked"
      if (agentState?.lastStatus === "blocked") {
        return `ERROR: Cannot complete task — you reported status "blocked". You must either:
1. Use bounce_task() to return this task to the planner
2. Use request_task() to create a task for the role that can unblock you
3. Call report_status({ status: "in_progress" }) if you resolved the blocker

Do NOT fabricate output when blocked.`;
      }

      onComplete?.({
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
      description: PromptLoader.loadTemplate("tools", "complete_task"),
      schema: CompleteTaskSchema,
    }
  );
}
