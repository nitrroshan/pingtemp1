/**
 * AiSdkAgent — AI SDK-based agent implementation
 *
 * Uses Vercel AI SDK `streamText()` for agent execution.
 *
 * Modes:
 *   1. Tool Mode (default) — streamText() with tools, streams AgentEvents
 *   2. Structured Output Mode — generateText() with Output.object() schema
 */

import { streamText, generateText, Output, tool, stepCountIs, isLoopFinished } from "ai";
import type { ModelMessage, StopCondition, ToolSet } from "ai";
import { z } from "zod";
import { rootLogger } from "../../logging.js";
import { BaseAgent } from "../BaseAgent.js";
import { getModel } from "../providers/ModelProvider.js";
import { SmoothStream } from "../streaming/smoothStream.js";
import type {
  AgentDefinition,
  AgentInput,
  AgentEvent,
  InternalConfig,
  ToolConfig,
} from "../types.js";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentStepInfo,
  IStreamingAgent,
  StreamingAgentContext,
  StreamingHooks,
  StreamPart,
  TaskLifecycleHooks,
} from "../streaming/types.js";
import {
  AgentRoleSchema,
  AgentConfigSchema,
  AgentConfigItemSchema,
  AgentPlanSchema,
  AgentDefinitionListSchema,
} from "./schemas/index.js";
const logger = rootLogger.child({ module: "AiSdkAgent" });

/** Map of schema names to Zod schemas for structured output mode */
const SCHEMAS: Record<string, z.ZodSchema> = {
  AgentRoleSchema,
  AgentConfigSchema,
  AgentConfigItemSchema,
  AgentPlanSchema,
  AgentDefinitionListSchema,
};

export class AiSdkAgent extends BaseAgent implements IStreamingAgent {
  private model: any = null;
  private loadedTools: Record<string, any> = {};
  private isStructuredMode = false;
  private outputSchema: z.ZodSchema | null = null;

  // ---------------------------------------------------------------------------
  // IStreamingAgent surface (Phase 1.5 of agent-stream-bus refactor)
  //
  // Set by `AgentFactory.create()` (Phase 1.7) before `runWithHooks()` is
  // called. Optional so the legacy `execute()` / `run()` paths remain usable
  // without configuring hooks.
  // ---------------------------------------------------------------------------

  /** Streaming observation hooks. Read-only fan-out of stream parts. */
  onStreaming?: StreamingHooks;

  /** Task lifecycle hooks. Lifecycle tools call into these (Phase 1.6). */
  onTaskLifecycle?: TaskLifecycleHooks;

  /**
   * Per-execution termination state. Flipped by `markTerminated()` when
   * a lifecycle tool's call has been ACCEPTED by orchestration (the hook
   * returned `accepted: true`, OR the typed callback completed without
   * throwing).
   *
   * The `streamText` stop condition reads this — so the loop only stops
   * when termination is genuinely accepted, NOT just because the tool was
   * invoked. This lets the agent self-correct when `complete_task` is
   * rejected (e.g. for a missing report doc): the rejection error string
   * is fed back to the LLM, which writes the report doc and calls again,
   * and only THEN the loop ends.
   */
  private terminationState: { kind: "complete" | "bounce" | null } = { kind: null };

  /** Conversation messages for this thread (full AI SDK format to preserve tool calls/results) */
  private messages: Array<ModelMessage> = [];

  /** Max tool-use steps. 0 = unlimited (uses isLoopFinished). Default: 0 for autonomous mode. */
  private maxSteps = 0;

  /**
   * Load prior conversation messages for context restoration.
   * Called after initialize() to restore session agent conversations on restart.
   *
   * Accepts two formats:
   * - Full ModelMessage[] (with tool calls/results) — preferred, from contextMessages
   * - Simplified { role, content: string }[] — fallback from v1.0 persistence
   *
   * Auto-detects format: if any message has array content → full format.
   */
  loadMessages(messages: Array<any>): void {
    if (!messages?.length) return;

    // Detect format: full ModelMessage[] has content as array (tool calls, etc.)
    const isFullFormat = messages.some(m =>
      Array.isArray(m.content) || m.role === "tool"
    );

    if (isFullFormat) {
      // Full ModelMessage[] — use directly (already JSON-safe round-tripped)
      this.messages = messages as ModelMessage[];
      logger.info(`AiSdkAgent ${this.id} loaded ${messages.length} full-fidelity messages (with tool calls/results)`);
    } else {
      // Simplified format — map to ModelMessage
      this.messages = messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as ModelMessage[];
      logger.info(`AiSdkAgent ${this.id} loaded ${messages.length} simplified messages for context restoration`);
    }
  }

  /**
   * Get current conversation messages (full AI SDK ModelMessage[] format).
   * Returns a shallow copy. Used for persistence — JSON.stringify safe.
   */
  getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  /** Replace the conversation messages (used for session restore from database). */
  setMessages(messages: ModelMessage[]): void {
    this.messages = [...messages];
  }

  /** Get current message count (for diagnostics) */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** Extended thinking/reasoning config (Anthropic thinking + OpenAI reasoningEffort) */
  private thinking?: { enabled: boolean; budgetTokens?: number; reasoningEffort?: "low" | "medium" | "high" };

  /** Token budget safety cap — stops execution if cumulative tokens exceed this */
  private maxTotalTokens = 500_000;

  /** Model parameters from config */
  private temperature?: number;
  private maxTokens?: number;

  constructor(definition: AgentDefinition) {
    super(definition);

    const config = definition.config as InternalConfig;
    const schemaName = config.responseFormat || (config as any).outputSchema;
    if (schemaName && SCHEMAS[schemaName]) {
      this.isStructuredMode = true;
      this.outputSchema = SCHEMAS[schemaName];
    }

    // Read model parameters from config
    if (config.model?.temperature !== undefined) this.temperature = config.model.temperature;
    if (config.model?.maxTokens !== undefined) this.maxTokens = config.model.maxTokens;
    if (config.maxSteps !== undefined) this.maxSteps = config.maxSteps;
    if (config.maxTotalTokens !== undefined) this.maxTotalTokens = config.maxTotalTokens;
    if (config.thinking?.enabled) this.thinking = config.thinking;
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
   *
   * Accepts both AI SDK tools and LangChain tools (StructuredTool / DynamicStructuredTool).
   * LangChain tools are auto-converted to AI SDK format.
   */
  async setTools(tools: any[]): Promise<void> {
    this.loadedTools = {};
    for (const t of tools) {
      const name: string = t.name || t._name || "unknown";
      this.loadedTools[name] = this.toAiSdkTool(t);
    }
    logger.info(`AiSdkAgent ${this.id} tools updated: ${Object.keys(this.loadedTools).join(", ")}`);
  }

  /**
   * Append additional instructions to the system prompt at runtime.
   * Used by plugins to inject skill playbooks and guidelines.
   */
  appendSystemPrompt(additions: string[]): void {
    if (!additions || additions.length === 0) return;
    const extra = additions.join("\n\n");
    this.definition.systemPrompt =
      (this.definition.systemPrompt || "") + "\n\n" + extra;
  }

  /**
   * Convert a tool to AI SDK format if it's a LangChain tool.
   * LangChain tools (StructuredTool / DynamicStructuredTool from @langchain/core/tools)
   * expose `.schema` (Zod), `.description`, and `.invoke()`.
   * AI SDK's `tool()` helper handles Zod→JSON Schema conversion.
   */
  private toAiSdkTool(t: any): any {
    // Already an AI SDK tool (has `execute` and `inputSchema` — v4+ property name)
    if (typeof t?.execute === "function" && (t?.inputSchema || t?.parameters)) {
      return t;
    }

    // LangChain StructuredTool / DynamicStructuredTool
    // They have `.schema` (Zod), `.description`, and `.invoke(input)`
    // AI SDK v6 uses `inputSchema` (not `parameters`) for the Zod schema
    if (t?.schema && (typeof t.invoke === "function" || typeof t._call === "function")) {
      return tool({
        description: t.description || `Tool: ${t.name}`,
        inputSchema: t.schema as z.ZodObject<any>,
        execute: async (args: any) => {
          try {
            const result = await t.invoke(args);
            return typeof result === "string" ? result : JSON.stringify(result);
          } catch (err: any) {
            logger.warn(`Tool ${t.name} failed: ${err.message}`);
            return `Error: ${err.message}`;
          }
        },
      });
    }

    // Unknown format — pass through and hope for the best
    logger.warn(`Tool "${t?.name || "unknown"}" has unknown format, passing through`);
    return t;
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
    const result = await generateText({
      model: this.model,
      output: Output.object({ schema: this.outputSchema! }),
      messages: this.buildMessages(),
      ...(this.definition.systemPrompt
        ? { system: this.definition.systemPrompt }
        : {}),
      maxRetries: 5,
    });

    const structuredOutput = result.output;
    const responseStr =
      typeof structuredOutput === "string" ? structuredOutput : JSON.stringify(structuredOutput, null, 2);

    logger.info(`AiSdkAgent ${this.id} structured response (${responseStr.length} chars)`);
    logger.debug(`AiSdkAgent ${this.id} response: ${responseStr.slice(0, 500)}${responseStr.length > 500 ? '...' : ''}`);

    this.messages.push({ role: "assistant", content: responseStr });
    this.addToHistory("assistant", responseStr);

    yield this.messageEvent(responseStr);
    yield this.doneEvent(structuredOutput, `${this.name} completed successfully`);

    this.setStatus("idle");

    if (input.taskId) {
      this._emitter.emit("task:complete", {
        agentId: this.id,
        taskId: input.taskId,
        output: structuredOutput,
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

    // Build provider options for extended thinking/reasoning
    const providerOptions = this.buildProviderOptions();

    // Build stop conditions: autonomous by default, with safety caps
    const stopConditions: StopCondition<ToolSet>[] = [];
    if (this.maxSteps > 0) {
      // Explicit step limit configured
      stopConditions.push(stepCountIs(this.maxSteps));
    } else {
      // Autonomous mode: run until model naturally stops + safety cap
      stopConditions.push(isLoopFinished());
      stopConditions.push(stepCountIs(200)); // absolute safety cap
    }
    // Terminal acceptance: stop ONLY when a lifecycle tool's call was
    // accepted by orchestration (markTerminated was called). This replaces
    // the older hasToolCall("complete_task") / hasToolCall("bounce_task")
    // stops which fired the moment the tool was INVOKED, even if the tool
    // returned an error. With this, a rejected complete_task lets the LLM
    // see the error string, follow the recovery instructions, and call
    // again — the loop only exits on a genuinely accepted call.
    //
    // Reset the state at the start of each turn so a previous run's
    // termination doesn't short-circuit this one.
    this.terminationState.kind = null;
    stopConditions.push(() => this.terminationState.kind !== null);

    const agentId = this.id;

    const result = await streamText({
      model: this.model,
      messages: this.buildMessages(),
      ...(this.definition.systemPrompt
        ? { system: this.definition.systemPrompt }
        : {}),
      ...(hasTools ? { tools: this.loadedTools, stopWhen: stopConditions } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined ? { maxTokens: this.maxTokens } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      // Increase retries for transient errors (429, 5xx). AI SDK uses exponential backoff.
      maxRetries: 5,

      // --- prepareStep: Context management for long-running autonomous loops ---
      prepareStep: async ({ stepNumber, messages }) => {
        // Trim context when conversation grows too long to prevent context window overflow
        if (messages.length > 50) {
          const first = messages[0]!;
          const recent = messages.slice(-30);
          logger.info(`AiSdkAgent ${agentId} trimming context: ${messages.length} messages → keeping first + last 30`);
          return {
            messages: [first, ...recent] as ModelMessage[],
          };
        }
        return {};
      },

      // --- Lifecycle callbacks for observability ---
      onStepFinish: ({ finishReason, usage }) => {
        logger.info(`AiSdkAgent ${agentId} step finished: ${finishReason} (tokens: ${(usage as any)?.totalTokens ?? '?'})`);
      },
      experimental_onToolCallStart: ({ toolCall }: any) => {
        logger.debug(`AiSdkAgent ${agentId} tool start: ${toolCall?.toolName}`);
      },
      experimental_onToolCallFinish: ({ toolCall, durationMs, success }: any) => {
        logger.info(`AiSdkAgent ${agentId} tool done: ${toolCall?.toolName} (${durationMs}ms, ${success ? 'ok' : 'fail'})`);
      },
    });

    let fullText = "";
    let partCount = 0;
    let stepIndex = 0;
    let textPartId = "";
    let reasoningPartId = "";
    const messageId = `msg-${this.id}-${Date.now()}`;
    const smoothStream = new SmoothStream();

    // Emit stream start
    yield { type: "stream_part", part: { type: "start", messageId } } as AgentEvent;

    // Iterate fullStream and yield AgentEvents + stream_part events
    for await (const part of result.fullStream) {
      partCount++;
      if (partCount <= 3 || partCount % 50 === 0) {
        logger.debug(`AiSdkAgent ${this.id} stream part #${partCount}: ${part.type}`);
      }
      switch (part.type as string) {
        case "text-delta": {
          const delta = (part as any).text ?? (part as any).textDelta ?? "";
          if (!textPartId) {
            textPartId = `text-${messageId}-${partCount}`;
          }
          fullText += delta;
          // Buffer at word boundaries for smooth UX
          const smoothed = smoothStream.push(delta);
          if (smoothed) {
            yield { type: "stream_part", part: { type: "text-delta", id: textPartId, delta: smoothed } } as AgentEvent;
          }
          break;
        }

        case "step-start": {
          // Close any open text part from previous step
          if (textPartId) {
            yield { type: "stream_part", part: { type: "text-end", id: textPartId } } as AgentEvent;
            textPartId = "";
          }
          if (reasoningPartId) {
            yield { type: "stream_part", part: { type: "reasoning-end", id: reasoningPartId } } as AgentEvent;
            reasoningPartId = "";
          }
          yield { type: "stream_part", part: { type: "start-step", stepIndex } } as AgentEvent;
          break;
        }

        case "step-finish": {
          if (textPartId) {
            yield { type: "stream_part", part: { type: "text-end", id: textPartId } } as AgentEvent;
            textPartId = "";
          }
          if (reasoningPartId) {
            yield { type: "stream_part", part: { type: "reasoning-end", id: reasoningPartId } } as AgentEvent;
            reasoningPartId = "";
          }
          yield { type: "stream_part", part: {
            type: "finish-step",
            stepIndex,
            finishReason: (part as any).finishReason || "unknown",
          } } as AgentEvent;
          stepIndex++;
          break;
        }

        case "tool-call-streaming-start": {
          const toolCallId = (part as any).toolCallId || `tc-${partCount}`;
          const toolName = (part as any).toolName || "unknown";
          yield { type: "stream_part", part: {
            type: "tool-input-start", toolCallId, toolName,
          } } as AgentEvent;
          break;
        }

        case "tool-call-delta": {
          const tcId = (part as any).toolCallId || "";
          const argsDelta = (part as any).argsTextDelta || "";
          yield { type: "stream_part", part: {
            type: "tool-input-delta", toolCallId: tcId, delta: argsDelta,
          } } as AgentEvent;
          break;
        }

        case "tool-call": {
          const toolName = (part as any).toolName;
          const toolArgs = (part as any).input ?? (part as any).args ?? {};
          const toolCallId = (part as any).toolCallId || `tc-${toolName}-${partCount}`;
          logger.info(`AiSdkAgent ${this.id} tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`);
          yield { type: "stream_part", part: {
            type: "tool-input-available", toolCallId, toolName, input: toolArgs,
          } } as AgentEvent;
          // Also emit legacy tool_start for progress channel
          yield this.toolStartEvent(toolName, toolArgs as Record<string, any>);
          break;
        }

        case "tool-result": {
          const resultToolName = (part as any).toolName;
          const toolOutput = (part as any).output ?? (part as any).result;
          const resultCallId = (part as any).toolCallId || `tc-${resultToolName}`;
          const outputStr = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);
          logger.info(`AiSdkAgent ${this.id} tool result: ${resultToolName} → ${outputStr.slice(0, 200)}${outputStr.length > 200 ? '...' : ''}`);
          yield { type: "stream_part", part: {
            type: "tool-output-available", toolCallId: resultCallId, toolName: resultToolName, output: toolOutput,
          } } as AgentEvent;
          // Also emit legacy tool_result for progress channel
          yield this.toolResultEvent(resultToolName, toolOutput);
          break;
        }

        case "reasoning": {
          const reasoningDelta = (part as any).textDelta ?? (part as any).delta ?? (part as any).text ?? "";
          if (!reasoningPartId) {
            reasoningPartId = `reasoning-${messageId}-${partCount}`;
            yield { type: "stream_part", part: { type: "reasoning-start", id: reasoningPartId } } as AgentEvent;
          }
          yield { type: "stream_part", part: { type: "reasoning-delta", id: reasoningPartId, delta: reasoningDelta } } as AgentEvent;
          // Also emit legacy thinking for progress channel
          yield { type: "thinking", content: reasoningDelta };
          break;
        }

        case "error":
          yield { type: "stream_part", part: { type: "error", error: (part as any).error?.message || String((part as any).error) } } as AgentEvent;
          throw new Error(
            (part as any).error?.message || String((part as any).error) || "Stream error",
          );

        default:
          break;
      }
    }

    // Flush remaining buffered text from SmoothStream
    const remaining = smoothStream.forceFlush();
    if (remaining && textPartId) {
      yield { type: "stream_part", part: { type: "text-delta", id: textPartId, delta: remaining } } as AgentEvent;
    }

    // Close any open reasoning part (text is finalized by the finish event)
    if (reasoningPartId) {
      yield { type: "stream_part", part: { type: "reasoning-end", id: reasoningPartId } } as AgentEvent;
    }

    // Log token usage if available
    try {
      const usage = await result.usage;
      if (usage) {
        logger.info(`AiSdkAgent ${this.id} tokens: prompt=${(usage as any).promptTokens}, completion=${(usage as any).completionTokens}, total=${(usage as any).totalTokens}`);
      }
    } catch { /* usage not available */ }

    // Store full response messages (including tool calls/results) in conversation history
    logger.info(`AiSdkAgent ${this.id} stream complete: ${partCount} parts, ${fullText.length} chars`);
    if (fullText) {
      logger.debug(`AiSdkAgent ${this.id} response: ${fullText.slice(0, 500)}${fullText.length > 500 ? '...' : ''}`);
    }
    try {
      const response = await result.response;
      if (response.messages?.length) {
        this.messages.push(...response.messages);
        logger.debug(`AiSdkAgent ${this.id} stored ${response.messages.length} response messages (including tool calls/results)`);
      } else if (fullText) {
        // Fallback: store as simple assistant message if response.messages unavailable
        this.messages.push({ role: "assistant", content: fullText });
      }
    } catch {
      // Fallback: store as simple assistant message
      if (fullText) {
        this.messages.push({ role: "assistant", content: fullText });
      }
    }
    if (fullText) {
      this.addToHistory("assistant", fullText);
    }

    // Emit stream finish
    yield { type: "stream_part", part: { type: "finish", finishReason: "stop" } } as AgentEvent;

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

  // ─────────────────────────────────────────────────────────────────────────
  // IStreamingAgent — runWithHooks
  //
  // Phase 1.5 of the agent-stream-bus refactor. Drives the existing
  // `execute()` generator and translates AgentEvents into hook calls so the
  // visitor-based pipeline gets the same data the legacy callbacks see.
  //
  // Strangler approach: the existing `execute()` generator path is
  // UNCHANGED. WorkerPool, OrchestratorService, and AgentManager continue
  // to consume it. Phase 1.7/1.8 will switch callers to `runWithHooks()`,
  // and Phase 1.11 will retire the generator path.
  //
  // Back-pressure contract (matches StreamingHooks docstring):
  //   - `onStart`, `onChunk`, `onStepFinish` are FIRE-AND-FORGET. We invoke
  //     them but do NOT await — a slow visitor must not stall token flow.
  //     `safeHookAsync()` schedules the call and isolates errors.
  //   - `onFinish` and `onError` ARE AWAITED so persistence/cleanup
  //     completes before `runWithHooks()` returns or throws.
  //
  // Structured-mode agents (builders) are explicitly rejected here — they
  // use `generateText()` not `streamText()` and have no chunk stream. Use
  // the legacy `run(prompt)` helper for builders until Phase 1.7/1.8.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Mark this agent's current run as terminated. Called by the lifecycle
   * tools (or their orchestration hooks) when `complete_task` or
   * `bounce_task` has been ACCEPTED — i.e. the orchestrator has confirmed
   * the call should end the loop.
   *
   * The streamText `stopWhen` reads `terminationState` so the loop only
   * exits on accepted termination. A rejected `complete_task` (e.g.
   * missing report doc) does NOT call this, letting the LLM see the
   * rejection error and self-correct in the next step.
   */
  markTerminated(kind: "complete" | "bounce"): void {
    this.terminationState.kind = kind;
  }

  /**
   * Read the current termination state. Useful for tests / diagnostics.
   * `null` means the agent has not yet accepted a terminal call this run.
   */
  getTerminationState(): "complete" | "bounce" | null {
    return this.terminationState.kind;
  }

  async runWithHooks(input: AgentRunInput): Promise<AgentRunResult> {
    if (this.isStructuredMode) {
      throw new Error(
        `AiSdkAgent ${this.id}: runWithHooks() is not supported in structured-output mode. ` +
        `Use run(prompt) for builders. (Phase 1.5 strangler limitation.)`,
      );
    }

    const ctx = input.context;
    const hooks = this.onStreaming;

    // Per-step accumulation for synthesising onStepFinish from chunk events.
    let stepIndex = 0;
    let stepText = "";
    const stepToolCalls: AgentStepInfo["toolCalls"] = [];
    const stepToolResults: AgentStepInfo["toolResults"] = [];

    // Final-result accumulators.
    let fullText = "";
    let doneOutput: unknown;
    const allToolCalls: NonNullable<AgentRunResult["toolCalls"]> = [];

    // Hooks are invoked directly. The `AgentRuntimeFactory.composeStreamingHooks`
    // composer is the SOLE isolation layer (May 9 2026 — debt patch #8): it
    // wraps each visitor in its own try/catch and attaches `.catch()` to any
    // promise-like return from fire-and-forget hooks. Composed hooks return
    // void synchronously for `onStart`/`onChunk`/`onStepFinish` and resolve
    // cleanly for `onFinish`/`onError` even when individual visitors throw.
    //
    // Callers wiring custom (non-composed) hooks are responsible for their
    // own error handling — see the StreamingHooks contract docstring.

    // FIRE-AND-FORGET — schedule but don't block on onStart.
    hooks?.onStart?.(ctx);

    let runError: Error | null = null;
    let finishReason: string | undefined;

    try {
      for await (const event of this.execute({
        message: input.message,
        threadId: ctx.threadId ?? ctx.taskId ?? `${this.id}-${Date.now()}`,
        taskId: ctx.taskId,
      })) {
        if (event.type === "stream_part") {
          const part = event.part as StreamPart;

          // Update accumulators that feed onStepFinish + onFinish.
          this.accumulatePartForStep(
            part,
            (delta) => {
              stepText += delta;
              fullText += delta;
            },
            stepToolCalls!,
            stepToolResults!,
            allToolCalls,
          );

          // FIRE-AND-FORGET — token flow must not block on visitors.
          hooks?.onChunk?.(part, ctx);

          if (part.type === "finish-step") {
            const usage = (part as any).usage as AgentStepInfo["usage"];
            const step: AgentStepInfo = {
              stepIndex,
              finishReason: (part as any).finishReason,
              text: stepText || undefined,
              toolCalls: stepToolCalls!.length ? [...stepToolCalls!] : undefined,
              toolResults: stepToolResults!.length ? [...stepToolResults!] : undefined,
              usage,
            };
            // FIRE-AND-FORGET.
            hooks?.onStepFinish?.(step, ctx);
            stepIndex += 1;
            stepText = "";
            stepToolCalls!.length = 0;
            stepToolResults!.length = 0;
          }

          if (part.type === "finish") {
            finishReason = (part as any).finishReason;
          }
        } else if (event.type === "done") {
          // Generator's terminal event carries the full output payload (e.g.
          // `{ response: fullText }` for tool mode). We capture it so callers
          // get the same shape they'd get from the legacy run() helper.
          if (event.output !== undefined) {
            doneOutput = event.output;
            // Guard against generators that omit text deltas but still
            // produce a `done.output.response` string.
            if (!fullText && typeof (event.output as any)?.response === "string") {
              fullText = (event.output as any).response;
            }
          }
        } else if (event.type === "message" && !fullText) {
          // Some generator paths only yield a final `message` (no deltas).
          if (typeof event.content === "string") {
            fullText = event.content;
          }
        } else if (event.type === "error") {
          runError = new Error(event.error);
        }
      }
    } catch (err) {
      runError = err instanceof Error ? err : new Error(String(err));
    }

    if (runError) {
      // AWAITED — cleanup must complete before throwing. Composed onError
      // resolves cleanly even when individual visitors reject.
      await hooks?.onError?.(runError, ctx);
      throw runError;
    }

    const result: AgentRunResult = {
      text: fullText,
      finishReason,
      responseMessages: this.messages.slice(-1), // best-effort; agent already pushed
      toolCalls: allToolCalls.length ? allToolCalls : undefined,
      output: doneOutput,
    };

    // AWAITED — persistence must complete before returning.
    await hooks?.onFinish?.(result, ctx);

    return result;
  }

  /** Update step accumulators based on a single stream part. */
  private accumulatePartForStep(
    part: StreamPart,
    appendText: (delta: string) => void,
    stepToolCalls: NonNullable<AgentStepInfo["toolCalls"]>,
    stepToolResults: NonNullable<AgentStepInfo["toolResults"]>,
    allToolCalls: NonNullable<AgentRunResult["toolCalls"]>,
  ): void {
    switch (part.type) {
      case "text-delta": {
        const delta = (part as any).delta as string | undefined;
        if (delta) appendText(delta);
        break;
      }
      case "tool-input-available": {
        const toolCallId = (part as any).toolCallId as string;
        const toolName = (part as any).toolName as string;
        const args = (part as any).input;
        stepToolCalls.push({ toolCallId, toolName, args });
        allToolCalls.push({ toolCallId, toolName, args });
        break;
      }
      case "tool-output-available": {
        const toolCallId = (part as any).toolCallId as string;
        const toolName = (part as any).toolName as string | undefined;
        const result = (part as any).output;
        stepToolResults.push({ toolCallId, toolName, result });
        // Attach the result onto the matching tool call in allToolCalls.
        const target = allToolCalls.find((c) => c.toolCallId === toolCallId);
        if (target) target.result = result;
        break;
      }
      default:
        // Other parts (start, step boundaries, reasoning, finish) don't
        // contribute to the per-step accumulators.
        break;
    }
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
   * Build provider-specific options for extended thinking/reasoning.
   * - Anthropic: thinking tokens with budget (claude-sonnet-4, etc.)
   * - OpenAI/Azure: reasoningEffort for o-series models (o1, o3, o3-mini, o4-mini)
   */
  private buildProviderOptions(): Record<string, any> | undefined {
    if (!this.thinking?.enabled) return undefined;

    const config = this.definition.config as InternalConfig;
    const provider = config.model?.provider;

    switch (provider) {
      case "anthropic":
        return {
          anthropic: {
            thinking: { type: "enabled" as const, budgetTokens: this.thinking.budgetTokens ?? 10000 },
          },
        };

      case "openai":
      case "azure-openai":
        return {
          openai: {
            reasoningEffort: this.thinking.reasoningEffort ?? "medium",
          },
        };

      default:
        logger.warn(`AiSdkAgent ${this.id}: thinking not supported for provider "${provider}"`);
        return undefined;
    }
  }

  /**
   * Build the messages array for this call (conversation history + new message).
   * The new user message is already appended to this.messages before this runs.
   * Returns full ModelMessage[] to preserve tool calls/results between continuations.
   */
  private buildMessages(): Array<ModelMessage> {
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
