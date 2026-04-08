/**
 * Orchestrator Module
 *
 * Exports the OrchestratorService and related types/schemas.
 * Includes Planner-as-Agent components (Steps 1-10).
 */

// Main service
export { OrchestratorService } from "./OrchestratorService.js";
export type { OrchestratorServiceConfig } from "./OrchestratorService.js";

// Planner-as-Agent components
export { PlannerAgent } from "./PlannerAgent.js";
export { UserInteractionManager } from "./UserInteractionManager.js";
export { DependencyResolver } from "./DependencyResolver.js";
export { NotificationQueue } from "./NotificationQueue.js";
export type { NotificationQueueConfig } from "./NotificationQueue.js";
export { TaskStore } from "./TaskStore.js";
export type { TaskStoreCallbacks } from "./TaskStore.js";
export type { ITaskProvider } from "./ITaskProvider.js";

// Planner types
export type {
  Plan,
  PlanTask,
  TaskContext,
  TaskPatch,
  TaskPriority,
  UserQuestion,
  UserQuestionOption,
  UserChoice,
  TellUserCategory,
} from "./types/plannerTypes.js";

// Worker types
export {
  classifyError,
  type WorkerFailureReport,
  type ErrorCategory,
} from "./types/workerTypes.js";

// Legacy types
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
export { createPlannerTools } from "./tools/index.js";
export type { PlannerToolsContext } from "./tools/index.js";
