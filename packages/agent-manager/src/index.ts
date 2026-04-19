/**
 * @ping/agent-manager — Core orchestration engine
 *
 * Provides the multi-agent orchestration runtime:
 * - AgentManager: top-level orchestrator (plans, assigns, coordinates)
 * - WorkerPool: manages agent workers per task
 * - OrchestratorService: LLM-powered planning with tools
 * - AiSdkAgent: AI SDK streamText agent runtime
 * - PluginRegistry: plugin-based tool/skill resolution
 * - MemoryManager: task lifecycle and DAG readiness
 */

// Core orchestrator
export { AgentManager } from "./AgentManagerV2.js";
export type { ManagerStreamCallbacks } from "./AgentManagerV2.js";

// WorkerPool
export { WorkerPool } from "./services/WorkerPool.js";
export type { WorkerCallbacks } from "./services/WorkerPool.js";

// OrchestratorService
export { OrchestratorService } from "./orchestrator/OrchestratorService.js";
export type { OrchestratorServiceConfig, CrdtProxy } from "./orchestrator/OrchestratorService.js";

export type {
  OrchestratorState,
  OrchestratorContext,
  OrchestratorConfig,
  OrchestratorMessage,
  OrchestratorCallbacks,
  PlanProposedEvent,
  PlanApprovedEvent,
  TaskPlan,
} from "./orchestrator/types.js";

// Planner-as-Agent (Phase 1)
export { PlannerAgent } from "./orchestrator/PlannerAgent.js";
export { UserInteractionManager } from "./orchestrator/UserInteractionManager.js";
export { DependencyResolver } from "./orchestrator/DependencyResolver.js";
export { NotificationQueue } from "./orchestrator/NotificationQueue.js";
export type { NotificationQueueConfig } from "./orchestrator/NotificationQueue.js";
export { TaskStore } from "./orchestrator/TaskStore.js";
export type { TaskStoreCallbacks } from "./orchestrator/TaskStore.js";
export { createPlannerTools } from "./orchestrator/tools/index.js";
export type { PlannerToolsContext } from "./orchestrator/tools/index.js";
export { classifyError } from "./orchestrator/types/workerTypes.js";
export { PromptLoader } from "./orchestrator/PromptLoader.js";
export { PromptBuilder } from "./agent/prompts/PromptBuilder.js";
export { buildWorkerPrompt } from "./agent/prompts/worker/WorkerPromptFactory.js";
export type {
  Plan,
  PlanTask,
  TaskPatch,
  UserQuestion,
  UserChoice,
} from "./orchestrator/types/plannerTypes.js";
export type {
  WorkerFailureReport,
  ErrorCategory,
} from "./orchestrator/types/workerTypes.js";

// Agent system
export { AiSdkAgent } from "./agent/internal/AiSdkAgent.js";
export { AgentFactory, getAgentFactory } from "./agent/AgentFactory.js";
export { BaseAgent } from "./agent/BaseAgent.js";
// Fix #19: Export worker tool factories and types
export {
  createReportStatusTool,
  createCompleteTaskTool,
  createRequestTaskTool,
  createBounceTaskTool,
} from "./agent/internal/tools/index.js";
export type {
  RequestTaskContext,
  RequestTaskInput,
  BounceTaskContext,
  BounceTaskInput,
} from "./agent/internal/tools/index.js";
export type {
  AgentDefinition,
  AgentEvent,
  AgentInput,
  IAgent,
  AgentType,
  AgentStatus,
  InternalConfig,
} from "./agent/types.js";

// Task types
export type { Task, TaskStatus } from "./memory/types/index.js";

// Persistence (built-in defaults)
export { FilePlanStore } from "./persistence/FilePlanStore.js";
export { FileTaskStore } from "./persistence/FileTaskStore.js";

// Plugin system
export { PluginRegistry } from "./plugin/PluginRegistry.js";
export type {
  IPlugin,
  IMcpServer,
  ISkill,
  IPluginStorage,
  IPlanStore,
  ITaskStore,
  ToolContext,
  SkillContext,
} from "./plugin/types.js";
export { toGoalId } from "./plugin/utils.js";

// RoleTaskQueue
export { RoleTaskQueue } from "./util/RoleTaskQueue.js";
export type { TaskWithContext, TaskCallbacks } from "./util/RoleTaskQueue.types.js";
