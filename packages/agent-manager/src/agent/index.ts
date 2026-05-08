/**
 * Agent Module - Unified agent system
 *
 * Core exports for working with agents in the system.
 *
 * AiSdkAgent is the agent class that handles:
 * - Tool mode: Workers, orchestrator (no responseFormat)
 * - Structured output mode: Builders (with responseFormat)
 */

// Core types
export * from "./types.js";

// Streaming hooks + visitor contract (Phase 1 of agent-stream-bus refactor)
// Additive: not yet wired through the existing AgentFactory or AiSdkAgent.
export {
  type AgentContext,
  type StreamingAgentContext,
  type StreamPart,
  type StreamingHooks,
  type AgentStepInfo,
  type AgentRunResult,
  type TaskLifecycleHooks,
  type TaskCompletePayload,
  type TaskCompleteAck,
  type TaskStatusPayload,
  type TaskBouncePayload,
  type SubtaskRequestPayload,
  type SubtaskRequestAck,
  type IStreamingAgent,
  type AgentRunInput,
} from "./streaming/index.js";

// Base classes
export { BaseAgent } from "./BaseAgent.js";
export { TaskList } from "./TaskList.js";

// Factory and loader
export {
  AgentFactory,
  registerAgentType,
  getAgentFactory,
  setAgentFactory,
} from "./AgentFactory.js";
export { AgentLoader } from "./AgentLoader.js";

// Runtime wiring (Phase 1.7 of agent-stream-bus refactor)
// AgentRuntimeFactory takes a freshly-loaded IStreamingAgent and wires
// onStreaming + onTaskLifecycle + lifecycle tools. Hooks is the only
// orchestration mode after Patch #5 (May 9 2026).
export * from "./runtime/index.js";

// Internal agents (unified - handles both tool and structured output modes)
// Includes schemas for structured output: AgentRoleSchema, AgentConfigSchema, AgentPlanSchema
export * from "./internal/index.js";

// Note: BuilderAgent is deprecated. Use AiSdkAgent with config.responseFormat instead.
// Legacy BuilderAgent kept for reference but not exported to avoid conflicts.
