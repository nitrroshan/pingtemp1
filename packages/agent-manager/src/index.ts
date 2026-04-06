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

// Agent system
export { AiSdkAgent } from "./agent/internal/AiSdkAgent.js";
export { AgentFactory, getAgentFactory } from "./agent/AgentFactory.js";
export { BaseAgent } from "./agent/BaseAgent.js";
export type {
  AgentDefinition,
  AgentEvent,
  AgentInput,
  IAgent,
  AgentType,
  AgentStatus,
  InternalConfig,
} from "./agent/types.js";

// MemoryManager
export { MemoryManager } from "./memory/MemoryManager.js";
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
