/**
 * request_approval Tool
 *
 * Pauses planner execution until the user approves (or rejects) the plan.
 * Uses UserInteractionManager to block on a Promise.
 *
 * On approval: returns success, plan flows to MemoryManager for execution.
 * On rejection: returns rejection reason, planner can modify and resubmit.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { OrchestratorContext } from "../types.js";
import type { UserInteractionManager } from "../UserInteractionManager.js";
import { PromptLoader } from "../PromptLoader.js";

export const RequestApprovalSchema = z.object({
  message: z
    .string()
    .optional()
    .describe("Optional message to show the user alongside the plan"),
});

export interface RequestApprovalContext {
  orchestratorContext: OrchestratorContext;
  userInteractionManager: UserInteractionManager;
}

export function createRequestApprovalTool(ctx: RequestApprovalContext) {
  const { orchestratorContext: octx, userInteractionManager: uim } = ctx;

  return tool(
    async (input) => {
      const plan = octx.getPendingPlan();
      if (!plan) {
        return "Error: No pending plan to approve. Call submit_plan first.";
      }

      // Ask user for approval via UserInteractionManager
      const response = await uim.askQuestion({
        from: "planner",
        sourceId: octx.teamId,
        question: input.message || `Plan with ${(plan as any).tasks?.length || 0} tasks is ready for your review. Approve or reject?`,
        options: [
          { label: "Approve", description: "Start executing the plan" },
          { label: "Reject", description: "Reject and provide feedback" },
        ],
        category: "approval",
      });

      const answer = response.answer.toLowerCase();
      const isApproved = answer.includes("approve") || response.selectedOptionIndex === 0;

      if (isApproved) {
        return "Plan approved by user. Execution will begin.";
      } else {
        // Plan rejected — return the reason to planner
        return `Plan rejected by user. Feedback: ${response.answer}. Consider revising the plan based on this feedback and resubmitting.`;
      }
    },
    {
      name: "request_approval",
      description: PromptLoader.loadTemplate("tools", "request_approval"),
      schema: RequestApprovalSchema,
    },
  );
}
