/**
 * Orchestrator Module
 *
 * Exports the OrchestratorService and related types/schemas.
 */

// Main service
export { OrchestratorService } from "./OrchestratorService.js";

// Types
export type {
  OrchestratorState,
  OrchestratorContext,
  OrchestratorConfig,
  OrchestratorMessage,
  PlanProposedEvent,
  PlanApprovedEvent,
  TaskPlan,
} from "./types.js";

// Schemas
export {
  PlanRequirementsSchema,
  TaskStatusSummarySchema,
  CreatePlanResultSchema,
  ApprovePlanResultSchema,
  AgentPlanSchema,
  TaskItemSchema,
  type PlanRequirements,
  type TaskStatusSummary,
  type CreatePlanResult,
  type ApprovePlanResult,
  type AgentPlanOutput,
  type TaskItem,
} from "./schemas.js";

// Tools (for testing/extension)
export { createOrchestratorTools } from "./tools/index.js";
