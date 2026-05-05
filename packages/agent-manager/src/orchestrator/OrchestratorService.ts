/**
 * OrchestratorService — Reactive Task Runtime
 *
 * Responsibility: React to task lifecycle events, dispatch workers, forward streams.
 * "I'm the runtime. I execute what the planner decides."
 *
 * Architecture (from architecture-diagram.md):
 * - OrchestratorService and PlannerAgent are PEERS — neither owns the other
 * - Both operate on shared services (TaskStore, WorkerPool, DependencyResolver)
 * - PlannerAgent calls tools → tools call TaskStore directly
 * - OrchestratorService reacts to callbacks from RoleTaskQueue
 * - AgentManager (composition root) wires both to shared services
 */

import type { WorkerPool } from "../services/WorkerPool.js";
import type { TaskStore } from "./TaskStore.js";
import type { DependencyResolver } from "./DependencyResolver.js";
import type { NotificationQueue } from "./NotificationQueue.js";
import type { UserInteractionManager } from "./UserInteractionManager.js";
import type { PluginRegistry } from "../plugin/PluginRegistry.js";
import { rootLogger } from "../logging.js";
import { PromptLoader } from "./PromptLoader.js";
import type {
  OrchestratorState,
  OrchestratorCallbacks,
} from "./types.js";
import { GoalManager, type GoalManagerConfig } from "./GoalManager.js";
import { TaskContextBuilder } from "./TaskContextBuilder.js";
import { DispatchManager } from "./DispatchManager.js";

const log = rootLogger.child({ module: "OrchestratorService" });

/** Max auto-retry attempts for retriable errors (429, timeout, external_service) */
const MAX_TASK_RETRIES = 3;
/** Max concurrent task dispatches to avoid overwhelming the LLM provider */
const MAX_CONCURRENT_DISPATCHES = 2;

// ═══════════════════════════════════════════════════════════════════
// CRDT Proxy Interface (lazy resolution per goal)
// ═══════════════════════════════════════════════════════════════════

/** Lazy proxy for goal-scoped CRDT stores. Resolved when approvePlan sets goalId. */
export interface CrdtProxy<T = any> {
  get(): T | null;
  resolveForGoal(goalId: string): void;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface OrchestratorServiceConfig {
  teamId: string;
  teamRoles: string[];

  // Shared services (injected by AgentManager)
  taskStore: TaskStore;
  workerPool: WorkerPool;
  dagResolver: DependencyResolver;
  pluginRegistry?: PluginRegistry;

  // Optional services
  userInteractionManager?: UserInteractionManager;
  notificationQueue?: NotificationQueue;
  planStore?: any;

  // CRDT task persistence (injected by AgentManager from CollaborationPlugin)
  crdtTaskSync?: CrdtProxy;
  crdtGoalStore?: CrdtProxy;

  // Callbacks → AgentManager → SocketServerV2 → Frontend
  callbacks?: OrchestratorCallbacks;

  // Execution config
  autoExecute?: boolean;

  // Phase 4.5: Agent factories (pass-through to GoalManager)
  createPlanner: (goalId: string) => Promise<import("./PlannerAgent.js").PlannerAgent>;
  createChatAgent: (goalId: string, role: string) => import("../chatAgent/ChatAgent.js").ChatAgent;
  onPlannerStream: (data: { goalId: string; taskId: string; agentId: string; part: any }) => void;
  chatAgentsEnabled: boolean;
  /** v3.0: Database persistence for tasks */
  taskPersistence?: import("./contracts/ITaskPersistence.js").ITaskPersistence | null;
  /** Domain event bus for CRDT projection + notifications */
  eventBus?: import("./events/GoalEventBus.js").GoalEventBus;
  /** Planner conversation persistence callbacks */
  loadConversationFn?: GoalManagerConfig["loadConversationFn"];
  saveConversationFn?: GoalManagerConfig["saveConversationFn"];
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════

export class OrchestratorService {
  // Config
  private teamId: string;
  private teamRoles: string[];
  private callbacks: OrchestratorCallbacks;

  // Shared services (injected — not owned)
  private taskStore: TaskStore;
  private workerPool: WorkerPool;
  private dagResolver: DependencyResolver;
  private pluginRegistry?: PluginRegistry;

  // Optional services
  private uim?: UserInteractionManager;
  private notificationQueue?: NotificationQueue;
  private planStore: any;
  // CRDT persistence — lazy proxies that resolve per-goal
  private crdtTaskSyncProxy: CrdtProxy | undefined;

  /** Step 4: optional callback to route dispatch through ChatAgent instead of direct WorkerPool */
  private chatAgentDispatch?: (taskId: string, role: string) => Promise<void>;

  // Goal lifecycle — delegated to GoalManager (Phase 3.5 SRP extraction)
  private goalManager: GoalManager;

  // Phase 4.5: Dispatch concurrency + retry — delegated to DispatchManager
  private dispatchManager: DispatchManager;

  private sessionId: string;
  private autoExecute: boolean;

  // Dispatch tracking — delegated to DispatchManager
  private messageChain: Promise<string> = Promise.resolve(""); // serialized user messages

  constructor(config: OrchestratorServiceConfig) {
    this.teamId = config.teamId;
    this.teamRoles = config.teamRoles;
    this.taskStore = config.taskStore;
    this.workerPool = config.workerPool;
    this.dagResolver = config.dagResolver;
    this.pluginRegistry = config.pluginRegistry;
    this.uim = config.userInteractionManager;
    this.notificationQueue = config.notificationQueue;
    this.planStore = config.planStore;
    this.crdtTaskSyncProxy = config.crdtTaskSync;
    this.callbacks = config.callbacks || {};
    this.sessionId = `team-${config.teamId}`;
    this.autoExecute = config.autoExecute ?? false;

    // Phase 4.5: Create DispatchManager — owns concurrency + retry
    this.dispatchManager = new DispatchManager({
      maxConcurrent: MAX_CONCURRENT_DISPATCHES,
      maxRetries: MAX_TASK_RETRIES,
      executeTask: (taskId, role) => this.dispatchTask(taskId, role),
      getTask: (taskId) => this.taskStore.get(taskId),
      updateTaskStatus: (taskId, status) => this.taskStore.updateStatus(taskId, status as any),
      onTaskUpdate: this.callbacks.onTaskUpdate ? (data) => this.callbacks.onTaskUpdate!(data) : undefined,
      failTask: (taskId, error) => this.taskStore.queue.failTask(taskId, error),
    });

    // Create GoalManager — owns goal lifecycle, delegates dispatch back to us
    this.goalManager = new GoalManager({
      teamId: config.teamId,
      teamRoles: config.teamRoles,
      taskStore: config.taskStore,
      dagResolver: config.dagResolver,
      workerPool: config.workerPool,
      pluginRegistry: config.pluginRegistry,
      planStore: config.planStore,
      crdtTaskSync: config.crdtTaskSync,
      crdtGoalStore: config.crdtGoalStore,
      autoExecute: this.autoExecute,
      createPlanner: config.createPlanner,
      createChatAgent: config.createChatAgent,
      onPlannerStream: config.onPlannerStream,
      chatAgentsEnabled: config.chatAgentsEnabled,
      taskPersistence: config.taskPersistence || null,
      eventBus: config.eventBus,
      loadConversationFn: config.loadConversationFn,
      saveConversationFn: config.saveConversationFn,
      callbacks: {
        onDispatchTask: (taskId, role) => this.handleReadyTask(taskId, role),
        onNotifyPlanner: (goalId, msg) => this.notifyPlanner(goalId, msg),
        onTaskUpdate: this.callbacks.onTaskUpdate,
        onProgress: this.callbacks.onProgress,
        onGoalStatusChange: this.callbacks.onGoalStatusChange,
        onPlanApproved: this.callbacks.onPlanApproved,
        onWorkerTaskUpdate: this.callbacks.onWorkerTaskUpdate,
      },
    });
  }

  /**
   * Initialize the runtime.
   * Wire task lifecycle callbacks from RoleTaskQueue → this.
   * Wire worker callbacks from WorkerPool → this.
   */
  async initialize(): Promise<void> {
    // Wire task lifecycle: RoleTaskQueue → GoalManager
    this.taskStore.setQueueCallbacks({
      onTaskReady: (data) => this.goalManager.onTaskReady(data),
      onTaskComplete: (data) => this.goalManager.onTaskComplete(data),
      onTaskFailed: (data) => this.goalManager.onTaskFailed(data),
    });

    // Wire worker streaming: WorkerPool → OrchestratorService → callbacks → Socket.IO
    this.workerPool.setCallbacks({
      onStream: (data) => this.callbacks.onStream?.(data),
      onEvent: (data) => this.callbacks.onEvent?.(data),
      onDone: (data) => this.callbacks.onDone?.(data),
      onError: (data) => this.callbacks.onError?.(data),
      onAgentComplete: (data) => this.goalManager.onWorkerDone(data),
      // R10-3 FIX: Track last reported status on task for blocked detection
      onStatusUpdate: (data) => {
        const task = this.taskStore.get(data.taskId);
        if (task) {
          task.lastReportedStatus = data.status;
        }
        // Gap A: Forward report_status to Channel B
        this.callbacks.onWorkerTaskUpdate?.(data.status === "blocked"
          ? { type: "blocked", taskId: data.taskId, role: data.role, reason: data.summary, ts: Date.now() }
          : { type: "progress", taskId: data.taskId, role: data.role, note: data.summary, pct: data.progress, ts: Date.now() }
        );
      },
      // R2-#4 FIX: Wire agent-initiated task callbacks so planner is notified
      onTaskCreated: (data) => {
        log.info(`Agent-created task: ${data.taskId} by ${data.createdBy} → ${data.targetRole}`);
        this.callbacks.onTaskUpdate?.({
          taskId: data.taskId, status: "pending", role: data.targetRole, timestamp: Date.now(),
        });
        // Notify planner so it can track agent-created tasks
        const createdTaskGoalId = this.taskStore.get(data.taskId)?.goalId || this.goalManager.getGoalId() || '';
        this.notifyPlanner(createdTaskGoalId,
          PromptLoader.loadTemplate("orchestrator", "task-created", {
            createdBy: data.createdBy,
            taskId: data.taskId,
            targetRole: data.targetRole,
            blocksSuffix: data.relationship === "blocks-me" ? ` (blocks ${data.parentTaskId})` : "",
          }),
        );
        // R6-6 FIX: Dispatch newly ready tasks (agent-created independent tasks have no prereqs)
        if (this.autoExecute) {
          this.dispatchReadyTasks();
        }
      },
      onBounce: (data) => {
        log.info(`Task bounced: ${data.taskId} by ${data.role} — ${data.reason}`);

        // Channel B: emit blocked event for bounced task
        this.callbacks.onWorkerTaskUpdate?.({
          type: "blocked", taskId: data.taskId, role: data.role,
          reason: `Bounced: ${data.reason}`,
          suggestedRole: data.suggestedRole,
          ts: Date.now(),
        });

        // R9-2 FIX: Handle dependency failure for bounced task
        // Bounced tasks are marked "failed" — notify planner with blocked downstream info
        this.goalManager.handleTaskFailure(data.taskId, `Bounced by ${data.role}: ${data.reason}`);

        // Gap D: When ChatAgent handles this role, skip per-bounce planner notification
        if (!this.chatAgentDispatch) {
          const bouncedTaskGoalId = this.taskStore.get(data.taskId)?.goalId || this.goalManager.getGoalId() || '';
          this.notifyPlanner(bouncedTaskGoalId,
            PromptLoader.loadTemplate("orchestrator", "task-bounced", {
              taskId: data.taskId,
              role: data.role,
              reason: data.reason,
              suggestedSuffix: data.suggestedRole ? `. Suggested role: ${data.suggestedRole}` : "",
            }),
          );
        }
      },
      // Step 3+4: Priority mention routing — spawn collab workers immediately
      onMentionedRoles: (data) => this.spawnCollabWorkers(data.roles, data.docName, data.sourceRole, data.postContent, data.sourceTaskId),
      // Channel B: forward task updates to ChatAgent + Socket.IO
      onTaskUpdate: (update) => this.callbacks.onWorkerTaskUpdate?.(update),
    });

    // v3.1: Database recovery is now the only startup path
    await this.goalManager.loadFromDatabase();

    this.goalManager.setState("idle");
    console.log(`[OrchestratorService] Initialized for team ${this.teamId}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API (called by AgentManager, which delegates from SocketServerV2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle a user message. Routes to the planner via GoalManager.
   * @param content - Message content
   * @param goalId - goalId from frontend (required correlation ID)
   */
  async handleMessage(content: string, goalId: string, repoUrl?: string, repoBranch?: string): Promise<string> {
    const result = this.messageChain.then(() => this._handleMessage(content, goalId, repoUrl, repoBranch));
    this.messageChain = result.catch(() => "");
    return result;
  }

  private async _handleMessage(content: string, goalId: string, repoUrl?: string, repoBranch?: string): Promise<string> {
    // Switch to the incoming goal BEFORE reading/writing state
    this.goalManager.getOrCreateGoalPublic(goalId, content);

    if (this.goalManager.getGoalState(goalId) === "idle") {
      this.goalManager.setGoalState(goalId, "executing");
    }

    // Store repoUrl on GoalContext (direct — no LLM dependency)
    if (repoUrl) {
      this.goalManager.setGoalRepo(goalId, repoUrl, repoBranch);
    }

    this.goalManager.executePlannerTurn(goalId, content).catch((err) => {
      console.error("[OrchestratorService] Planner error:", err);
    });

    return ""; // Response comes via stream, not return value
  }

  /**
   * Approve the pending plan. Delegates to GoalManager.
   */
  async approvePlan(goalId?: string): Promise<{ success: boolean; tasksQueued?: number; error?: string }> {
    return this.goalManager.approvePlan(goalId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE QUERIES (read-only — used by tools and AgentManager)
  // ═══════════════════════════════════════════════════════════════════

  getState(): OrchestratorState { return this.goalManager.getState(); }
  getGoalState(goalId: string): OrchestratorState { return this.goalManager.getGoalState(goalId); }
  setState(state: OrchestratorState) { this.goalManager.setState(state); }
  setGoalState(goalId: string, state: OrchestratorState) { this.goalManager.setGoalState(goalId, state); }
  getPendingPlan(goalId?: string) { return this.goalManager.getPendingPlan(goalId); }
  setPendingPlan(plan: any, goalId?: string) { this.goalManager.setPendingPlan(plan, goalId); }
  getAutoExecute(): boolean { return this.autoExecute; }
  setAutoExecute(enabled: boolean) {
    this.autoExecute = enabled;
    this.goalManager.setAutoExecute(enabled);
    // When toggled ON, dispatch any tasks already sitting in "ready" state
    if (enabled) this.dispatchReadyTasks();
  }
  getTeamId(): string { return this.teamId; }
  getTeamRoles(): string[] { return this.teamRoles; }
  getCurrentGoalId(): string | null { return this.goalManager.getGoalId(); }
  getCallbacks(): OrchestratorCallbacks { return this.callbacks; }
  getTaskStore(): TaskStore { return this.taskStore; }
  getAllGoalSummaries(): import("./types.js").GoalSummary[] { return this.goalManager.getAllGoalSummaries(); }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-APPROVE (Phase 4.5 — moved from AgentManagerV2)
  // ═══════════════════════════════════════════════════════════════════

  private autoApproveRoles = new Set<string>();
  private autoApproveAll = false;

  setAutoApproveForRole(role: string, enabled: boolean): void {
    const normalizedRole = role.toLowerCase();
    if (enabled) {
      this.autoApproveRoles.add(normalizedRole);
      log.info(`Auto-approve enabled for role: ${normalizedRole}`);
    } else {
      this.autoApproveRoles.delete(normalizedRole);
      log.info(`Auto-approve disabled for role: ${normalizedRole}`);
    }
  }

  setAutoApproveAllRoles(enabled: boolean): void {
    this.autoApproveAll = enabled;
    log.info(`Auto-approve ALL roles: ${enabled ? "enabled" : "disabled"}`);
  }

  isAutoApproveEnabled(role: string): boolean {
    return this.autoApproveAll || this.autoApproveRoles.has(role.toLowerCase());
  }

  getAutoApproveRoles(): string[] {
    if (this.autoApproveAll) return ["*"];
    return Array.from(this.autoApproveRoles);
  }

  /** Get ChatAgent from GoalManager (Phase 4.5). */
  getChatAgent(role: string, goalId?: string): import("../chatAgent/ChatAgent.js").ChatAgent | null {
    if (goalId) {
      // Exact goal lookup — do NOT fall back to another goal's agent
      return this.goalManager.getChatAgent(goalId, role);
    }
    // No goalId provided — use activeGoalId fallback (legacy path)
    return this.goalManager.getChatAgentByRole(role);
  }

  /** Enable chat agents on GoalManager (called after construction). */
  setChatAgentsEnabled(enabled: boolean): void {
    this.goalManager.setChatAgentsEnabled(enabled);
  }

  /** Get GoalManager (for AgentManagerV2 delegation). */
  getGoalManager(): GoalManager { return this.goalManager; }

  /** Step 4: Set dispatch callback to route through ChatAgent instead of direct WorkerPool */
  setChatAgentDispatch(dispatch: (taskId: string, role: string) => Promise<void>): void {
    this.chatAgentDispatch = dispatch;
    this.dispatchManager.setChatAgentDispatch(dispatch);
    log.info("ChatAgent dispatch enabled — tasks will route through ChatAgent");
  }

  /**
   * Handle a ready task — delegates to DispatchManager.
   * GoalManager calls this via the onDispatchTask callback.
   */
  private handleReadyTask(taskId: string, role: string): void {
    const goalId = this.taskStore.get(taskId)?.goalId;
    this.dispatchManager.dispatch(taskId, role, this.autoExecute);
  }

  /**
   * Direct dispatch — bypasses ChatAgent routing.
   * Used by ChatAgent.onDispatchTask callback to actually run the task.
   */
  async directDispatchTask(taskId: string, role: string): Promise<void> {
    const goalId = this.taskStore.get(taskId)?.goalId;
    await this.dispatchManager.directDispatch(taskId, role);
  }
  getDagResolver(): DependencyResolver { return this.dagResolver; }
  getUserInteractionManager(): UserInteractionManager | undefined { return this.uim; }

  // ═══════════════════════════════════════════════════════════════════
  // PLAN MUTATION DISPATCH (single entry point — replaces scattered onMutation handlers)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * React to plan mutations from planner tools.
   * Dispatches newly ready tasks that were created/unblocked by the mutation.
   *
   * This is the SINGLE place where mutation→dispatch happens (SRP).
   * AgentManagerV2 only forwards events here — no dispatch logic there.
   */
  onPlanMutation(event: { type: string; data: any }): void {
    // Dispatch reassigned tasks whose status was reset to ready
    if (event.type === "plan:task_reassigned" && event.data?.statusReset && event.data?.taskId) {
      const task = this.taskStore.get(event.data.taskId);
      if (task && task.status === "ready") {
        this.handleReadyTask(event.data.taskId, task.assigned_role);
      }
      return;
    }

    // Dispatch newly ready tasks after add_tasks or replan (respects autoExecute)
    if (event.type === "plan:tasks_added" || event.type === "plan:replanned") {
      const taskIds: string[] = event.data?.tasks || event.data?.newTasks || [];
      for (const tid of taskIds) {
        const task = this.taskStore.get(tid);
        if (task && task.status === "ready") {
          this.handleReadyTask(tid, task.assigned_role);
        }
      }
      return;
    }

    // Dispatch updated tasks whose dependencies resolved to ready
    if (event.type === "plan:task_updated" && event.data?.patch?.dependencies && event.data?.taskId) {
      const task = this.taskStore.get(event.data.taskId);
      if (task && task.status === "ready") {
        this.handleReadyTask(event.data.taskId, task.assigned_role);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // TASK LIFECYCLE CALLBACKS (wired from RoleTaskQueue via TaskStore)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Scan all tasks for "ready" status and dispatch them.
   * Called when autoExecute is toggled ON to flush tasks that became ready while OFF.
   */
  private dispatchReadyTasks(): void {
    const readyTasks = this.taskStore.getByStatus("ready")
      .filter(t => {
        // Only dispatch tasks for goals in executing state
        if (!t.goalId) return true; // legacy tasks without goalId
        const goal = this.goalManager.getGoalContext(t.goalId);
        return goal?.state === "executing" || goal?.state === "researching";
      });
    for (const task of readyTasks) {
      if (this.dispatchManager.isDispatching(task.id)) continue;
      this.handleReadyTask(task.id, task.assigned_role);
    }
  }

  /**
   * Spawn collab workers for mentioned roles. Validates roles, includes context.
   * Single implementation — called from both initialize() and approvePlan() callbacks.
   */
  private spawnCollabWorkers(
    roles: string[], docName: string, sourceRole?: string, postContent?: string, sourceTaskId?: string,
  ): void {
    // Fix 1: Validate mentions against team roles
    const validRoles = roles.filter(r => this.teamRoles.some(tr => tr.toLowerCase() === r.toLowerCase()));
    const invalidRoles = roles.filter(r => !this.teamRoles.some(tr => tr.toLowerCase() === r.toLowerCase()));
    if (invalidRoles.length > 0) {
      log.warn(`Mention validation: unknown roles ignored: ${invalidRoles.join(", ")}`);
    }
    // Filter self-mentions (agent mentioning own role)
    const effectiveRoles = validRoles.filter(r => r.toLowerCase() !== sourceRole?.toLowerCase());
    if (effectiveRoles.length === 0) return;

    log.info(`Spawning collab workers: ${effectiveRoles.join(", ")} for ${docName}`);

    for (const role of effectiveRoles) {
      const collabWorkerId = `collab-${docName.replace(/\//g, "-")}-${role}`;
      if (this.workerPool.hasActiveWorker(collabWorkerId)) continue;

      // Fix 2: Context-aware collab worker prompt
      const excerpt = postContent ? postContent.slice(0, 500) : "(no content available)";
      const collabMessage = [
        `## You were mentioned by ${sourceRole || "another agent"} in a discussion`,
        ``,
        `### What they said:`,
        `> ${excerpt}`,
        ``,
        `### Your task:`,
        `1. Read the discussion: \`collab({ action: "discuss", docName: "${docName}", key: "read" })\``,
        `2. Post your response: \`collab({ action: "discuss", docName: "${docName}", key: "post", value: { content: "YOUR RESPONSE" } })\``,
        `3. Complete: \`complete_task({ summary: "Responded to ${sourceRole || "discussion"}" })\``,
        ``,
        `If you have no expertise on this topic, call \`bounce_task()\`.`,
        `Keep it brief — this is alignment, not implementation.`,
      ].join("\n");

      // Resolve goalId from the source task so collab worker streams are goal-scoped
      const collabGoalId = sourceTaskId
        ? this.workerPool.getTaskGoalId(sourceTaskId)
        : undefined;

      this.workerPool.runTask(collabWorkerId, role, collabMessage, collabGoalId)
        .catch((err) => log.error(`Collab worker ${collabWorkerId} error: ${err}`))
        .finally(() => { this.workerPool.dispose(collabWorkerId).catch(() => {}); });
    }
  }

  /**
   * Manually dispatch a ready task. Used when autoExecute is OFF.
   */
  async manualDispatch(taskId: string): Promise<void> {
    const goalId = this.taskStore.get(taskId)?.goalId;
    await this.dispatchManager.manualDispatch(taskId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /** Dispatch a single task to WorkerPool. */
  private async dispatchTask(taskId: string, role: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task || task.status === "completed" || task.status === "failed") return;

    await this.taskStore.updateStatus(taskId, "in_progress");

    this.callbacks.onTaskUpdate?.({
      taskId, status: "in_progress", role, timestamp: Date.now(),
    });

    this.callbacks.onProgress?.({
      teamId: this.teamId, state: "executing",
      message: `Starting task: ${task.description}`, taskId, role,
      timestamp: new Date().toISOString(),
    });

    try {
      // ─── CollabTaskDispatcher: Initialize CRDT docs for collaboration/discussion tasks ───
      const taskType = task.type || task.context?.type;
      if ((taskType === "collaboration" || taskType === "discussion") && this.crdtTaskSyncProxy?.get?.()) {
        try {
          const collabConfig = task.context?.collaboration || {};
          const agendaLines = task.description
            .split("\n")
            .filter((l: string) => /^\d+\./.test(l.trim()))
            .map((l: string) => l.trim().replace(/^\d+\.\s*/, ""));
          const participants = this.teamRoles.map(r => r.toLowerCase());
          await this.crdtTaskSyncProxy.get().initCollabDocs(taskId, {
            ...collabConfig,
            agenda: agendaLines.length > 0 ? agendaLines : undefined,
            participants,
          });
          log.info(`Initialized discussion CRDT docs for task ${taskId}`);
        } catch (err) {
          log.warn(`Failed to initialize collab docs for ${taskId}: ${err}`);
        }
      }

      // ─── CRDT Context Enrichment ─────────────────────────────────────
      let crdtRefs: Record<string, any> | undefined;
      const crdtSyncDispatch = this.crdtTaskSyncProxy?.get?.();
      if (crdtSyncDispatch) {
        crdtRefs = crdtSyncDispatch.getCrdtRefs(taskId, task);
        await crdtSyncDispatch.syncStatus(taskId, "in_progress");
      }

      // ─── Delegate context enrichment to TaskContextBuilder ───────────
      const { enrichedDescription, previousOutputs, artifacts } = await TaskContextBuilder.enrich({
        task, role, teamRoles: this.teamRoles, crdtRefs, planStore: this.planStore,
        taskPersistence: this.taskStore.getPersistence?.() ?? null,
      });

      await this.workerPool.runTask({
        id: taskId, assigned_role: role, description: enrichedDescription,
        priority: task.priority || 0,
        context: { previousOutputs, artifacts, crdtRefs },
        goalId: task.goalId,
        createdAt: Date.now(), status: "in_progress",
      });

      // If worker finished without calling complete_task (generated text and stopped),
      // auto-complete the task. The worker's text response is its output.
      // Guard: check status AFTER runTask returns — onWorkerDone may have already completed it
      const afterTask = this.taskStore.get(taskId);
      if (afterTask && afterTask.status === "in_progress" && !afterTask.completionSource) {
        // R10-3 FIX: Don't auto-complete if the task was reported as blocked
        const wasBlocked = afterTask.lastReportedStatus === "blocked";
        if (wasBlocked) {
          log.info(`[OrchestratorService] Worker for ${taskId} was blocked — marking as failed, not auto-completing`);
          try { await this.taskStore.updateStatus(taskId, "failed"); } catch { /* guard */ }
          this.taskStore.queue.failTask(taskId, "Agent reported blocked and could not complete");
        } else {
          console.log(`[OrchestratorService] Worker finished without complete_task, auto-completing ${taskId}`);

          // Publish + merge workspace before completing (same as onWorkerDone path)
          if (this.pluginRegistry) {
            try {
              const taskGoalForPlugin = this.taskStore.get(taskId)?.goalId;
              const result = await this.pluginRegistry.onTaskComplete(taskId, taskGoalForPlugin || undefined);
              if (!result.success) {
                console.warn(`[OrchestratorService] Auto-complete merge warning for ${taskId}: ${result.error}`);
              }
            } catch (err) {
              console.warn(`[OrchestratorService] Auto-complete plugin error for ${taskId}: ${err}`);
            }
          }

          await this.taskStore.completeTask(taskId, {
            summary: "Task completed (auto-completed — worker finished without calling complete_task)",
            completedBy: "auto",
            timestamp: Date.now(),
          });
        }
      }
    } catch (error: any) {
      // Delegate error handling (retry/fail) to DispatchManager
      const errorGoalId = this.taskStore.get(taskId)?.goalId;
      this.dispatchManager.handleError(taskId, role, error);
    }
  }

  /** Notify planner via NotificationQueue (debounce) or direct GoalManager call. */
  private notifyPlanner(goalId: string, message: string): void {
    if (this.notificationQueue) {
      this.notificationQueue.push(goalId, message);
    } else {
      this.goalManager.executePlannerTurn(goalId, message).catch((err) => {
        log.error(`Planner notification error: ${err}`);
      });
    }
  }

  /** Public wrapper — used by ChatAgent to send role-level summaries through the same pipe. */
  notifyPlannerFromRole(goalId: string, message: string): void {
    this.notifyPlanner(goalId, message);
  }

  reset(): void { this.goalManager.reset(); }

  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    return this.goalManager.resetPlan();
  }

  async interruptPlan(): Promise<void> {
    return this.goalManager.interruptPlan();
  }

  dispose(): void { this.uim?.cancelAll(); this.notificationQueue?.dispose(); this.goalManager.dispose(); }
}
