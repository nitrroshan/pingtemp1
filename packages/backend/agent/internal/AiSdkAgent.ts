/**
 * AiSdkAgent — AI SDK-based agent implementation
 *
 * Replaces InternalAgent's LangGraph layer with Vercel AI SDK `streamText()`.
 * Supports the same interface as InternalAgent, enabling hot-swap via
 * the AGENT_RUNTIME feature flag.
 *
 * Modes:
 *   1. Tool Mode (default) — streamText() with tools, streams AgentEvents
 *   2. Structured Output Mode — generateObject() with Zod schema
 *
 * Feature flag: AGENT_RUNTIME=aisdk (set to use this agent)
 */

import { streamText, generateObject, tool } from "ai";
import { z } from "zod";
import { Logger } from "tslog";
import { BaseAgent } from "../BaseAgent.js";
import { getModel } from "../providers/ModelProvider.js";
import type {
  AgentDefinition,
  AgentInput,
  AgentEvent,
  InternalConfig,
  ToolConfig,
} from "../types.js";
import {
  AgentRoleSchema,
  AgentConfigSchema,
  AgentConfigItemSchema,
  AgentPlanSchema,
  AgentDefinitionListSchema,
} from "./schemas/index.js";
import dotenv from "dotenv";

dotenv.config();

const logger = new Logger({ name: "AiSdkAgent" });

/** Map of schema names to Zod schemas for structured output mode */
const SCHEMAS: Record<string, z.ZodSchema> = {
  AgentRoleSchema,
  AgentConfigSchema,
  AgentConfigItemSchema,
  AgentPlanSchema,
  AgentDefinitionListSchema,
};

export class AiSdkAgent extends BaseAgent {
  private model: any = null;
  private loadedTools: Record<string, any> = {};
  private isStructuredMode = false;
  private outputSchema: z.ZodSchema | null = null;

  /** Conversation messages for this thread (replaces LangGraph MemorySaver) */
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  /** Max steps for multi-step tool calls */
  private maxSteps = 10;

  constructor(definition: AgentDefinition) {
    super(definition);

    const config = definition.config as InternalConfig;
    const schemaName = config.responseFormat || (config as any).outputSchema;
    if (schemaName && SCHEMAS[schemaName]) {
      this.isStructuredMode = true;
      this.outputSchema = SCHEMAS[schemaName];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const config = this.definition.config as InternalConfig;
    logger.info(
      `Initializing AiSdkAgent: ${this.id} (mode: ${this.isStructuredMode ? "structured" : "tool"})`,
    );

    this.model = getModel(config.model);

    if (!this.isStructuredMode && config.tools?.length) {
      this.loadedTools = await this.resolveToolConfigs(config.tools);
    }

    this.setStatus("idle");
    logger.info(
      `AiSdkAgent ${this.id} initialized` +
        (Object.keys(this.loadedTools).length > 0
          ? ` with ${Object.keys(this.loadedTools).length} tools`
          : ""),
    );
  }

  async waitUntilReady(): Promise<void> {
    if (!this.model) await this.initialize();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool management (hot-swappable)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set tools — can be called before or after initialization.
   * Tools passed here override any previously loaded tools.
   * AI SDK passes tools per-call, so no graph rebuild needed.
   */
  async setTools(tools: any[]): Promise<void> {
    this.loadedTools = {};
    for (const t of tools) {
      const name = t.name || t._name || "unknown";
      this.loadedTools[name] = t;
    }
    logger.info(`AiSdkAgent ${this.id} tools updated: ${Object.keys(this.loadedTools).join(", ")}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Execution
  // ─────────────────────────────────────────────────────────────────────────

  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    if (!this.model) await this.initialize();

    this.setStatus("executing");
    yield { type: "thinking", content: `${this.name} is processing...` };

    // Append user message to conversation
    this.messages.push({ role: "user", content: input.message });

    try {
      if (this.isStructuredMode) {
        yield* this.executeStructured(input);
      } else {
        yield* this.executeToolMode(input);
      }
    } catch (error: any) {
      logger.error(`AiSdkAgent ${this.id} error:`, error);
      this.setStatus("error");

      yield {
        type: "error",
        error: error.message || String(error),
        recoverable: true,
      };

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

  // ─────────────────────────────────────────────────────────────────────────
  // Structured Output Mode
  // ─────────────────────────────────────────────────────────────────────────

  private async *executeStructured(
    input: AgentInput,
  ): AsyncGenerator<AgentEvent> {
    const result = await generateObject({
      model: this.model,
      schema: this.outputSchema!,
      messages: this.buildMessages(input.message),
      ...(this.definition.systemPrompt
        ? { system: this.definition.systemPrompt }
        : {}),
    });

    const output = result.object;
    const responseStr =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);

    this.messages.push({ role: "assistant", content: responseStr });
    this.addToHistory("assistant", responseStr);

    yield this.messageEvent(responseStr);
    yield this.doneEvent(output, `${this.name} completed successfully`);

    this.setStatus("idle");

    if (input.taskId) {
      this._emitter.emit("task:complete", {
        agentId: this.id,
        taskId: input.taskId,
        output,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool Mode (streaming)
  // ─────────────────────────────────────────────────────────────────────────

  private async *executeToolMode(
    input: AgentInput,
  ): AsyncGenerator<AgentEvent> {
    const hasTools = Object.keys(this.loadedTools).length > 0;

    const result = await streamText({
      model: this.model,
      messages: this.buildMessages(input.message),
      ...(this.definition.systemPrompt
        ? { system: this.definition.systemPrompt }
        : {}),
      ...(hasTools ? { tools: this.loadedTools, maxSteps: this.maxSteps } : {}),
      onStepFinish: ({ finishReason }) => {
        logger.debug(`AiSdkAgent step finished: ${finishReason}`);
      },
    });

    let fullText = "";

    // Iterate fullStream and yield AgentEvents
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          fullText += (part as any).text ?? (part as any).textDelta ?? "";
          yield { type: "message_delta", delta: (part as any).text ?? (part as any).textDelta ?? "" };
          break;

        case "tool-call":
          yield this.toolStartEvent((part as any).toolName, ((part as any).input ?? (part as any).args ?? {}) as Record<string, any>);
          break;

        case "tool-result":
          yield this.toolResultEvent((part as any).toolName, (part as any).output ?? (part as any).result);
          break;

        case "reasoning-delta":
          // Emit as thinking event if reasoning is present
          yield { type: "thinking", content: (part as any).textDelta ?? (part as any).delta ?? "" };
          break;

        case "error":
          throw new Error(
            (part as any).error?.message || String((part as any).error) || "Stream error",
          );

        default:
          break;
      }
    }

    // Store final response in conversation
    if (fullText) {
      this.messages.push({ role: "assistant", content: fullText });
      this.addToHistory("assistant", fullText);
    }

    // Emit final message and done
    yield { type: "message", content: fullText, streaming: false };
    yield {
      type: "done",
      output: { response: fullText },
      summary: `${this.name} completed`,
    };

    this.setStatus("idle");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Streaming with bridge support (for SocketServerV2)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute and return the raw streamText result for StreamBridge.
   * Used when the caller wants to pipe fullStream directly to Socket.IO.
   */
  async executeWithStream(input: AgentInput): Promise<any> {
    if (!this.model) await this.initialize();

    this.messages.push({ role: "user", content: input.message });

    const hasTools = Object.keys(this.loadedTools).length > 0;

    return streamText({
      model: this.model,
      messages: this.buildMessages(input.message),
      ...(this.definition.systemPrompt
        ? { system: this.definition.systemPrompt }
        : {}),
      ...(hasTools ? { tools: this.loadedTools, maxSteps: this.maxSteps } : {}),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Convenience API
  // ─────────────────────────────────────────────────────────────────────────

  async run(prompt: string, threadId?: string): Promise<any> {
    let response: any = null;

    for await (const event of this.execute({
      message: prompt,
      threadId: threadId || `${this.id}-${Date.now()}`,
    })) {
      if (event.type === "done" && event.output) {
        response = this.isStructuredMode
          ? event.output
          : event.output.response || "";
      }
      if (event.type === "error") {
        throw new Error(event.error);
      }
    }

    return response;
  }

  getTools(): string[] {
    return Object.keys(this.loadedTools);
  }

  isBuilderMode(): boolean {
    return this.isStructuredMode;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    logger.info(`Stopping AiSdkAgent: ${this.id}`);
    this.setStatus("stopped");
  }

  async reset(): Promise<void> {
    logger.info(`Resetting AiSdkAgent: ${this.id}`);
    this.messages = [];
    this._conversationHistory = [];
    this._tasks = new (await import("../TaskList.js")).TaskList();
    this.setStatus("idle");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build the messages array for this call (conversation history + new message).
   * The new user message is already appended to this.messages before this runs.
   */
  private buildMessages(
    _newMessage: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    // Return all messages including the one just appended
    return [...this.messages];
  }

  /**
   * Resolve ToolConfig entries to AI SDK tool objects.
   * Custom tools are created with the AI SDK `tool()` helper.
   */
  private async resolveToolConfigs(
    configs: ToolConfig[],
  ): Promise<Record<string, any>> {
    const result: Record<string, any> = {};

    for (const cfg of configs) {
      if (cfg.type === "custom" && cfg.config?.handler) {
        // AI SDK v4: tool() uses `inputSchema` (v4) or `parameters` (v3) 
        const toolDef: any = {
          description: cfg.config.description || `Tool: ${cfg.name}`,
          inputSchema: cfg.config.schema || z.object({}),
          execute: cfg.config.handler,
        };
        result[cfg.name] = tool(toolDef);
      }
      // builtin and mcp tools are injected via setTools()
    }

    return result;
  }
}
