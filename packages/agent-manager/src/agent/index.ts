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

// Internal agents (unified - handles both tool and structured output modes)
// Includes schemas for structured output: AgentRoleSchema, AgentConfigSchema, AgentPlanSchema
export * from "./internal/index.js";

// Note: BuilderAgent is deprecated. Use AiSdkAgent with config.responseFormat instead.
// Legacy BuilderAgent kept for reference but not exported to avoid conflicts.
