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
  goalId?: string;
  taskStore: TaskStore;
  /** Model config override — if not set, uses default from MODEL_ID env */
  modelConfig?: { provider: string; model?: string; deployment?: string };
  /** Callback to dispatch a task to a worker (calls OrchestratorService.dispatchTask) */
  onDispatchTask?: (taskId: string, role: string) => Promise<void>;
  /** Callback to send a message to the planner through OrchestratorService.notifyPlanner */
  onNotifyPlanner?: (message: string) => void;
  /** Callback to load prior conversation for context restoration on restart */
  loadConversation?: () => Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>>;
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
  readonly goalId?: string;
  private readonly taskStore: TaskStore;
  private agent: AiSdkAgent | null = null;
  private initialized = false;

  /** Channel B event threads per task — append-only log */
  private threads = new Map<string, TaskUpdate[]>();

  /** Step 4: Worker dispatch state */
  private mode: 'auto' | 'review' | 'manual' = 'auto';
  private maxConcurrentWorkers = 2;
  private active = new Set<string>();
  private queue: Array<{ taskId: string; role: string }> = [];
  private onDispatchTask?: (taskId: string, role: string) => Promise<void>;
  private onNotifyPlanner?: (message: string) => void;
  private loadConversation?: () => Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>>;

  /** Accumulated role context from completed tasks — used for R1 chat grounding */
  private roleContext = "";

  constructor(config: ChatAgentConfig) {
    this.role = config.role.toLowerCase();
    this.teamId = config.teamId;
    this.goalId = config.goalId;
    this.taskStore = config.taskStore;
    this.onDispatchTask = config.onDispatchTask;
    this.onNotifyPlanner = config.onNotifyPlanner;
    this.loadConversation = config.loadConversation;

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

    // Restore conversation context from database (if available)
    if (this.loadConversation) {
      try {
        const priorMessages = await this.loadConversation();
        if (priorMessages.length > 0) {
          this.agent.loadMessages(priorMessages);
          log.info(`[${this.role}] Restored ${priorMessages.length} messages from database`);
        }
      } catch (err) {
        log.warn(`[${this.role}] Failed to load conversation history: ${err}`);
        // Continue without history — agent starts fresh
      }
    }

    this.initialized = true;
    log.info(`ChatAgent LLM initialized for role '${this.role}'`);
    return this.agent;
  }

  private buildSystemPrompt(): string {
    const parts = [
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
    ];

    // Inject accumulated role context from completed tasks
    if (this.roleContext) {
      parts.push(``, `## What you've done so far:`, this.roleContext);
    }

    // Inject recent activity from threads
    const recentActivity = this.getRecentActivity(10);
    if (recentActivity) {
      parts.push(``, `## Recent activity:`, recentActivity);
    }

    return parts.join("\n");
  }

  /**
   * Get a human-readable summary of recent Channel B events across all threads.
   */
  private getRecentActivity(maxEvents: number): string {
    const allEvents: Array<{ ts: number; text: string }> = [];
    for (const [taskId, thread] of this.threads) {
      for (const update of thread.slice(-5)) {
        const text = update.type === "completed" ? `✅ ${taskId}: ${update.summary?.slice(0, 100) || 'done'}`
          : update.type === "failed" ? `❌ ${taskId}: ${update.error || 'failed'}`
          : update.type === "started" ? `▶ ${taskId}: Started`
          : update.type === "tool_milestone" ? `◆ ${taskId}: ${update.tool} — ${update.summary?.slice(0, 80) || ''}`
          : update.type === "progress" ? `◇ ${taskId}: ${update.note || ''}`
          : update.type === "blocked" ? `🚫 ${taskId}: ${(update as any).reason || 'blocked'}`
          : null;
        if (text) allEvents.push({ ts: update.ts, text });
      }
    }
    if (allEvents.length === 0) return "";
    return allEvents
      .sort((a, b) => a.ts - b.ts)
      .slice(-maxEvents)
      .map(e => `- ${e.text}`)
      .join("\n");
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
    // Refresh system prompt with latest roleContext + thread activity
    agent.definition.systemPrompt = this.buildSystemPrompt();
    const input = { message: content, threadId: `chat-${this.role}` };
    yield* agent.execute(input);
  }

  // ─── Task Queries (Step 1) ─────────────────────────────────────────

  getMyTasks(): Task[] {
    if (this.goalId) {
      return this.taskStore.getByGoal(this.goalId)
        .filter(t => t.assigned_role === this.role);
    }
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

    // Gap B: Reactions by type
    switch (update.type) {
      case "completed":
        // Promote key outputs to role context (for R1 chat grounding)
        this.roleContext += `\n- ${update.taskId}: ${update.summary?.slice(0, 200) || 'done'}`;
        break;
      case "failed":
        // Escalate to planner with role context (Gap D)
        this.onNotifyPlanner?.(`[${this.role}] Task ${update.taskId} failed: ${update.error || 'unknown error'}`);
        break;
      case "blocked":
        this.onNotifyPlanner?.(`[${this.role}] Task ${update.taskId} blocked: ${(update as any).reason || 'unknown'}`);
        break;
    }

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

  // ─── Step 4: Worker Dispatch ─────────────────────────────────────

  /**
   * Handle a ready task — dispatch a worker based on mode.
   * Called by OrchestratorService when FF_ENABLE_CHAT_AGENT_DISPATCH is on.
   */
  async handleTask(taskId: string, role: string): Promise<void> {
    if (!this.onDispatchTask) {
      log.warn(`[${this.role}] No dispatch callback — cannot handle task ${taskId}`);
      return;
    }

    if (this.mode === 'manual') {
      log.info(`[${this.role}] Manual mode — task ${taskId} queued, waiting for user`);
      this.queue.push({ taskId, role });
      return;
    }

    // Check per-role concurrency
    if (this.active.size >= this.maxConcurrentWorkers) {
      log.info(`[${this.role}] Concurrency limit (${this.active.size}/${this.maxConcurrentWorkers}), queuing ${taskId}`);
      this.queue.push({ taskId, role });
      return;
    }

    await this.spawnWorker(taskId, role);
  }

  private async spawnWorker(taskId: string, role: string): Promise<void> {
    this.active.add(taskId);
    log.info(`[${this.role}] Dispatching worker for ${taskId} (${this.active.size}/${this.maxConcurrentWorkers} active)`);

    try {
      await this.onDispatchTask!(taskId, role);
    } catch (err: any) {
      log.error({ err }, `[${this.role}] Worker dispatch failed for ${taskId}`);
    } finally {
      this.active.delete(taskId);
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.active.size < this.maxConcurrentWorkers) {
      const next = this.queue.shift()!;
      // Re-check task state (may have been cancelled while queued)
      const task = this.taskStore.get(next.taskId);
      if (!task || task.status === "completed" || task.status === "failed") continue;
      this.spawnWorker(next.taskId, next.role);
    }
  }

  // ─── Role-filtered event handlers ──────────────────────────────────

  private onMyTaskReady(task: Task): void {
    log.debug(`[${this.role}] Task ready: ${task.id} — ${task.description?.slice(0, 60)}`);
  }

  private onMyTaskCompleted(task: Task): void {
    log.debug(`[${this.role}] Task completed: ${task.id}`);
    // Check if all this role's tasks are done → role-level completion
    const myTasks = this.getMyTasks();
    const allDone = myTasks.length > 0 && myTasks.every(
      t => t.status === "completed" || t.status === "failed" || t.status === "discarded"
    );
    if (allDone) {
      const completed = myTasks.filter(t => t.status === "completed").length;
      const failed = myTasks.filter(t => t.status === "failed").length;
      log.info(`[${this.role}] All tasks done: ${completed} completed, ${failed} failed`);
      // Gap C: Send role-level summary to planner
      const summary = `Role "${this.role}" completed: ${completed} done, ${failed} failed.` +
        (this.roleContext ? ` Key outputs:${this.roleContext.slice(-500)}` : '');
      this.onNotifyPlanner?.(summary);
    }
  }

  private onMyTaskFailed(task: Task): void {
    log.debug(`[${this.role}] Task failed: ${task.id}`);
  }

  dispose(): void {
    log.info(`ChatAgent disposed for role '${this.role}'`);
    this.agent = null;
    this.initialized = false;
  }

  /**
   * Get serialized ModelMessage[] from the underlying LLM agent.
   * Returns null if agent not initialized. Used for context persistence.
   */
  getContextSnapshot(): string | null {
    if (!this.agent) return null;
    const messages = this.agent.getMessages();
    if (!messages?.length) return null;
    try {
      return JSON.stringify(messages);
    } catch {
      return null;
    }
  }
}

export interface ChatAgentSnapshot {
  role: string;
  teamId: string;
  taskCount: number;
  byStatus: Record<string, number>;
  tasks: Task[];
}
