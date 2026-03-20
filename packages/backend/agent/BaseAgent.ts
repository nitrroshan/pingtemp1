/**
 * BaseAgent - Abstract base class for all agent implementations
 *
 * Provides shared functionality:
 * - TaskList management
 * - Status tracking
 * - Conversation history
 * - Event emission
 */

import { EventEmitter } from "events";
import { TaskList } from "./TaskList.js";
import type {
  IAgent,
  ITaskList,
  AgentType,
  AgentStatus,
  AgentInput,
  AgentEvent,
  AgentDefinition,
  Task,
  Message,
} from "./types.js";

export abstract class BaseAgent implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly type: AgentType;
  readonly role: string;
  readonly definition: AgentDefinition;

  protected _status: AgentStatus = "idle";
  protected _tasks: TaskList = new TaskList();
  protected _conversationHistory: Message[] = [];
  protected _emitter: EventEmitter = new EventEmitter();

  constructor(definition: AgentDefinition) {
    this.definition = definition;
    this.id = definition.id;
    this.name = definition.name;
    this.type = definition.type;
    this.role = definition.role;

    // Forward task events
    this._tasks.on("task:added", (task) =>
      this._emitter.emit("task:added", { agentId: this.id, task }),
    );
    this._tasks.on("task:started", (task) =>
      this._emitter.emit("task:started", { agentId: this.id, task }),
    );
    this._tasks.on("task:completed", (task) =>
      this._emitter.emit("task:completed", { agentId: this.id, task }),
    );
    this._tasks.on("task:failed", (task) =>
      this._emitter.emit("task:failed", { agentId: this.id, task }),
    );
  }

  // ==========================================================================
  // IAgent Implementation
  // ==========================================================================

  get tasks(): ITaskList {
    return this._tasks;
  }

  assignTask(task: Omit<Task, "status" | "assignedAt">): void {
    this._tasks.add({
      ...task,
      status: "pending",
      assignedAt: new Date(),
    } as Task);
  }

  getActiveTasks(): Task[] {
    return [...this._tasks.pending(), ...this._tasks.inProgress()];
  }

  completeTask(taskId: string, output: any): void {
    this._tasks.complete(taskId, output);
  }

  failTask(taskId: string, error: string): void {
    this._tasks.fail(taskId, error);
  }

  getStatus(): AgentStatus {
    return this._status;
  }

  getConversation(): Message[] {
    return [...this._conversationHistory];
  }

  /**
   * Abstract method - must be implemented by subclasses
   */
  abstract execute(input: AgentInput): AsyncGenerator<AgentEvent>;

  /**
   * Initialize the agent with model provider and tools
   */
  abstract initialize(): Promise<void>;

  /**
   * Wait until agent is ready
   */
  async waitUntilReady(): Promise<void> {
    // Default implementation - subclasses can override
    if (this._status === "idle") {
      await this.initialize();
    }
  }

  /**
   * Stop agent execution
   */
  async stop(): Promise<void> {
    this._status = "stopped";
    this._emitter.emit("stopped", { agentId: this.id });
  }

  /**
   * Reset agent to initial state
   */
  async reset(): Promise<void> {
    this._status = "idle";
    this._conversationHistory = [];
    this._emitter.emit("reset", { agentId: this.id });
  }

  // ==========================================================================
  // Conversation Management
  // ==========================================================================

  protected addToHistory(
    role: "user" | "assistant" | "system",
    content: string,
  ): void {
    this._conversationHistory.push({ role, content });
  }

  protected getHistory(): Array<{ role: string; content: string }> {
    return [...this._conversationHistory];
  }

  protected clearHistory(): void {
    this._conversationHistory = [];
  }

  // ==========================================================================
  // Status Management
  // ==========================================================================

  protected setStatus(status: AgentStatus): void {
    const previous = this._status;
    this._status = status;
    this._emitter.emit("status:changed", {
      agentId: this.id,
      previous,
      current: status,
    });
  }

  // ==========================================================================
  // Event Methods
  // ==========================================================================

  on(event: string, handler: Function): void {
    this._emitter.on(event, handler as any);
  }

  off(event: string, handler: Function): void {
    this._emitter.off(event, handler as any);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  protected *emitEvent(event: AgentEvent): Generator<AgentEvent> {
    this._emitter.emit("event", event);
    yield event;
  }

  /**
   * Create a thinking event
   */
  protected thinkingEvent(content: string): AgentEvent {
    return { type: "thinking", content };
  }

  /**
   * Create a message event
   */
  protected messageEvent(content: string, streaming?: boolean): AgentEvent {
    const event: AgentEvent = { type: "message", content };
    if (streaming !== undefined) {
      (event as any).streaming = streaming;
    }
    return event;
  }

  /**
   * Create a tool start event
   */
  protected toolStartEvent(
    tool: string,
    args: Record<string, any>,
  ): AgentEvent {
    return { type: "tool_start", tool, args };
  }

  /**
   * Create a tool result event
   */
  protected toolResultEvent(
    tool: string,
    result: any,
    error?: string,
  ): AgentEvent {
    const event: AgentEvent = { type: "tool_result", tool, result };
    if (error !== undefined) {
      (event as any).error = error;
    }
    return event;
  }

  /**
   * Create a done event
   */
  protected doneEvent(output?: any, summary?: string): AgentEvent {
    const event: AgentEvent = { type: "done" };
    if (output !== undefined) {
      (event as any).output = output;
    }
    if (summary !== undefined) {
      (event as any).summary = summary;
    }
    return event;
  }

  /**
   * Create an error event
   */
  protected errorEvent(
    error: string,
    recoverable: boolean = false,
  ): AgentEvent {
    return { type: "error", error, recoverable };
  }
}
