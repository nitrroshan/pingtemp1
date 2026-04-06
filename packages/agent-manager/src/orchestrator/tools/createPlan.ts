/**
 * create_plan Tool
 *
 * Invokes PlanBuilder agent to create a structured task plan.
 * Stores the plan in OrchestratorService.pendingPlan for approval.
 * Emits 'plan:proposed' event for UI display.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { OrchestratorContext } from "../types.js";
import { toGoalId } from "../../plugin/utils.js";
import { PlanRequirementsSchema, type CreatePlanResult } from "../schemas.js";

/**
 * Creates the create_plan tool with injected context
 */
export function createCreatePlanTool(context: OrchestratorContext) {
  return tool(
    async (requirements): Promise<CreatePlanResult> => {
      try {
        // Build the prompt for PlanBuilder
        const planPrompt = `
Goal: ${requirements.goal}

Context: ${requirements.context}

Constraints:
${requirements.constraints.length > 0 ? requirements.constraints.map((c) => `- ${c}`).join("\n") : "- None specified"}

Available Roles: ${requirements.roles.join(", ")}

Create a detailed task plan to accomplish this goal. Break it down into specific, executable tasks with proper dependencies.
        `.trim();

        // Invoke PlanBuilder agent (returns raw text — structured JSON from plan-builder)
        const result = await context.planBuilder.invoke({
          messages: [{ role: "user", content: planPrompt }],
        });

        // Parse the plan from the response (executeAgent returns text, not parsed object)
        let plan: any;
        if (typeof result === "string") {
          try {
            plan = JSON.parse(result);
          } catch {
            // Try extracting JSON from markdown code fence
            const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch && jsonMatch[1]) {
              plan = JSON.parse(jsonMatch[1].trim());
            } else {
              throw new Error(`PlanBuilder returned non-JSON: ${result.slice(0, 200)}`);
            }
          }
        } else {
          plan = result?.structuredResponse || result;
        }

        // Store pending plan in orchestrator service
        context.setPendingPlan(plan);

        // Derive goalId from goal text
        const goalId = toGoalId(requirements.goal || plan.planId || "unknown");

        // Save plan with pending status (goalId-scoped)
        await context.planStore.savePlan(plan, {
          goalId,
          status: "pending",
        });

        // Update state to awaiting approval
        context.setState("awaiting_approval");

        // Invoke callback for UI
        context.callbacks.onPlanProposed?.({
          plan,
          teamId: context.teamId,
          timestamp: new Date().toISOString(),
        });

        return {
          status: "awaiting_approval",
          taskCount: plan.tasks?.length || 0,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("[create_plan] Error:", errorMessage);

        return {
          status: "error",
          error: `Failed to create plan: ${errorMessage}`,
        };
      }
    },
    {
      name: "create_plan",
      description: `Create a task plan when you have gathered enough information from the user. 
Call this tool after understanding the user's goal, constraints, and preferences.
The plan will be shown to the user for approval before execution begins.`,
      schema: PlanRequirementsSchema,
    },
  );
}
