/**
 * AgentFactory - Creates agent instances from definitions
 *
 * Replaces AgentBuilderFactory with a unified factory for all agent types.
 *
 * Agent Type Resolution:
 * - 'internal' → InternalAgent (unified agent)
 *   - Without responseFormat: Tool mode (workers, orchestrator)
 *   - With responseFormat: Structured output mode (builders)
 * - 'external' → ExternalAgent
 * - 'agentic-ui' → AgenticUIAgent
 */

import { AgentLoader } from "./AgentLoader.js";
import { BaseAgent } from "./BaseAgent.js";
import type { AgentDefinition, AgentType, IAgent } from "./types.js";

// Import concrete implementations
import { InternalAgent } from "./internal/InternalAgent.js";
// import { ExternalAgent } from './external/ExternalAgent.js';
// import { AgenticUIAgent } from './agentic-ui/AgenticUIAgent.js';

/**
 * Registry of agent implementations by type
 * InternalAgent handles both tool mode and structured output mode internally
 */
type AgentConstructor = new (definition: AgentDefinition) => BaseAgent;

const agentConstructors: Map<AgentType, AgentConstructor> = new Map();

// Register InternalAgent for 'internal' type (handles both modes)
agentConstructors.set("internal", InternalAgent);

/**
 * Register an agent implementation for a type
 */
export function registerAgentType(
  type: AgentType,
  constructor: AgentConstructor,
): void {
  agentConstructors.set(type, constructor);
}

/**
 * Select the appropriate constructor based on definition
 */
function selectConstructor(
  definition: AgentDefinition,
): AgentConstructor | undefined {
  // InternalAgent handles responseFormat internally, no special selection needed
  return agentConstructors.get(definition.type);
}

export class AgentFactory {
  private loader: AgentLoader;
  private instances: Map<string, IAgent> = new Map();

  constructor(agentsDir: string) {
    this.loader = new AgentLoader(agentsDir);
    this.loader.loadAll();
  }

  // ==========================================================================
  // Factory Methods
  // ==========================================================================

  /**
   * Create an agent from a definition
   */
  create(definition: AgentDefinition): IAgent {
    const Constructor = selectConstructor(definition);

    if (!Constructor) {
      throw new Error(
        `No agent implementation registered for type "${definition.type}". ` +
          `Register one using registerAgentType().`,
      );
    }

    const agent = new Constructor(definition);
    this.instances.set(definition.id, agent);
    return agent;
  }

  /**
   * Create an agent by ID (loads from YAML)
   */
  createById(agentId: string): IAgent {
    const definition = this.loader.load(agentId);

    if (!definition) {
      throw new Error(`Agent definition not found: ${agentId}`);
    }

    return this.create(definition);
  }

  /**
   * Get or create an agent instance (singleton per ID)
   */
  getInstance(agentId: string): IAgent {
    if (this.instances.has(agentId)) {
      return this.instances.get(agentId)!;
    }

    return this.createById(agentId);
  }

  // ==========================================================================
  // Builder Convenience Methods
  // ==========================================================================

  /**
   * Get a role builder agent
   */
  getRoleBuilder(): IAgent {
    return this.getInstance("role-builder");
  }

  /**
   * Get a config builder agent
   */
  getConfigBuilder(): IAgent {
    return this.getInstance("config-builder");
  }

  /**
   * Get a plan builder agent
   */
  getPlanBuilder(): IAgent {
    return this.getInstance("plan-builder");
  }

  /**
   * Get a definition builder agent (one-shot role + config)
   */
  getDefinitionBuilder(): IAgent {
    return this.getInstance("definition-builder");
  }

  /**
   * Get a builder by type
   */
  getBuilder(builderType: "role" | "config" | "plan" | "definition"): IAgent {
    const builderMap: Record<string, string> = {
      role: "role-builder",
      config: "config-builder",
      plan: "plan-builder",
      definition: "definition-builder",
    };

    const agentId = builderMap[builderType];
    if (!agentId) {
      throw new Error(`Unknown builder type: ${builderType}`);
    }

    return this.getInstance(agentId);
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * List all available agent definitions
   */
  listDefinitions(): AgentDefinition[] {
    return this.loader.loadAll();
  }

  /**
   * List all active agent instances
   */
  listInstances(): IAgent[] {
    return Array.from(this.instances.values());
  }

  /**
   * Check if an agent exists
   */
  has(agentId: string): boolean {
    return this.loader.get(agentId) !== undefined;
  }

  /**
   * Get an agent definition
   */
  getDefinition(agentId: string): AgentDefinition | undefined {
    return this.loader.get(agentId);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize all registered agents
   */
  async initializeAll(): Promise<void> {
    const promises = Array.from(this.instances.values()).map((agent) =>
      agent.initialize(),
    );
    await Promise.all(promises);
  }

  /**
   * Stop all agents
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.instances.values()).map((agent) =>
      agent.stop(),
    );
    await Promise.all(promises);
  }

  /**
   * Reload definitions (useful for hot-reloading)
   */
  reloadDefinitions(): void {
    this.loader.reload();
  }

  /**
   * Remove an instance
   */
  async removeInstance(agentId: string): Promise<void> {
    const agent = this.instances.get(agentId);
    if (agent) {
      await agent.stop();
      this.instances.delete(agentId);
    }
  }
}

// =============================================================================
// Default Factory Instance
// =============================================================================

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

// Get directory of this module for relative path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the agents directory - handles both source and compiled paths
 * When running from dist/, we need to find the source YAML files
 */
function resolveAgentsDir(): string {
  // Check environment variable first
  if (process.env.AGENTS_DIR && existsSync(process.env.AGENTS_DIR)) {
    return process.env.AGENTS_DIR;
  }

  // Try relative to current module location
  const localAgentsDir = join(__dirname, "agents");
  if (existsSync(localAgentsDir)) {
    return localAgentsDir;
  }

  // If running from dist/, look for source files
  // Pattern: .../src/worker/dist/src/worker/agent -> .../src/worker/agent/agents
  if (__dirname.includes("dist")) {
    // Replace 'dist/src/worker' with '' to get back to src/worker level
    // __dirname: D:\...\src\worker\dist\src\worker\agent
    // We want:   D:\...\src\worker\agent\agents
    const normalized = __dirname.replace(/[\\/]/g, "/");
    const distPattern = /\/dist\/src\/worker\//;
    if (distPattern.test(normalized)) {
      const sourceDir = normalized.replace(distPattern, "/");
      const sourceAgentsDir = join(sourceDir, "agents");
      if (existsSync(sourceAgentsDir)) {
        return sourceAgentsDir;
      }
    }
  }

  // Fallback to relative path (will likely fail, but gives a clear error)
  return localAgentsDir;
}

let defaultFactory: AgentFactory | null = null;

/**
 * Get the default factory instance
 */
export function getAgentFactory(): AgentFactory {
  if (!defaultFactory) {
    const agentsDir = resolveAgentsDir();
    defaultFactory = new AgentFactory(agentsDir);
  }
  return defaultFactory;
}

/**
 * Set the default factory instance
 */
export function setAgentFactory(factory: AgentFactory): void {
  defaultFactory = factory;
}
