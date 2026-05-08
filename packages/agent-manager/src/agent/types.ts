/**
 * Agent Type Definitions
 *
 * Core interfaces and types for the unified Agent system.
 * All agent implementations must conform to IAgent interface.
 *
 * Architecture Decision (Jan 21, 2026):
 * - Removed 'builder' type - merged into 'internal' with responseFormat
 * - AiSdkAgent handles both tools (workers) and structured output (builders)
 */

import { EventEmitter } from "events";

// =============================================================================
// Agent Types
// =============================================================================

/**
 * AgentType discriminator - determines how an agent executes
 *
 * - 'internal': LangChain-based agents (tools or structured output via responseFormat)
 * - 'external': External API agents (user's own endpoints)
 * - 'agentic-ui': UI automation agents (browser, electron, native)
 *
 * NOTE: 'builder' type was removed. Builders are now 'internal' with config.responseFormat.
 */
export type AgentType = "internal" | "external" | "agentic-ui";

/**
 * Agent execution status
 */
export type AgentStatus =
  | "idle"
  | "executing"
  | "waiting"
  | "stopped"
  | "error";

/**
 * Task status within an agent's task list
 */
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

// =============================================================================
// Task Management
// =============================================================================

/**
 * A task assigned to an agent
 */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: number;

  // Assignment
  assignedAt: Date;
  assignedBy: string;

  // Dependencies - tasks that must complete before this one
  dependencies: string[];
  blockedBy?: string[]; // Runtime: IDs of tasks currently blocking this one
  dependencyType?: "all" | "any"; // 'all' = all deps must complete, 'any' = any one is enough

  // Failure handling
  onDependencyFail?: "skip" | "fail" | "replan"; // What to do if a dependency fails

  // Execution
  startedAt?: Date;
  completedAt?: Date;
  output?: any;
  error?: string;

  // Context
  context?: {
    files?: string[];
    artifacts?: string[];
    relatedTasks?: string[];
  };
}

/**
 * Task list interface - every agent has one
 */
export interface ITaskList {
  // Query
  all(): Task[];
  pending(): Task[];
  inProgress(): Task[];
  completed(): Task[];
  failed(): Task[];
  getById(id: string): Task | undefined;

  // Mutations
  add(task: Task): void;
  addBatch(tasks: Task[]): void;
  start(taskId: string): void;
  complete(taskId: string, output: any): void;
  fail(taskId: string, error: string): void;

  // Dependency Resolution
  getReady(): Task[];
  getBlocked(): Task[];
  hasCircularDependency(taskId: string): boolean;
  getTopologicalOrder(): Task[];
  getDependencyGraph(): Map<string, string[]>;

  // Events
  on(
    event:
      | "task:added"
      | "task:started"
      | "task:completed"
      | "task:failed"
      | "task:skipped"
      | "task:replan-needed"
      | "task:circular-detected",
    handler: (data: any) => void,
  ): void;
  off(event: string, handler: Function): void;
}

// =============================================================================
// Agent Input/Output
// =============================================================================

/**
 * Input to agent execution
 */
export interface AgentInput {
  message: string;
  threadId: string;
  taskId?: string;

  context?: {
    files?: FileReference[];
    artifacts?: ArtifactReference[];
    teamId?: string;
  };
}

export interface FileReference {
  path: string;
  content?: string;
}

export interface ArtifactReference {
  id: string;
  type: string;
  version?: number;
}

/**
 * Events emitted during agent execution
 */
export type AgentEvent =
  // Thinking/planning
  | { type: "thinking"; content: string }
  | { type: "planning"; steps: string[] }

  // Tool execution
  | { type: "tool_start"; tool: string; args: Record<string, any> }
  | { type: "tool_result"; tool: string; result: any; error?: string }

  // Messages
  | { type: "message"; content: string; streaming?: boolean }
  | { type: "message_delta"; delta: string }

  // Artifacts
  | { type: "artifact"; artifact: any }

  // AgenticUI specific
  | { type: "frame"; frame: AgenticFrame }
  | { type: "hotspots"; hotspots: Hotspot[] }

  // Stream protocol — raw stream part for direct forwarding to frontend
  | { type: "stream_part"; part: any }

  // Lifecycle
  | { type: "error"; error: string; recoverable: boolean }
  | { type: "done"; output?: any; summary?: string };

// =============================================================================
// AgenticUI Types
// =============================================================================

export interface AgenticFrame {
  image: string;
  imageType: "full" | "delta";
  hotspots: Hotspot[];
  appState: {
    type: string;
    url?: string;
    title?: string;
  };
  timestamp: number;
  frameId: string;
}

export interface Hotspot {
  id: string;
  type: "click" | "input" | "drag" | "scroll" | "hover";
  bounds: { x: number; y: number; width: number; height: number };
  label?: string;
  cursorStyle?: "pointer" | "text" | "grab" | "default";
  highlight?: boolean;
  action?: string;
}

// =============================================================================
// Agent Definition (YAML/JSON schema)
// =============================================================================

/**
 * Declarative agent definition - can be loaded from YAML
 */
export interface AgentDefinition {
  // Identity
  id: string;
  name: string;
  role: string;
  description?: string;

  // Type discriminator
  type: AgentType;

  // Goal and behavior
  goal: string;
  systemPrompt?: string;

  // Type-specific configuration
  // NOTE: BuilderConfig is deprecated, use InternalConfig with responseFormat
  config: InternalConfig | ExternalConfig | AgenticUIConfig;

  // Common settings
  settings?: AgentSettings;
}

export interface AgentSettings {
  streaming?: boolean;
  timeout?: number;
  retries?: number;
}

// =============================================================================
// Type-Specific Configs
// =============================================================================

/**
 * Configuration for internal (LangChain-based) agents.
 *
 * - Worker agents: use tools[] for capabilities
 * - Builder agents: use responseFormat for structured output (replaces BuilderConfig)
 */
export interface InternalConfig {
  model: ModelConfig;

  // Worker agent capabilities
  tools?: ToolConfig[];
  skills?: string[];
  memory?: MemoryConfig;

  // Builder agent structured output (replaces BuilderConfig)
  // When set, agent uses providerStrategy(schema) for structured responses
  responseFormat?: string; // Schema name: 'AgentRoleSchema' | 'AgentConfigSchema' | 'AgentPlanSchema' | etc.

  // Agentic loop config
  /** Max tool-use steps per turn. 0 = unlimited (autonomous mode). Default: 0 */
  maxSteps?: number;
  /** Token budget safety cap. Stops execution if cumulative tokens exceed this. Default: 500000 */
  maxTotalTokens?: number;
  /** Enable extended thinking/reasoning. Works across providers:
   *  - Anthropic: thinking tokens with budgetTokens
   *  - OpenAI/Azure: reasoningEffort (low/medium/high) for o-series models */
  thinking?: { enabled: boolean; budgetTokens?: number; reasoningEffort?: "low" | "medium" | "high" };
}

export interface ExternalConfig {
  endpoint: string;
  healthEndpoint?: string;
  auth?: AuthConfig;
  timeout?: number;
  retries?: number;
}

export interface AgenticUIConfig {
  appType: "browser" | "electron" | "native";
  appUrl?: string;
  executable?: string;
  hotspotDetection: "dom" | "vision" | "hybrid";
}

/**
 * @deprecated Use InternalConfig with responseFormat instead
 * Kept for backward compatibility during migration
 */
export interface BuilderConfig {
  builderType: "role" | "config" | "plan";
  outputSchema: string; // Schema name reference
  model: ModelConfig;
}

export interface ModelConfig {
  provider:
    | "anthropic"
    | "openai"
    | "azure-openai"
    | "ollama"
    | "google"
    | "groq"
    | "mistral"
    | "deepseek"
    | "xai"
    | "openai-compatible"; // Any OpenAI-compatible API (LM Studio, vLLM, etc.)
  model?: string;
  deployment?: string; // Azure-specific
  baseUrl?: string; // Custom endpoint (Ollama, OpenAI-compatible, self-hosted)
  temperature?: number;
  maxTokens?: number;
}

export interface ToolConfig {
  name: string;
  type: "builtin" | "mcp" | "custom";
  config?: Record<string, any>;
}

export interface MemoryConfig {
  shortTerm?: boolean;
  checkpoint?: boolean;
  longTerm?: boolean;
}

export interface AuthConfig {
  type: "bearer" | "api-key" | "none";
  token?: string;
  tokenEnvVar?: string;
}

// =============================================================================
// IAgent Interface - The Core Contract
// =============================================================================

/**
 * The unified agent interface.
 * All agent types (internal, external, agentic-ui) must implement this.
 *
 * Note: Builders are now internal agents with config.responseFormat set.
 */
export interface IAgent {
  // Identity
  readonly id: string;
  readonly name: string;
  readonly type: AgentType;
  readonly role: string;
  readonly definition: AgentDefinition;

  // Task Management
  readonly tasks: ITaskList;
  assignTask(task: Omit<Task, "status" | "assignedAt">): void;
  getActiveTasks(): Task[];
  completeTask(taskId: string, output: any): void;
  failTask(taskId: string, error: string): void;

  // Execution
  /**
   * @deprecated Internal: production callers should use
   * `IStreamingAgent.runWithHooks(input)` (May 9 2026 PM-4 — Patch #1).
   * Kept on the interface only because `AiSdkAgent.runWithHooks` drives
   * its own iteration through this generator internally; once `runWithHooks`
   * is rewritten to drive `streamText` callbacks natively, this method
   * will be removed from the interface entirely.
   */
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;

  // State
  getStatus(): AgentStatus;
  getConversation(): Message[];

  // Lifecycle
  initialize(): Promise<void>;
  waitUntilReady(): Promise<void>;
  stop(): Promise<void>;
  reset(): Promise<void>;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}
