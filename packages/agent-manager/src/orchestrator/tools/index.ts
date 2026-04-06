/**
 * Orchestrator Tools Factory
 *
 * Creates all orchestrator tools with injected context.
 * Uses closure pattern for dependency injection.
 */

import type { OrchestratorContext } from "../types.js";
import { createCreatePlanTool } from "./createPlan.js";
import { createApprovePlanTool } from "./approvePlan.js";
import { createGetStatusTool } from "./getStatus.js";
import { createGetContextTool } from "./getContext.js";

/**
 * Creates all orchestrator tools with the given context
 *
 * @param context - Dependencies and state for tools
 * @returns Array of LangChain tools
 */
export function createOrchestratorTools(context: OrchestratorContext) {
  return [
    createCreatePlanTool(context),
    createApprovePlanTool(context),
    createGetStatusTool(context),
    createGetContextTool(context),
  ];
}

// Re-export individual tool creators for testing
export { createCreatePlanTool } from "./createPlan.js";
export { createApprovePlanTool } from "./approvePlan.js";
export { createGetStatusTool } from "./getStatus.js";
export { createGetContextTool } from "./getContext.js";
