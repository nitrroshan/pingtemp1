/**
 * ChatAgent — Persistent per-role L2 agent.
 *
 * Step 1: Reads tasks from TaskStore (no local cache).
 * Step 2: LLM chat loop — user can talk to a role agent with read-only tools.
 *
 * See: docs/features/chat-agent-layer/feature_architecture.md
 */

import { z } from "zod";
import type { Task, TaskStatus } from "../memory/types/Task.types.js";
import type { TaskStore } from "../orchestrator/TaskStore.js";
import type { TaskUpdate } from "../types/TaskUpdate.js";
import { AiSdkAgent } from "../agent/internal/AiSdkAgent.js";
import type { AgentDefinition, AgentEvent, InternalConfig } from "../agent/types.js";
import { rootLogger } from "../logging.js";

const log = rootLogger.child({ module: "ChatAgent" });

export interface ChatAgentConfig {
  role: string;
  teamId: string;
  taskStore: TaskStore;
  /** Model config override — if not set, uses default from MODEL_ID env */
  modelConfig?: { provider: string; model?: string; deployment?: string };
}

/**
 * Persistent per-role Chat Agent (L2).
 *
 * Uses the same AiSdkAgent class as Planner and Workers (unified agent model).
 * The only difference is configuration: mode = "session", read-only tools.
 */
export class ChatAgent {
  readonly role: string;
  readonly teamId: string;
  private readonly taskStore: TaskStore;
  private agent: AiSdkAgent | null = null;
  private initialized = false;

  /** Channel B event threads per task — append-only log */
  private threads = new Map<string, TaskUpdate[]>();

  constructor(config: ChatAgentConfig) {
    this.role = config.role.toLowerCase();
    this.teamId = config.teamId;
    this.taskStore = config.taskStore;

    // Subscribe to role-filtered task events
    this.taskStore.onRoleEvent(this.role, "ready", (task) => this.onMyTaskReady(task));
    this.taskStore.onRoleEvent(this.role, "completed", (task) => this.onMyTaskCompleted(task));
    this.taskStore.onRoleEvent(this.role, "failed", (task) => this.onMyTaskFailed(task));

    log.info(`ChatAgent created for role '${this.role}' in team '${this.teamId}'`);
  }

  // ─── Initialization ────────────────────────────────────────────────

  /**
   * Lazy-initialize the LLM agent. Called on first message.
   */
  private async ensureAgent(): Promise<AiSdkAgent> {
    if (this.agent && this.initialized) return this.agent;

    const config: InternalConfig = {
      model: { provider: "azure-openai", deployment: "gpt-4o-2" },
      maxSteps: 5,
      tools: [],
    };

    const definition: AgentDefinition = {
      id: `chat-${this.role}`,
      name: `Chat Agent (${this.role})`,
      role: this.role,
      type: "internal",
      description: `Persistent chat agent for the ${this.role} role. Can answer questions about tasks, workspace, and role knowledge.`,
      goal: `Help the user understand what the ${this.role} role is working on, answer questions, and provide status updates.`,
      systemPrompt: this.buildSystemPrompt(),
      config,
    };

    this.agent = new AiSdkAgent(definition);
    await this.agent.initialize();

    // Set read-only tools
    await this.agent.setTools(this.buildTools());

    this.initialized = true;
    log.info(`ChatAgent LLM initialized for role '${this.role}'`);
    return this.agent;
  }

  private buildSystemPrompt(): string {
    return [
      `You are the ${this.role} Chat Agent — the persistent representative of the "${this.role}" role in this team.`,
      ``,
      `Your job is to:`,
      `- Answer questions about your tasks, their status, and deliverables`,
      `- Provide context about what you've been working on`,
      `- Help the user understand your role's progress`,
      ``,
      `You have read-only tools to check your tasks and their details.`,
      `You CANNOT modify the workspace or execute tasks — if the user asks you to do work, explain that tasks need to go through the Planner.`,
      ``,
      `Always be concise, direct, and grounded in your actual task data. Use the get_my_tasks tool to check your current state before answering task questions.`,
    ].join("\n");
  }

  private buildTools(): any[] {
    const taskStore = this.taskStore;
    const role = this.role;

    return [
      {
        name: "get_my_tasks",
        description: "Get all tasks assigned to your role with their current status",
        schema: z.object({}),
        invoke: async () => {
          const tasks = taskStore.getByRole(role);
          if (tasks.length === 0) return "No tasks assigned to this role.";
          return tasks.map(t =>
            `[${t.status}] ${t.id}: ${t.description?.slice(0, 100) || t.id}`
          ).join("\n");
        },
      },
      {
        name: "get_task_detail",
        description: "Get detailed information about a specific task",
        schema: z.object({
          taskId: z.string().describe("The task ID to look up"),
        }),
        invoke: async (args: { taskId: string }) => {
          const task = taskStore.get(args.taskId);
          if (!task) return `Task '${args.taskId}' not found.`;
          if (task.assigned_role !== role) return `Task '${args.taskId}' is not assigned to your role.`;
          return JSON.stringify({
            id: task.id,
            status: task.status,
            description: task.description,
            output: task.output?.slice(0, 500),
            priority: task.priority,
            prerequisites: task.prerequisites ? Object.fromEntries(task.prerequisites) : {},
          }, null, 2);
        },
      },
      {
        name: "get_role_summary",
        description: "Get a summary of your role's overall progress",
        schema: z.object({}),
        invoke: async () => {
          const tasks = taskStore.getByRole(role);
          const byStatus: Record<string, number> = {};
          for (const t of tasks) {
            byStatus[t.status] = (byStatus[t.status] || 0) + 1;
          }
          return JSON.stringify({
            role,
            totalTasks: tasks.length,
            byStatus,
            activeTasks: tasks.filter(t => t.status === "in_progress").map(t => t.id),
            completedTasks: tasks.filter(t => t.status === "completed").map(t => t.id),
          }, null, 2);
        },
      },
    ];
  }

  // ─── Chat (Step 2) ─────────────────────────────────────────────────

  /**
   * Handle a user message — returns an async generator of AgentEvents.
   * Same streaming interface as Planner/Worker (unified agent model).
   */
  async *handleUserMessage(content: string): AsyncGenerator<AgentEvent> {
    const agent = await this.ensureAgent();
    const input = { message: content, threadId: `chat-${this.role}` };
    yield* agent.execute(input);
  }

  // ─── Task Queries (Step 1) ─────────────────────────────────────────

  getMyTasks(): Task[] {
    return this.taskStore.getByRole(this.role);
  }

  getMyTasksByStatus(status: TaskStatus): Task[] {
    return this.getMyTasks().filter(t => t.status === status);
  }

  getSnapshot(): ChatAgentSnapshot {
    const tasks = this.getMyTasks();
    return {
      role: this.role,
      teamId: this.teamId,
      taskCount: tasks.length,
      byStatus: {
        pending: tasks.filter(t => t.status === "pending").length,
        ready: tasks.filter(t => t.status === "ready").length,
        in_progress: tasks.filter(t => t.status === "in_progress").length,
        completed: tasks.filter(t => t.status === "completed").length,
        failed: tasks.filter(t => t.status === "failed").length,
      },
      tasks,
    };
  }

  // ─── Channel B (Task Updates) ───────────────────────────────────

  /**
   * Ingest a Channel B TaskUpdate event from a worker.
   * Appends to per-task thread log. Used for R1 chat context + future planner summaries.
   */
  ingestTaskUpdate(update: TaskUpdate): void {
    const thread = this.threads.get(update.taskId) || [];
    thread.push(update);
    this.threads.set(update.taskId, thread);
    log.debug(`[${this.role}] TaskUpdate: ${update.type} for ${update.taskId}`);
  }

  /**
   * Get Channel B event thread for a specific task.
   */
  getTaskThread(taskId: string): TaskUpdate[] {
    return this.threads.get(taskId) || [];
  }

  /**
   * Get all task threads.
   */
  getAllThreads(): Record<string, TaskUpdate[]> {
    return Object.fromEntries(this.threads);
  }

  // ─── Role-filtered event handlers ──────────────────────────────────

  private onMyTaskReady(task: Task): void {
    log.debug(`[${this.role}] Task ready: ${task.id} — ${task.description?.slice(0, 60)}`);
  }

  private onMyTaskCompleted(task: Task): void {
    log.debug(`[${this.role}] Task completed: ${task.id}`);
  }

  private onMyTaskFailed(task: Task): void {
    log.debug(`[${this.role}] Task failed: ${task.id}`);
  }

  dispose(): void {
    log.info(`ChatAgent disposed for role '${this.role}'`);
    this.agent = null;
    this.initialized = false;
  }
}

export interface ChatAgentSnapshot {
  role: string;
  teamId: string;
  taskCount: number;
  byStatus: Record<string, number>;
  tasks: Task[];
}
