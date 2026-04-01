/**
 * InternalAgent - Unified LangGraph-based agent for all internal agents
 *
 * This is the core execution engine for all internal agents in Ping.
 * Supports two modes based on configuration:
 *
 * 1. Tool Mode (default): Uses tools for capabilities
 *    - Streaming execution with tool_start, tool_result events
 *    - MCP tool integration
 *    - Used by: Workers, Orchestrator
 *
 * 2. Structured Output Mode: Uses responseFormat for typed output
 *    - Returns parsed structured data matching a Zod schema
 *    - Used by: RoleBuilder, ConfigBuilder, PlanBuilder
 *
 * Features:
 * - LangGraph-based execution
 * - Streaming events via AsyncGenerator
 * - Conversation memory via thread_id
 * - MCP tool integration (tool mode only)
 * - Azure OpenAI / Anthropic / OpenAI support
 */

import { BaseAgent } from "../BaseAgent.js";
import type {
  AgentDefinition,
  AgentInput,
  AgentEvent,
  InternalConfig,
  ModelConfig,
  ToolConfig,
} from "../types.js";

// LangChain imports
import { createAgent, providerStrategy } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Logger } from "tslog";
import dotenv from "dotenv";

// Schema imports for structured output mode
import {
  AgentRoleSchema,
  AgentConfigSchema,
  AgentConfigItemSchema,
  AgentPlanSchema,
  AgentDefinitionListSchema,
} from "./schemas/index.js";

dotenv.config();

const logger = new Logger({ name: "InternalAgent" });

/**
 * Map of schema names to their Zod schemas
 */
const schemas: Record<string, z.ZodSchema> = {
  AgentRoleSchema,
  AgentConfigSchema,
  AgentConfigItemSchema,
  AgentPlanSchema,
  AgentDefinitionListSchema,
};

export class InternalAgent extends BaseAgent {
  private agent: any;
  private memory: MemorySaver;
  private mcpClient: MultiServerMCPClient | null = null;
  private loadedTools: any[] = [];
  private isStructuredOutputMode: boolean = false;
  private outputSchema: z.ZodSchema | null = null;

  constructor(definition: AgentDefinition) {
    super(definition);
    this.memory = new MemorySaver();

    // Determine mode from config
    const config = definition.config as InternalConfig;
    const schemaName = config.responseFormat || (config as any).outputSchema;
    if (schemaName && schemas[schemaName]) {
      this.isStructuredOutputMode = true;
      this.outputSchema = schemas[schemaName];
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    const config = this.definition.config as InternalConfig;

    logger.info(
      `Initializing InternalAgent: ${this.id} (mode: ${this.isStructuredOutputMode ? "structured" : "tool"})`,
    );

    // Create the model instance
    const model = this.createModel(config.model);

    // Load tools (only in tool mode)
    if (!this.isStructuredOutputMode) {
      this.loadedTools = await this.loadTools(config);
    }

    // Build createAgent config
    const agentConfig: any = {
      model,
      tools: this.loadedTools,
      checkpointer: this.memory,
    };

    // Add system prompt if defined
    if (this.definition.systemPrompt) {
      agentConfig.systemPrompt = this.definition.systemPrompt;
    }

    // Apply structured output via responseFormat (structured output mode)
    if (this.isStructuredOutputMode && this.outputSchema) {
      agentConfig.responseFormat = providerStrategy(this.outputSchema);
    }

    // Create the agent using langchain's createAgent
    this.agent = await createAgent(agentConfig);

    this.setStatus("idle");
    logger.info(
      `InternalAgent ${this.id} initialized` +
        (this.loadedTools.length > 0
          ? ` with ${this.loadedTools.length} tools`
          : ""),
    );
  }

  /**
   * Set or replace tools on this agent.
   * Must be called BEFORE initialize() or the agent must be re-initialized.
   * For post-init injection, this rebuilds the agent with new tools.
   *
   * Note: The old agent object is replaced and garbage collected.
   * The MemorySaver (checkpointer) is reused to preserve conversation history.
   */
  async setTools(tools: any[]): Promise<void> {
    this.loadedTools = tools;

    // If already initialized, rebuild the agent with new tools
    if (this.agent) {
      const config = this.definition.config as InternalConfig;
      const model = this.createModel(config.model);

      const agentConfig: any = {
        model,
        tools: this.loadedTools,
        checkpointer: this.memory, // Reuse checkpointer to preserve conversation history
      };

      if (this.definition.systemPrompt) {
        agentConfig.systemPrompt = this.definition.systemPrompt;
      }

      // Replace agent (old one will be garbage collected)
      // LangGraph agents don't require explicit cleanup as they don't hold external resources
      this.agent = await createAgent(agentConfig);
      logger.info(
        `InternalAgent ${this.id} rebuilt with ${tools.length} tools`,
      );
    }
  }

  async waitUntilReady(): Promise<void> {
    if (!this.agent) {
      await this.initialize();
    }
  }

  // ==========================================================================
  // Model Creation
  // ==========================================================================

  private createModel(config: ModelConfig): any {
    // Use lower temperature for structured output mode
    const defaultTemp = this.isStructuredOutputMode ? 0.3 : 0.7;

    switch (config.provider) {
      case "azure-openai": {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT_URL;
        const apiKey = process.env.AZURE_OPENAI_API_KEY;
        const deployment =
          config.deployment ||
          process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME ||
          "gpt-4o-2";
        const apiVersion = "2025-01-01-preview";

        if (!endpoint) {
          throw new Error(
            "AZURE_OPENAI_ENDPOINT_URL environment variable is required",
          );
        }
        if (!apiKey) {
          throw new Error(
            "AZURE_OPENAI_API_KEY environment variable is required",
          );
        }

        const azureConfig: any = {
          azureOpenAIEndpoint: endpoint,
          azureOpenAIApiKey: apiKey,
          azureOpenAIApiDeploymentName: deployment,
          azureOpenAIApiVersion: apiVersion,
          temperature: config.temperature ?? defaultTemp,
          timeout: 120000, // 2 minutes timeout for API calls
          maxRetries: 2, // Retry failed requests up to 2 times
        };

        if (config.maxTokens) {
          azureConfig.maxTokens = config.maxTokens;
        }

        return new AzureChatOpenAI(azureConfig);
      }

      case "anthropic": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          throw new Error("ANTHROPIC_API_KEY environment variable is required");
        }

        const anthropicConfig: any = {
          apiKey,
          modelName: config.model || "claude-sonnet-4-20250514",
          temperature: config.temperature ?? defaultTemp,
        };

        if (config.maxTokens) {
          anthropicConfig.maxTokens = config.maxTokens;
        }

        return new ChatAnthropic(anthropicConfig);
      }

      case "openai": {
        if (!process.env.OPENAI_API_KEY) {
          throw new Error("OPENAI_API_KEY environment variable is required");
        }
        return config.model || "gpt-4o";
      }

      default:
        throw new Error(`Unsupported model provider: ${config.provider}`);
    }
  }

  // ==========================================================================
  // Tool Loading
  // ==========================================================================

  private async loadTools(config: InternalConfig): Promise<any[]> {
    const tools: any[] = [];

    // Load configured tools
    if (config.tools && config.tools.length > 0) {
      for (const toolConfig of config.tools) {
        const loadedTool = await this.loadTool(toolConfig);
        if (loadedTool) {
          tools.push(loadedTool);
        }
      }
    }

    // Load MCP tools if mcpClientConfigs is available in definition
    const mcpConfigs = (this.definition as any).mcpClientConfigs;
    if (mcpConfigs && Object.keys(mcpConfigs).length > 0) {
      try {
        logger.debug("Initializing MCP client with configs:", mcpConfigs);
        this.mcpClient = new MultiServerMCPClient(mcpConfigs);
        const mcpTools = await this.mcpClient.getTools();
        tools.push(...mcpTools);
        logger.info(`Loaded ${mcpTools.length} MCP tools`);
      } catch (error) {
        logger.warn("Failed to initialize MCP client:", error);
      }
    }

    return tools;
  }

  private async loadTool(toolConfig: ToolConfig): Promise<any | null> {
    switch (toolConfig.type) {
      case "builtin":
        return this.loadBuiltinTool(toolConfig.name, toolConfig.config);
      case "mcp":
        // MCP tools are loaded via MultiServerMCPClient above
        logger.debug(
          `MCP tool ${toolConfig.name} will be loaded via MCP client`,
        );
        return null;
      case "custom":
        return this.loadCustomTool(toolConfig.name, toolConfig.config);
      default:
        logger.warn(`Unknown tool type: ${toolConfig.type}`);
        return null;
    }
  }

  private loadBuiltinTool(name: string, config?: Record<string, any>): any {
    // Placeholder for builtin tools - will be populated as we add orchestrator tools
    // For now, return null - tools will be injected by AgentFactory or passed in config
    logger.debug(`Builtin tool requested: ${name}`);
    return null;
  }

  private loadCustomTool(name: string, config?: Record<string, any>): any {
    // Custom tools can be passed via config.handler
    if (config?.handler && typeof config.handler === "function") {
      return tool(config.handler, {
        name,
        description: config.description || `Custom tool: ${name}`,
        schema: config.schema || z.object({}),
      });
    }
    logger.warn(`Custom tool ${name} has no handler`);
    return null;
  }

  // ==========================================================================
  // Execution - Streaming with Events
  // ==========================================================================

  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    if (!this.agent) {
      await this.initialize();
    }

    this.setStatus("executing");
    yield { type: "thinking", content: `${this.name} is processing...` };

    try {
      // Add to conversation history
      this.addToHistory("user", input.message);

      // Route to appropriate execution mode
      if (this.isStructuredOutputMode) {
        yield* this.executeStructuredOutput(input);
      } else {
        yield* this.executeToolMode(input);
      }
    } catch (error: any) {
      logger.error(`InternalAgent ${this.id} execution error:`, error);
      this.setStatus("error");

      yield {
        type: "error",
        error: error.message || String(error),
        recoverable: true,
      };

      // Emit task failed event if we have a task context
      if (input.taskId) {
        this._emitter.emit("task:failed", {
          agentId: this.id,
          taskId: input.taskId,
          error: error.message,
        });
      }

      throw error;
    }
  }

  // ==========================================================================
  // Structured Output Mode (formerly BuilderAgent)
  // ==========================================================================

  private async *executeStructuredOutput(
    input: AgentInput,
  ): AsyncGenerator<AgentEvent> {
    // Invoke the agent - createAgent handles messages internally
    const result = await this.agent.invoke(
      {
        messages: [{ role: "user", content: input.message }],
      },
      {
        configurable: {
          thread_id: input.threadId,
        },
      },
    );

    // Extract structured response (returned by responseFormat)
    const response = result.structuredResponse ?? this.extractResponse(result);

    // Store in history
    const responseStr =
      typeof response === "string"
        ? response
        : JSON.stringify(response, null, 2);
    this.addToHistory("assistant", responseStr);

    // Emit message event
    yield this.messageEvent(responseStr);

    // Complete with structured output
    yield this.doneEvent(response, `${this.name} completed successfully`);

    this.setStatus("idle");

    // Emit task complete event if we have a task context
    if (input.taskId) {
      this._emitter.emit("task:complete", {
        agentId: this.id,
        taskId: input.taskId,
        output: response,
      });
    }
  }

  // ==========================================================================
  // Tool Mode (streaming execution)
  // ==========================================================================

  private async *executeToolMode(
    input: AgentInput,
  ): AsyncGenerator<AgentEvent> {
    // Invoke agent (like AgentWorker.callAgent)
    const result = await this.agent.invoke(
      { messages: [{ role: "user", content: input.message }] },
      { configurable: { thread_id: input.threadId } },
    );

    // Extract response from last message in result.messages
    const messages = result.messages || [];
    const lastMessage = messages[messages.length - 1];

    const finalResponse = lastMessage?.content
      ? typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content)
      : "";

    logger.debug(`Tool mode response: ${finalResponse.slice(0, 100)}...`);

    // Add to history
    if (finalResponse) {
      this.addToHistory("assistant", finalResponse);
    }

    // Emit events
    yield { type: "message", content: finalResponse, streaming: false };
    yield {
      type: "done",
      output: { response: finalResponse },
      summary: `${this.name} completed`,
    };

    this.setStatus("idle");
  }

  // ==========================================================================
  // Response Extraction (Structured Output Mode)
  // ==========================================================================

  private extractResponse(result: any): any {
    // Try structuredResponse first (from withStructuredOutput)
    if (result.structuredResponse) {
      return result.structuredResponse;
    }

    // Try to get from messages
    if (result.messages && Array.isArray(result.messages)) {
      const lastMessage = result.messages[result.messages.length - 1];

      // Check for parsed content
      if (lastMessage.parsed) {
        return lastMessage.parsed;
      }

      // Check for additional_kwargs.parsed
      if (lastMessage.additional_kwargs?.parsed) {
        return lastMessage.additional_kwargs.parsed;
      }

      // Try to parse JSON from content
      const content = lastMessage.content;
      if (typeof content === "string") {
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      }

      return content;
    }

    // Fallback: return the raw result
    return result;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async stop(): Promise<void> {
    logger.info(`Stopping InternalAgent: ${this.id}`);
    this.setStatus("stopped");

    // Cleanup MCP client if exists
    if (this.mcpClient) {
      // MCP client cleanup if needed
      this.mcpClient = null;
    }
  }

  async reset(): Promise<void> {
    logger.info(`Resetting InternalAgent: ${this.id}`);
    this._conversationHistory = [];
    this._tasks = new (await import("../TaskList.js")).TaskList();
    this.setStatus("idle");
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  /**
   * Run the agent with a simple prompt and return the response
   * For tool mode: returns string response
   * For structured output mode: returns parsed structured object
   */
  async run(prompt: string, threadId?: string): Promise<any> {
    let response: any = null;

    for await (const event of this.execute({
      message: prompt,
      threadId: threadId || `${this.id}-${Date.now()}`,
    })) {
      if (event.type === "done" && event.output) {
        // Structured output mode returns the full output object
        // Tool mode returns output.response
        response = this.isStructuredOutputMode
          ? event.output
          : event.output.response || "";
      }
      if (event.type === "error") {
        throw new Error(event.error);
      }
    }

    return response;
  }

  /**
   * Get the list of available tools (tool mode only)
   */
  getTools(): string[] {
    return this.loadedTools.map((t) => t.name || "unknown");
  }

  /**
   * Check if this agent is in structured output mode
   */
  isBuilderMode(): boolean {
    return this.isStructuredOutputMode;
  }
}
