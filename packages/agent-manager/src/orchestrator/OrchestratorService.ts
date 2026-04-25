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
import { toGoalId } from "../plugin/utils.js";
import { classifyError } from "./types/workerTypes.js";
import { rootLogger } from "../logging.js";
import { PromptLoader } from "./PromptLoader.js";
import type {
  OrchestratorState,
  OrchestratorCallbacks,
  OrchestratorMessage,
} from "./types.js";
import { GoalManager } from "./GoalManager.js";

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

  private sessionId: string;
  private messages: OrchestratorMessage[] = [];
  private autoExecute: boolean;

  // Dispatch tracking
  private activeDispatches = new Set<string>();   // taskIds currently being dispatched (prevent double-dispatch)
  private manualDispatchChain: Promise<void> = Promise.resolve(); // serialized manual dispatches only
  private messageChain: Promise<string> = Promise.resolve(""); // serialized user messages

  // Retry tracking: taskId → attempt count
  private taskAttempts = new Map<string, number>();
  // Deferred dispatch queue (when concurrency limit reached)
  private deferredDispatches: Array<{ taskId: string; role: string }> = [];

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
    this.crdtGoalStoreProxy = config.crdtGoalStore;
    this.callbacks = config.callbacks || {};
    this.sessionId = `team-${config.teamId}`;
    this.autoExecute = config.autoExecute ?? false;

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
      callbacks: {
        onDispatchTask: (taskId, role) => this.handleReadyTask(taskId, role),
        onNotifyPlanner: (msg) => this.notifyPlanner(msg),
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
        this.notifyPlanner(
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
          this.notifyPlanner(
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
      onMentionedRoles: (data) => this.spawnCollabWorkers(data.roles, data.docName, data.sourceRole, data.postContent),
      // Channel B: forward task updates to ChatAgent + Socket.IO
      onTaskUpdate: (update) => this.callbacks.onWorkerTaskUpdate?.(update),
    });

    // Load active plan for restart recovery
    await this.goalManager.loadActivePlan();

    this.goalManager.setState("idle");
    console.log(`[OrchestratorService] Initialized for team ${this.teamId}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API (called by AgentManager, which delegates from SocketServerV2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle a user message. Routes to the planner (via onPlannerInput callback).
   * In planner mode, the orchestrator doesn't run the LLM — the planner does.
   */
  async handleMessage(content: string): Promise<string> {
    const result = this.messageChain.then(() => this._handleMessage(content));
    this.messageChain = result.catch(() => "");
    return result;
  }

  private async _handleMessage(content: string): Promise<string> {
    this.messages.push({ role: "user", content, timestamp: new Date().toISOString() });

    if (this.goalManager.getState() === "idle") {
      this.goalManager.setState("executing");
    }

    // Each user message = new planner turn with full conversation history.
    // The planner talks naturally (text output) and calls tools (research, plan, etc.).
    // When it generates text, the turn ends. User's next message starts a new turn.
    // No blocking, no UserInteractionManager — just chat.
    this.callbacks.onPlannerInput?.(content).catch((err) => {
      console.error("[OrchestratorService] Planner error:", err);
    });

    return ""; // Response comes via stream, not return value
  }

  /**
   * Approve the pending plan. Delegates to GoalManager.
   */
  async approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }> {
    return this.goalManager.approvePlan();
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE QUERIES (read-only — used by tools and AgentManager)
  // ═══════════════════════════════════════════════════════════════════

  getState(): OrchestratorState { return this.goalManager.getState(); }
  setState(state: OrchestratorState) { this.goalManager.setState(state); }
  getPendingPlan() { return this.goalManager.getPendingPlan(); }
  setPendingPlan(plan: any) { this.goalManager.setPendingPlan(plan); }
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

  /** Step 4: Set dispatch callback to route through ChatAgent instead of direct WorkerPool */
  setChatAgentDispatch(dispatch: (taskId: string, role: string) => Promise<void>): void {
    this.chatAgentDispatch = dispatch;
    log.info("ChatAgent dispatch enabled — tasks will route through ChatAgent");
  }

  /**
   * Handle a ready task — bridge from GoalManager.onTaskReady → dispatch.
   * Manages autoExecute check, ChatAgent routing, and concurrency limits.
   * GoalManager calls this via the onDispatchTask callback.
   */
  private handleReadyTask(taskId: string, role: string): void {
    if (!this.autoExecute) return;
    if (this.activeDispatches.has(taskId)) return;

    // Route through ChatAgent if dispatch callback is set
    if (this.chatAgentDispatch) {
      this.chatAgentDispatch(taskId, role).catch((err) => {
        log.error(`ChatAgent dispatch error for ${taskId}:`, err);
      });
      return;
    }

    // Concurrency limit: defer if too many active dispatches
    if (this.activeDispatches.size >= MAX_CONCURRENT_DISPATCHES) {
      this.deferredDispatches.push({ taskId, role });
      return;
    }

    this.activeDispatches.add(taskId);
    this.dispatchTask(taskId, role).catch((err) => {
      log.error(`Auto-dispatch error for ${taskId}:`, err);
    }).finally(() => {
      this.activeDispatches.delete(taskId);
      this.drainDeferredDispatches();
    });
  }

  /**
   * Direct dispatch — bypasses ChatAgent routing.
   * Used by ChatAgent.onDispatchTask callback to actually run the task.
   */
  async directDispatchTask(taskId: string, role: string): Promise<void> {
    if (this.activeDispatches.has(taskId)) return;
    this.activeDispatches.add(taskId);
    try {
      await this.dispatchTask(taskId, role);
    } finally {
      this.activeDispatches.delete(taskId);
      this.drainDeferredDispatches();
    }
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
      this.manualDispatch(event.data.taskId).catch((err) => {
        log.warn(`Failed to dispatch reassigned task ${event.data.taskId}: ${err}`);
      });
      return;
    }

    // Dispatch newly ready tasks after add_tasks or replan
    if (event.type === "plan:tasks_added" || event.type === "plan:replanned") {
      const taskIds: string[] = event.data?.tasks || event.data?.newTasks || [];
      for (const tid of taskIds) {
        const task = this.taskStore.get(tid);
        if (task && task.status === "ready") {
          this.manualDispatch(tid).catch((err) => {
            log.warn(`Failed to dispatch new task ${tid}: ${err}`);
          });
        }
      }
      return;
    }

    // Dispatch updated tasks whose dependencies resolved to ready
    if (event.type === "plan:task_updated" && event.data?.patch?.dependencies && event.data?.taskId) {
      const task = this.taskStore.get(event.data.taskId);
      if (task && task.status === "ready") {
        this.manualDispatch(event.data.taskId).catch((err) => {
          log.warn(`Failed to dispatch updated task ${event.data.taskId}: ${err}`);
        });
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
    const readyTasks = this.taskStore.getByStatus("ready");
    for (const task of readyTasks) {
      if (this.activeDispatches.has(task.id)) continue;
      this.handleReadyTask(task.id, task.assigned_role);
    }
  }

  /**
   * Spawn collab workers for mentioned roles. Validates roles, includes context.
   * Single implementation — called from both initialize() and approvePlan() callbacks.
   */
  private spawnCollabWorkers(
    roles: string[], docName: string, sourceRole?: string, postContent?: string,
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

      this.workerPool.runTask(collabWorkerId, role, collabMessage)
        .catch((err) => log.error(`Collab worker ${collabWorkerId} error: ${err}`))
        .finally(() => { this.workerPool.dispose(collabWorkerId).catch(() => {}); });
    }
  }

  /** Drain deferred dispatches when a slot opens up */
  private drainDeferredDispatches(): void {
    while (
      this.deferredDispatches.length > 0 &&
      this.activeDispatches.size < MAX_CONCURRENT_DISPATCHES
    ) {
      const next = this.deferredDispatches.shift()!;
      if (this.activeDispatches.has(next.taskId)) continue;

      // Re-check task state (may have been cancelled/completed while waiting)
      const task = this.taskStore.get(next.taskId);
      if (!task || task.status === "completed" || task.status === "failed") continue;

      this.activeDispatches.add(next.taskId);
      this.dispatchTask(next.taskId, next.role).catch((err) => {
        log.error(`Deferred dispatch error for ${next.taskId}:`, err);
      }).finally(() => {
        this.activeDispatches.delete(next.taskId);
        this.drainDeferredDispatches();
      });
    }
  }

  /**
   * Manually dispatch a ready task. Used when autoExecute is OFF and the user
   * triggers start-task from the frontend.
   */
  async manualDispatch(taskId: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "ready" && task.status !== "pending") {
      throw new Error(`Task ${taskId} is not ready (status: ${task.status})`);
    }
    if (this.activeDispatches.has(taskId)) {
      throw new Error(`Task ${taskId} is already being dispatched`);
    }

    const role = task.assigned_role;

    // Route through ChatAgent if dispatch callback is set
    if (this.chatAgentDispatch) {
      this.chatAgentDispatch(taskId, role).catch((err) => {
        log.error(`ChatAgent manual dispatch error for ${taskId}:`, err);
      });
      return;
    }

    this.activeDispatches.add(taskId);

    // Manual dispatch is serialized (caller awaits) so UI gets immediate feedback
    this.manualDispatchChain = this.manualDispatchChain
      .then(() => this.dispatchTask(taskId, role))
      .catch((err) => { log.error(`Dispatch error for ${taskId}:`, err); })
      .finally(() => this.activeDispatches.delete(taskId));
    await this.manualDispatchChain;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /** Dispatch a single task to WorkerPool. */
  private async dispatchTask(taskId: string, role: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task || task.status === "completed" || task.status === "failed") return;

    this.taskStore.updateStatus(taskId, "in_progress");

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

          // Phase 3: Extract agenda from task description (numbered items)
          const agendaLines = task.description
            .split("\n")
            .filter((l: string) => /^\d+\./.test(l.trim()))
            .map((l: string) => l.trim().replace(/^\d+\.\s*/, ""));

          // Phase 4: Set participants from team roles
          const participants = this.teamRoles.map(r => r.toLowerCase());

          await this.crdtTaskSyncProxy.get().initCollabDocs(taskId, {
            ...collabConfig,
            agenda: agendaLines.length > 0 ? agendaLines : undefined,
            participants,
          });
          log.info(`Initialized discussion CRDT docs for task ${taskId} (agenda: ${agendaLines.length} items, participants: ${participants.length})`);
        } catch (err) {
          log.warn(`Failed to initialize collab docs for ${taskId}: ${err}`);
        }
      }
      // ──────────────────────────────────────────────────────────────────────────

      // Context is pre-built by TaskStore.enrichDependantContext() at upstream completion time.
      // Planner-provided context (notes, files, artifacts) is already on task.context from create().
      // We just read — no assembly logic here.
      const taskCtx = (typeof task.context === "object" ? task.context : {}) as Record<string, any>;

      const previousOutputs = Array.isArray(taskCtx.upstreamOutputs) ? taskCtx.upstreamOutputs : [];
      const artifacts = [
        ...(Array.isArray(taskCtx.upstreamArtifacts) ? taskCtx.upstreamArtifacts : []),
        ...(Array.isArray(taskCtx.files) ? taskCtx.files : []),
        ...(Array.isArray(taskCtx.artifacts) ? taskCtx.artifacts : []),
      ];

      // ─── CRDT Context Enrichment ─────────────────────────────────────
      // Inject CRDT references so agents can use `collab read` to access task details
      let crdtRefs: Record<string, any> | undefined;
      const crdtSyncDispatch = this.crdtTaskSyncProxy?.get?.();
      if (crdtSyncDispatch) {
        crdtRefs = crdtSyncDispatch.getCrdtRefs(taskId, task);
        // Sync status to in_progress in CRDT
        await crdtSyncDispatch.syncStatus(taskId, "in_progress");
      } else {
        log.debug(`CRDT not resolved — agent won't have collab read access for ${taskId}`);
      }
      // ────────────────────────────────────────────────────────────────

      // Enrich description with planner notes + upstream notes + expected output
      let enrichedDescription = task.description;

      // Inject upstream task outputs into the description so the agent knows what was done
      if (previousOutputs.length > 0) {
        enrichedDescription += `\n\n## Completed Upstream Work`;
        enrichedDescription += `\nThese tasks completed before yours. Their output files are already in your workspace (merged to main).`;
        for (const po of previousOutputs) {
          enrichedDescription += `\n\n### ${po.taskId} (${po.role})${po.status === "failed" ? " ❌ FAILED" : ""}`;
          enrichedDescription += `\n${po.summary}`;
        }
        if (artifacts.length > 0) {
          enrichedDescription += `\n\n**Files/artifacts from upstream:** ${artifacts.join(", ")}`;
        }
        enrichedDescription += `\n\nUse \`workspace_list_files\` to see all available files in your workspace.`;
      }

      const allNotes: string[] = [
        ...(Array.isArray(taskCtx.notes) ? taskCtx.notes : taskCtx.notes ? [taskCtx.notes] : []),
        ...(Array.isArray(taskCtx.upstreamNotes) ? taskCtx.upstreamNotes : []),
      ];
      if (allNotes.length > 0) {
        enrichedDescription += `\n\nNotes:\n${allNotes.map((n: string) => `- ${n}`).join("\n")}`;
      }
      if (taskCtx.expectedOutput) {
        enrichedDescription += `\n\nExpected output: ${taskCtx.expectedOutput}`;
      }

      // ─── Cross-Plan Reference Resolution (v1.1) ─────────────────────
      const references = Array.isArray(taskCtx.references) ? taskCtx.references : [];
      const unresolvedRefs: string[] = [];  // R2-#5: Track failures
      if (references.length > 0 && this.planStore) {
        const priorOutputs: string[] = [];
        for (const ref of references) {
          try {
            // ref format: "plan-001/task-003" or "{goalId}/task-003"
            const [refPlanOrGoal, refTaskId] = ref.split("/");
            if (!refTaskId) {
              unresolvedRefs.push(`${ref} (invalid format)`);
              continue;
            }

            // Try loading from PlanStore
            const allPlans = await this.planStore.listAllPlans();
            const matchPlan = allPlans.find((p: any) => p.planId === refPlanOrGoal || p.goalId === refPlanOrGoal);
            if (matchPlan) {
              const stored = await this.planStore.loadPlan(matchPlan.planId, matchPlan.goalId);
              const refTask = stored?.plan?.tasks?.find((t: any) => t.id === refTaskId);
              if (refTask?.output) {
                const summary = typeof refTask.output === "string" ? refTask.output : JSON.stringify(refTask.output).slice(0, 500);
                priorOutputs.push(`- ${ref}: ${summary}`);
              } else {
                unresolvedRefs.push(`${ref} (task found, no output)`);
              }
            } else {
              unresolvedRefs.push(`${ref} (plan/goal not found)`);
            }
          } catch (err) {
            unresolvedRefs.push(`${ref} (error: ${err})`);
          }
        }
        if (priorOutputs.length > 0) {
          enrichedDescription += `\n\n## Prior Work (from previous plans)\n${priorOutputs.join("\n")}`;
        }
        // R2-#5 FIX: Warn agent about unresolved references
        if (unresolvedRefs.length > 0) {
          log.warn(`Task ${taskId}: ${unresolvedRefs.length}/${references.length} cross-plan refs unresolved`);
          enrichedDescription += `\n\n⚠️ Unresolved references (${unresolvedRefs.length}): ${unresolvedRefs.join(", ")}`;
        }
      }
      // ────────────────────────────────────────────────────────────────

      // Fix #15: Add CRDT references to agent prompt so agents know how to access task details
      if (crdtRefs) {
        enrichedDescription += `\n\n## Context Sources (use collab read to access)`;
        enrichedDescription += `\n- Your task: collab read ${crdtRefs.task}`;
        enrichedDescription += `\n- Plan: collab read ${crdtRefs.plan}`;
        enrichedDescription += `\n- Goal: collab read ${crdtRefs.goal}`;
        if (crdtRefs.dependencies?.length) {
          enrichedDescription += `\n- Completed dependencies: ${crdtRefs.dependencies.join(", ")}`;
        }
        if (crdtRefs.dependants?.length) {
          enrichedDescription += `\n- Downstream (depends on you): ${crdtRefs.dependants.join(", ")}`;
        }
      }

      // R8: Inject team roster so agents know who they can create tasks for
      if (this.teamRoles.length > 0) {
        const otherRoles = this.teamRoles.filter(r => r.toLowerCase() !== role.toLowerCase());
        if (otherRoles.length > 0) {
          enrichedDescription += `\n\n## Your Team`;
          enrichedDescription += `\nOther roles you can collaborate with or create tasks for:`;
          enrichedDescription += otherRoles.map(r => `\n- ${r}`).join("");
          enrichedDescription += `\n\nIf you need work from another role, use request_task({ targetRole: "role-name", relationship: "blocks-me" }).`;
          enrichedDescription += `\nIf this task is wrong for your role, use bounce_task().`;
        }
      }

      // Step 5: Discussion-specific prompt for type: "discussion" or "collaboration" tasks
      if (task.type === "collaboration" || task.type === "discussion" || task.context?.type === "collaboration") {
        const discussionDocName = `${taskId}/discussion`;
        const otherRoles = this.teamRoles.filter(r => r.toLowerCase() !== role.toLowerCase());
        enrichedDescription += `\n\n## ⚡ Discussion Task`;
        enrichedDescription += `\nYou are participating in a cross-role discussion. Other team roles: ${otherRoles.join(", ")}.`;

        // Phase 3: Inject agenda if present
        const agendaLines = task.description
          .split("\n")
          .filter((l: string) => /^\d+\./.test(l.trim()))
          .map((l: string) => l.trim().replace(/^\d+\.\s*/, ""));
        if (agendaLines.length > 0) {
          enrichedDescription += `\n\n### Agenda:`;
          enrichedDescription += agendaLines.map((a, i) => `\n${i + 1}. ${a}`).join("");
          enrichedDescription += `\nAddress each item. Use decide with matching key to resolve each.`;
        }
        enrichedDescription += `\n\n### Protocol (follow these steps exactly):`;
        enrichedDescription += `\n1. **Read** existing discussion:`;
        enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "read" })\``;
        enrichedDescription += `\n2. **Post** your perspective (mention other roles for their input):`;
        enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "post", value: { content: "YOUR INPUT HERE", mentions: [${otherRoles.map(r => `"${r}"`).join(", ")}] } })\``;
        enrichedDescription += `\n3. **Read** again to check for responses:`;
        enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "read" })\``;
        enrichedDescription += `\n4. **Decide** when consensus is reached:`;
        enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "decide", value: { key: "outcome", decision: "...", agreedBy: ["${role}", ...] } })\``;
        enrichedDescription += `\n5. **Complete**: \`complete_task({ summary: "Decision: ..." })\``;
        enrichedDescription += `\n\n### Rules:`;
        enrichedDescription += `\n- Post ONCE with your expert perspective. Don't repeat yourself.`;
        enrichedDescription += `\n- Read other participants' posts before recording a decision.`;
        enrichedDescription += `\n- Do NOT use write-block — only use discuss post/read/decide.`;
        enrichedDescription += `\n- Keep it brief — this is alignment, not implementation.`;
      }

      await this.workerPool.runTask({
        id: taskId, assigned_role: role, description: enrichedDescription,
        priority: task.priority || 0,
        context: { previousOutputs, artifacts, crdtRefs },
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
          try { this.taskStore.updateStatus(taskId, "failed"); } catch { /* guard */ }
          this.taskStore.queue.failTask(taskId, "Agent reported blocked and could not complete");
        } else {
          console.log(`[OrchestratorService] Worker finished without complete_task, auto-completing ${taskId}`);

          // Publish + merge workspace before completing (same as onWorkerDone path)
          if (this.pluginRegistry) {
            try {
              const result = await this.pluginRegistry.onTaskComplete(taskId, this.goalManager.getGoalId() || undefined);
              if (!result.success) {
                console.warn(`[OrchestratorService] Auto-complete merge warning for ${taskId}: ${result.error}`);
              }
            } catch (err) {
              console.warn(`[OrchestratorService] Auto-complete plugin error for ${taskId}: ${err}`);
            }
          }

          this.taskStore.completeTask(taskId, {
            summary: "Task completed (auto-completed — worker finished without calling complete_task)",
            completedBy: "auto",
            timestamp: Date.now(),
          });
        }
      }
    } catch (error: any) {
      if (this.taskStore.get(taskId)?.status === "completed") return;

      // Classify the error to determine if auto-retry is safe
      const attempt = this.taskAttempts.get(taskId) || 1;
      const report = classifyError(taskId, role, error, attempt);

      log.warn(`Task ${taskId} failed (attempt ${attempt}/${MAX_TASK_RETRIES}): [${report.errorCategory}] ${report.message.slice(0, 200)}`);

      if (report.retriable && attempt < MAX_TASK_RETRIES) {
        // Exponential backoff: 10s, 30s, 60s (generous for 429 retry-after)
        const backoffMs = Math.min(10_000 * Math.pow(2, attempt - 1), 60_000);
        log.info(`Auto-retrying task ${taskId} in ${backoffMs / 1000}s (attempt ${attempt + 1}/${MAX_TASK_RETRIES})`);

        this.taskAttempts.set(taskId, attempt + 1);

        this.callbacks.onTaskUpdate?.({
          taskId, status: "ready", role, timestamp: Date.now(),
        });

        // Reset to ready so state machine allows re-dispatch
        try { this.taskStore.updateStatus(taskId, "failed"); } catch { /* already failed */ }
        try { this.taskStore.updateStatus(taskId, "ready"); } catch { /* guard */ }

        // Schedule retry after backoff
        setTimeout(() => {
          const retryTask = this.taskStore.get(taskId);
          if (!retryTask || retryTask.status !== "ready") return;

          if (this.activeDispatches.has(taskId)) return;
          this.activeDispatches.add(taskId);

          this.dispatchTask(taskId, role).catch((err) => {
            log.error(`Retry dispatch error for ${taskId}:`, err);
          }).finally(() => {
            this.activeDispatches.delete(taskId);
            this.drainDeferredDispatches();
          });
        }, backoffMs);
      } else {
        // Non-retriable or max retries exceeded — fail permanently
        if (attempt >= MAX_TASK_RETRIES) {
          log.error(`Task ${taskId} exhausted all ${MAX_TASK_RETRIES} retry attempts, failing permanently`);
        }
        this.taskAttempts.delete(taskId);
        try { this.taskStore.updateStatus(taskId, "failed"); } catch { /* already failed */ }
        this.taskStore.queue.failTask(taskId, error.message);
      }
    }
  }

  /** Notify planner via NotificationQueue (debounce) or direct callback. */
  private notifyPlanner(message: string): void {
    if (this.notificationQueue) {
      this.notificationQueue.push(message);
    } else {
      this.callbacks.onPlannerInput?.(message);
    }
  }

  /** Public wrapper — used by ChatAgent to send role-level summaries through the same pipe. */
  notifyPlannerFromRole(message: string): void {
    this.notifyPlanner(message);
  }

  reset(): void { this.goalManager.reset(); this.messages = []; }

  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    return this.goalManager.resetPlan();
  }

  async interruptPlan(): Promise<void> {
    return this.goalManager.interruptPlan();
  }

  dispose(): void { this.uim?.cancelAll(); this.notificationQueue?.dispose(); this.goalManager.dispose(); }
}
