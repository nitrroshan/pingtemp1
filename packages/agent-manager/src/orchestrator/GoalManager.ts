/**
 * GoalManager — Goal Lifecycle Manager
 *
 * Responsibility: Own goal state, plan approval, task completion detection,
 * failure cascade, restart recovery. Delegates dispatch to OrchestratorService.
 *
 * Extracted from OrchestratorService (Phase 3.5, SRP refactor).
 * Single-goal for now. Phase 4 adds Map<goalId, GoalContext>.
 */

import type { TaskStore } from "./TaskStore.js";
import type { DependencyResolver } from "./DependencyResolver.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import type { PluginRegistry } from "../plugin/PluginRegistry.js";
import type { CrdtProxy } from "./OrchestratorService.js";
import type { OrchestratorState, GoalManagerCallbacks, IGoalManager, GoalContext, GoalSummary } from "./types.js";
import type { GoalEventBus } from "./events/GoalEventBus.js";
import type { AnyGoalEvent } from "./events/GoalEvents.js";
import type { PlannerAgent } from "./PlannerAgent.js";
import type { ChatAgent } from "../chatAgent/ChatAgent.js";
import type { AgentEvent } from "../agent/types.js";
import { PromptLoader } from "./PromptLoader.js";
import { rootLogger } from "../logging.js";

const log = rootLogger.child({ module: "GoalManager" });

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface GoalManagerConfig {
  teamId: string;
  teamRoles: string[];
  taskStore: TaskStore;
  dagResolver: DependencyResolver;
  workerPool: WorkerPool;
  pluginRegistry?: PluginRegistry;
  planStore?: any;
  crdtTaskSync?: CrdtProxy;
  crdtGoalStore?: CrdtProxy;
  autoExecute: boolean;
  callbacks: GoalManagerCallbacks;
  // Phase 4.5: Factories for per-goal agents (injected by AgentManagerV2)
  createPlanner: (goalId: string) => Promise<PlannerAgent>;
  createChatAgent: (goalId: string, role: string) => ChatAgent;
  /** Stream callback for planner events — routes to Socket.IO */
  onPlannerStream: (data: { goalId: string; taskId: string; agentId: string; part: any }) => void;
  /** Whether chat agents are enabled */
  chatAgentsEnabled: boolean;
  /** Optional callback to load prior conversation from storage */
  loadConversationFn?: ((teamId: string, agentId: string) => Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>>) | null;
  /** Database persistence for tasks (v3.0 — optional, graceful degradation) */
  taskPersistence?: import("./contracts/ITaskPersistence.js").ITaskPersistence | null;
  /** Domain event bus for CRDT projection + notifications */
  eventBus?: GoalEventBus;
}

// ═══════════════════════════════════════════════════════════════════
// GOAL MANAGER
// ═══════════════════════════════════════════════════════════════════

export class GoalManager implements IGoalManager {
  private teamId: string;
  private teamRoles: string[];
  private taskStore: TaskStore;
  private dagResolver: DependencyResolver;
  private workerPool: WorkerPool;
  private pluginRegistry?: PluginRegistry;
  private planStore: any;
  private crdtTaskSyncProxy?: CrdtProxy;
  private crdtGoalStoreProxy?: CrdtProxy;
  private autoExecute: boolean;
  private callbacks: GoalManagerCallbacks;

  // Phase 4.5: Agent factories (injected by AgentManagerV2 composition root)
  private createPlannerFn: (goalId: string) => Promise<PlannerAgent>;
  private createChatAgentFn: (goalId: string, role: string) => ChatAgent;
  private onPlannerStream: GoalManagerConfig["onPlannerStream"];
  private chatAgentsEnabled: boolean;
  /** v3.0: Database persistence for tasks (optional — graceful degradation if null) */
  private taskPersistence: import("./contracts/ITaskPersistence.js").ITaskPersistence | null = null;
  /** Domain event bus — publishes events after MongoDB writes for CRDT projection + notifications */
  private eventBus?: GoalEventBus;

  // Goal state — Map<goalId, GoalContext> for multi-goal support (Phase 4)
  private goals = new Map<string, GoalContext>();
  private activeGoalId: string | null = null;

  constructor(config: GoalManagerConfig) {
    this.teamId = config.teamId;
    this.teamRoles = config.teamRoles;
    this.taskStore = config.taskStore;
    this.dagResolver = config.dagResolver;
    this.workerPool = config.workerPool;
    this.pluginRegistry = config.pluginRegistry;
    this.planStore = config.planStore;
    this.crdtTaskSyncProxy = config.crdtTaskSync;
    this.crdtGoalStoreProxy = config.crdtGoalStore;
    this.autoExecute = config.autoExecute;
    this.callbacks = config.callbacks;
    this.createPlannerFn = config.createPlanner;
    this.createChatAgentFn = config.createChatAgent;
    this.onPlannerStream = config.onPlannerStream;
    this.chatAgentsEnabled = config.chatAgentsEnabled;
    this.taskPersistence = config.taskPersistence || null;
    this.eventBus = config.eventBus;
    log.info(`GoalManager created for team ${config.teamId}`);
  }

  // ─── Domain Event Publishing ──────────────────────────────────────

  /** Publish domain events after MongoDB writes succeed. CRDT + Socket.IO handled by subscribers. */
  private async publishEvents(events: AnyGoalEvent[]): Promise<void> {
    if (this.eventBus) {
      await this.eventBus.publish(events);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GOAL CONTEXT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  /** Get or create a GoalContext. FF gate: single-goal when FF_PARALLEL_PLANS is off. */
  private getOrCreateGoal(goalId: string, title?: string): GoalContext {
    let goal = this.goals.get(goalId);
    if (!goal) {
      if (!process.env.FF_PARALLEL_PLANS && this.goals.size >= 1) {
        // Single-goal mode: clear existing goals
        this.goals.clear();
      }
      goal = {
        goalId,
        state: "idle",
        pendingPlan: null,
        currentPlanId: null,
        title: title || goalId,
        createdAt: Date.now(),
        planner: null,
        chatAgents: new Map(),
      };
      this.goals.set(goalId, goal);
    }
    return goal;
  }

  /** Find the goal currently executing (at most one in v1.0). */
  getExecutingGoal(): GoalContext | undefined {
    for (const g of this.goals.values()) {
      if (g.state === "executing") return g;
    }
    return undefined;
  }

  /** Find which goal a task belongs to. */
  getGoalForTask(taskId: string): GoalContext | undefined {
    const task = this.taskStore.get(taskId);
    return task?.goalId ? this.goals.get(task.goalId) : undefined;
  }

  /** Get summaries of all goals for frontend display. */
  getAllGoalSummaries(): GoalSummary[] {
    return Array.from(this.goals.values()).map(g => ({
      goalId: g.goalId,
      title: g.title,
      state: g.state,
      taskCount: this.taskStore.getByGoal(g.goalId).length,
      completedCount: this.taskStore.getByGoal(g.goalId).filter(t => t.status === "completed").length,
      planId: g.currentPlanId || undefined,
      createdAt: g.createdAt,
    }));
  }

  /** Public wrapper for getOrCreateGoal — used by OrchestratorService to pre-create goals. */
  getOrCreateGoalPublic(goalId: string, title?: string): GoalContext {
    const goal = this.getOrCreateGoal(goalId, title);
    this.activeGoalId = goalId;
    // Ensure ChatAgents exist for this goal (may be new or restored without agents)
    if (goal.chatAgents.size === 0) {
      this.enableChatAgentsForGoal(goalId, this.teamRoles);
    }
    return goal;
  }

  /** Store repo URL on GoalContext — injected into tasks during approvePlan (no LLM dependency). */
  setGoalRepo(goalId: string, repoUrl: string, repoBranch?: string): void {
    const goal = this.getOrCreateGoal(goalId);
    goal.repoUrl = repoUrl;
    goal.repoBranch = repoBranch;

    // Set goal-level config on TaskStore so ALL task creation paths
    // (approvePlan, replan, add_tasks) inherit repoUrl automatically.
    this.taskStore.setGoalConfig({
      goalId,
      repoUrl,
      repoBranch,
    });

    log.info(`[GoalManager] Repo set for goal ${goalId}: ${repoUrl} (branch: ${repoBranch || 'main'})`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PER-GOAL AGENT LIFECYCLE (Phase 4.5 — moved from AgentManagerV2)
  // ═══════════════════════════════════════════════════════════════════

  /** Execute a planner turn for a specific goal. Creates planner lazily. */
  async executePlannerTurn(goalId: string, message: string): Promise<void> {
    const goal = this.getOrCreateGoal(goalId);
    if (!goal.planner) {
      goal.planner = await this.createPlannerFn(goalId);
      log.info(`Created planner for goal ${goalId}`);
    }
    const agent = goal.planner.getAgent();
    const sessionId = `team-${this.teamId}:goal-${goalId}`;
    try {
      for await (const event of agent.execute({ message, threadId: sessionId })) {
        if (event.type === "stream_part") {
          this.onPlannerStream({
            goalId,
            taskId: `team-${this.teamId}`,
            agentId: "planner",
            part: event.part,
          });
        }
      }
    } catch (err) {
      log.error(`Planner execution error for goal ${goalId}: ${err}`);
    }
  }

  /** Enable chat agents (called after GoalManager construction when feature flag confirmed). */
  setChatAgentsEnabled(enabled: boolean): void {
    this.chatAgentsEnabled = enabled;
  }

  /** Create ChatAgents for a specific goal. Creates the goal if it doesn't exist yet. */
  enableChatAgentsForGoal(goalId: string, roles: string[]): void {
    if (!this.chatAgentsEnabled) return;
    // Ensure goal exists (may be called before first message arrives)
    const goal = this.getOrCreateGoal(goalId);
    for (const role of roles) {
      const roleKey = role.toLowerCase();
      if (goal.chatAgents.has(roleKey)) continue;
      const agent = this.createChatAgentFn(goalId, roleKey);
      goal.chatAgents.set(roleKey, agent);
    }
    log.info(`ChatAgents created for goal '${goalId}': ${roles.join(", ")}`);
  }

  /** Dispose all agents for a completed goal. */
  private disposeGoalAgents(goal: GoalContext): void {
    // Dispose ChatAgents
    for (const [, agent] of goal.chatAgents) {
      agent.dispose();
    }
    goal.chatAgents.clear();
    // Release planner reference
    goal.planner = null;
    log.info(`Disposed agents for goal '${goal.goalId}'`);
  }

  /** Get ChatAgent for a specific goal + role. Lazy-creates ChatAgents if goal has none. */
  getChatAgent(goalId: string, role: string): ChatAgent | null {
    const goal = this.goals.get(goalId);
    if (!goal) return null;
    // Lazy-create: goal exists but ChatAgents not yet initialized (restored session, etc.)
    if (goal.chatAgents.size === 0 && this.chatAgentsEnabled) {
      log.info(`Lazy-creating ChatAgents for goal '${goalId}'`);
      this.enableChatAgentsForGoal(goalId, this.teamRoles);
    }
    return goal.chatAgents.get(role.toLowerCase()) ?? null;
  }

  /** Get ChatAgent by role for a specific goal. */
  getChatAgentByRole(role: string, goalId?: string): ChatAgent | null {
    const roleKey = role.toLowerCase();
    const gid = goalId ?? this.activeGoalId;
    if (!gid) return null;

    const goal = this.goals.get(gid);
    if (!goal) return null;

    // Lazy-create ChatAgents if goal has none
    if (goal.chatAgents.size === 0 && this.chatAgentsEnabled) {
      this.enableChatAgentsForGoal(gid, this.teamRoles);
    }
    return goal.chatAgents.get(roleKey) ?? null;
  }

  /** Ingest a task update into the appropriate ChatAgent. */
  ingestTaskUpdateToChatAgent(update: import("../types/TaskUpdate.js").TaskUpdate): void {
    const role = (update as any).role?.toLowerCase();
    if (!role) return;
    const taskGoalId = (update as any).taskId ? this.taskStore.get((update as any).taskId)?.goalId : undefined;
    const agent = this.getChatAgentByRole(role, taskGoalId);
    agent?.ingestTaskUpdate(update);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE ACCESSORS (delegate to active goal)
  // ═══════════════════════════════════════════════════════════════════

  getState(): OrchestratorState {
    const goal = this.activeGoalId ? this.goals.get(this.activeGoalId) : undefined;
    return goal?.state ?? "idle";
  }
  getGoalState(goalId: string): OrchestratorState {
    return this.goals.get(goalId)?.state ?? "idle";
  }
  setState(state: OrchestratorState): void {
    if (this.activeGoalId) {
      const goal = this.goals.get(this.activeGoalId);
      if (goal) goal.state = state;
    }
  }
  setGoalState(goalId: string, state: OrchestratorState): void {
    const goal = this.goals.get(goalId);
    if (goal) goal.state = state;
  }
  getGoalId(): string | null { return this.activeGoalId; }
  getGoalContext(goalId: string) { return this.goals.get(goalId); }
  getPendingPlan(goalId?: string): any | null {
    const gid = goalId ?? this.activeGoalId;
    const goal = gid ? this.goals.get(gid) : undefined;
    return goal?.pendingPlan ?? null;
  }
  setPendingPlan(plan: any | null, goalId?: string): void {
    const gid = goalId ?? this.activeGoalId;
    if (gid) {
      const goal = this.goals.get(gid);
      if (goal) goal.pendingPlan = plan;
    } else if (plan) {
      log.error(`setPendingPlan called without goalId or activeGoalId — this is a bug`);
    }
  }
  setAutoExecute(enabled: boolean): void { this.autoExecute = enabled; }
  getAutoExecute(): boolean { return this.autoExecute; }

  // ═══════════════════════════════════════════════════════════════════
  // PLAN APPROVAL (moved from OrchestratorService.approvePlan)
  // ═══════════════════════════════════════════════════════════════════

  async approvePlan(goalId?: string): Promise<{ success: boolean; tasksQueued?: number; error?: string }> {
    let goal: GoalContext | undefined;

    if (goalId) {
      // Explicit goalId — only approve THAT goal. Never cross goals.
      goal = this.goals.get(goalId);
      if (!goal?.pendingPlan) {
        return { success: false, error: `No pending plan for goal ${goalId}` };
      }
    } else {
      // No goalId (legacy/backward compat) — scan for any goal with a pending plan
      for (const g of this.goals.values()) {
        if (g.pendingPlan) { goal = g; break; }
      }
    }

    if (!goal || !goal.pendingPlan) {
      return { success: false, error: "No pending plan to approve" };
    }

    try {
      const planToApprove = goal.pendingPlan;
      const planId = planToApprove.planId;
      // goalId must already be set on GoalContext (by _handleMessage via client correlation ID)
      const goalId = goal.goalId;
      log.info(`[approvePlan] goal.repoUrl=${goal.repoUrl || 'NONE'}, goal.repoBranch=${goal.repoBranch || 'NONE'}, goalId=${goalId}`);
      if (!goalId) {
        return { success: false, error: "GoalContext has no goalId — client must provide it" };
      }
      goal.pendingPlan = null;

      // Clear previous state for THIS goal only (preserve other goals)
      await this.workerPool.disposeByGoal(goalId);
      await this.taskStore.clearByGoal(goalId);

      // Build dependants map (using goal-scoped task IDs to avoid collision across goals)
      const goalPrefix = goalId.slice(0, 8);
      const scopeId = (id: string) => id.startsWith(goalPrefix) ? id : `${goalPrefix}-${id}`;

      const dependantsMap = new Map<string, string[]>();
      for (const task of planToApprove.tasks) {
        for (const depId of task.dependencies) {
          const existing = dependantsMap.get(scopeId(depId)) || [];
          existing.push(scopeId(task.id));
          dependantsMap.set(scopeId(depId), existing);
        }
      }

      // Add tasks to TaskStore (single writer)
      let tasksQueued = 0;
      for (const task of planToApprove.tasks) {
        const taskContext = (task as any).context || {};
        const taskType = (task as any).type || taskContext.type || "work";
        const scopedId = scopeId(task.id);
        await this.taskStore.create({
          id: scopedId,
          title: task.title,
          description: `${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending",
          priority: task.priority,
          type: taskType,
          expectedOutput: task.expectedOutput,
          goalId,
          planId,
          prerequisites: new Map<string, boolean>(
            task.dependencies.map((depId: string) => [scopeId(depId), false] as [string, boolean]),
          ),
          dependants: dependantsMap.get(scopedId) || [],
          context: {
            title: task.title,
            planId,
            goal: planToApprove.goal,
            priority: task.priority,
            complexity: task.complexity,
            expectedOutput: task.expectedOutput,
            notes: taskContext.notes || "",
            files: taskContext.files || [],
            artifacts: taskContext.artifacts || [],
            relatedTasks: taskContext.relatedTasks || [],
            references: (task as any).references || [],
            type: taskType,
            // repoUrl from GoalContext (set directly by frontend — no LLM dependency)
            repoUrl: goal.repoUrl,
            repoBranch: goal.repoBranch,
          },
        });
        tasksQueued++;
      }

      // Rebuild DAG for this goal
      this.dagResolver.rebuildForGoal(this.taskStore, goalId);

      // All goals execute immediately — no mutex, no queuing
      goal.state = "executing";
      this.activeGoalId = goalId;
      goal.currentPlanId = planId;
      this.workerPool.setTeamId(this.teamId);

      // Enable per-goal ChatAgents (direct — no callback roundtrip)
      this.enableChatAgentsForGoal(goalId, this.teamRoles);

      // ─── CRDT Persistence ───
      if (this.crdtTaskSyncProxy?.resolveForGoal) {
        this.crdtTaskSyncProxy.resolveForGoal(goalId);
      }

      // Publish domain event — CRDT projection + notifications handled by subscribers
      const allTasks = this.taskStore.getByGoal(goalId);
      await this.publishEvents([{
        type: "tasks_created",
        goalId,
        teamId: this.teamId,
        tasks: allTasks,
        planId,
        plan: planToApprove,
        timestamp: Date.now(),
      }]);

      // Update CollaborationPlugin goalId
      const collabPlugin = this.pluginRegistry?.get("collaboration");
      if (collabPlugin && typeof (collabPlugin as any).setGoalId === "function") {
        (collabPlugin as any).setGoalId(goalId);
        log.info(`[approvePlan] CollaborationPlugin goalId set to "${goalId}"`);

        if (typeof (collabPlugin as any).setCollabCallbacks === "function") {
          (collabPlugin as any).setCollabCallbacks({
            onMentionedRoles: (roles: string[], sourceTaskId: string, docName: string, sourceRole?: string, postContent?: string) => {
              // Delegate mention routing back to OrchestratorService via callbacks
              // (spawnCollabWorkers stays in OrchestratorService — it's dispatch logic)
            },
          });
        }
      }

      // Update WorkerPool with resolved CRDT instance
      const resolvedCrdtSync = this.crdtTaskSyncProxy?.get?.();
      if (resolvedCrdtSync) {
        this.workerPool.setTaskServices({
          taskStore: this.taskStore,
          dagResolver: this.dagResolver,
          teamRoles: this.teamRoles,
          crdtTaskSync: resolvedCrdtSync,
          goalId,
          taskPersistence: this.taskPersistence,
        });
      }

      // Persist plan to disk
      if (this.planStore) {
        await this.planStore.savePlan(planToApprove, { goalId, status: "approved" });
        await this.planStore.updatePlanStatus(planId, goalId, "executing");
      }

      // Notify frontend
      this.callbacks.onPlanApproved?.({
        planId,
        teamId: this.teamId,
        goalId,
        tasksQueued,
        timestamp: new Date().toISOString(),
      });

      return { success: true, tasksQueued };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // TASK LIFECYCLE CALLBACKS (wired from RoleTaskQueue via TaskStore)
  // ═══════════════════════════════════════════════════════════════════

  /** Task became ready → publish event, delegate dispatch */
  async onTaskReady({ taskId, role }: { taskId: string; role: string }): Promise<void> {
    log.info(`onTaskReady: ${taskId} (${role})`);
    // Note: TaskStore write-through already persisted the status change to MongoDB

    const goalId = this.taskStore.get(taskId)?.goalId || "";
    await this.publishEvents([{
      type: "task_status_changed",
      goalId, teamId: this.teamId,
      taskId, oldStatus: "pending", newStatus: "ready", role,
      timestamp: Date.now(),
    }]);

    // Delegate dispatch decision to OrchestratorService
    this.callbacks.onDispatchTask(taskId, role);
  }

  /** Task completed → check if all done for this goal, notify planner */
  async onTaskComplete({ taskId, output }: { taskId: string; output: any }): Promise<void> {
    log.info(`onTaskComplete: ${taskId}`);
    const task = this.taskStore.get(taskId);
    const goalId = task?.goalId;
    if (!goalId) { log.warn(`onTaskComplete: task ${taskId} has no goalId`); }
    const goal = goalId ? this.goals.get(goalId) : undefined;

    this.callbacks.onTaskUpdate?.({
      taskId, status: "completed", role: task?.assigned_role, output, timestamp: Date.now(),
    });

    const allComplete = goalId ? this.taskStore.isAllCompleteForGoal(goalId) : false;

    if (allComplete && goal) {
      if (goal.state === "researching") {
        goal.state = "idle";
        this.callbacks.onNotifyPlanner(goalId || "",
          PromptLoader.loadTemplate("orchestrator", "research-complete"),
        );
        this.callbacks.onProgress?.({
          teamId: this.teamId, state: "idle",
          message: "Research complete — ready for planning",
          timestamp: new Date().toISOString(),
        });
      } else {
        if (!goalId) log.error(`onTaskComplete: no goalId for completion summary — task ${taskId}`);
        const goalTasks = goalId ? this.taskStore.getByGoal(goalId) : [];
        const failedTasks = goalTasks.filter(t => t.status === "failed");
        const discardedTasks = goalTasks.filter(t => t.status === "discarded");
        const completedTasks = goalTasks.filter(t => t.status === "completed");

        goal.state = "done";

        if (failedTasks.length > 0) {
          this.callbacks.onNotifyPlanner(goalId || "",
            `⚠️ All tasks finished but ${failedTasks.length} failed:\n` +
            failedTasks.map(t => `- ${t.id} (${t.assigned_role}): ${t.description?.slice(0, 80)}`).join("\n") +
            `\n\n${completedTasks.length} completed, ${discardedTasks.length} discarded.` +
            `\n\nACTION REQUIRED — call a tool NOW:` +
            `\n- Call \`get_status\` to review details` +
            `\n- Call \`reassign_task\` to retry failed tasks` +
            `\n- Call \`replan\` to replace the plan` +
            `\n- Or tell the user the results if no recovery is possible` +
            `\nDo NOT just describe what happened — take action.`,
          );
          if (completedTasks.length === 0) {
            this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, goalId: goalId || "", status: "failed" });
          }
          this.callbacks.onProgress?.({
            teamId: this.teamId, state: "idle",
            message: `${completedTasks.length} completed, ${failedTasks.length} failed`,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Publish plan + goal completed events
          await this.publishEvents([
            { type: "plan_status_changed", goalId: goalId || "", teamId: this.teamId, status: "completed", timestamp: Date.now() },
            { type: "goal_status_changed", goalId: goalId || "", teamId: this.teamId, status: "completed", timestamp: Date.now() },
          ]);

          this.callbacks.onNotifyPlanner(goalId || "", PromptLoader.loadTemplate("orchestrator", "all-complete"));
          this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, goalId: goalId || "", status: "completed" });
          this.callbacks.onProgress?.({
            teamId: this.teamId, state: "idle",
            message: "All tasks completed successfully",
            timestamp: new Date().toISOString(),
          });
        }

        // Goal completed — dispose agents
        if (goal.state === "done") {
          this.disposeGoalAgents(goal);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FAILURE HANDLING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle dependency failure — applies onDependencyFail strategy to downstream tasks.
   * Strategies: "replan" (default), "fail" (cascade), "skip" (mark complete with note)
   */
  async handleTaskFailure(taskId: string, reason: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task) return;
    if (!task.goalId) {
      log.error(`[GoalManager] handleTaskFailure: task ${taskId} has no goalId — cannot scope dependant scan`);
      return;
    }

    const dependants = this.taskStore.getByGoal(task.goalId).filter(
      (t) => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed"
    );

    if (dependants.length === 0) return;

    for (const dep of dependants) {
      const strategy = (dep.context as any)?.onDependencyFail || "replan";

      switch (strategy) {
        case "fail":
          await this.taskStore.updateStatus(dep.id, "failed");
          this.callbacks.onTaskUpdate?.({
            taskId: dep.id, status: "failed", role: dep.assigned_role, timestamp: Date.now(),
          });
          log.info(`[DependencyFail] Cascaded failure: ${taskId} → ${dep.id} (${dep.assigned_role})`);
          this.handleTaskFailure(dep.id, `Upstream dependency ${taskId} failed`);
          break;

        case "skip":
          await this.taskStore.completeTask(dep.id, {
            summary: `Skipped: upstream dependency ${taskId} failed`,
            skipped: true,
            skipReason: reason,
          });
          this.callbacks.onTaskUpdate?.({
            taskId: dep.id, status: "completed", role: dep.assigned_role, timestamp: Date.now(),
          });
          log.info(`[DependencyFail] Skipped: ${dep.id} (upstream ${taskId} failed)`);
          break;

        case "replan":
        default:
          log.info(`[DependencyFail] Awaiting planner decision for ${dep.id} (blocked by ${taskId})`);
          break;
      }
    }
  }

  /** Task failed → notify plugins, sync CRDT, cascade, notify planner */
  async onTaskFailed({ taskId, error }: { taskId: string; error: string }): Promise<void> {
    const lowerError = error.toLowerCase();
    const isRateLimit = lowerError.includes("rate limit") || lowerError.includes("429") || lowerError.includes("too many requests");

    // Rate limit = infrastructure error, not task failure.
    // Don't cascade, don't notify planner (avoids replan spiral).
    // DispatchManager already retries with exponential backoff.
    if (isRateLimit) {
      log.warn(`[GoalManager] Rate limited: ${taskId} — not notifying planner (DispatchManager handles retries)`);
      this.callbacks.onTaskUpdate?.({
        taskId, status: "failed", role: this.taskStore.get(taskId)?.assigned_role, timestamp: Date.now(),
      });
      return;
    }

    log.error(`onTaskFailed: ${taskId}: ${error}`);
    const task = this.taskStore.get(taskId);
    // Note: TaskStore write-through handles MongoDB persistence

    if (task) {
      task.output = { error, failedAt: new Date().toISOString(), summary: `FAILED: ${error}` };
    }

    this.pluginRegistry?.onTaskFailed(taskId).catch((err) => {
      log.warn(`Plugin onTaskFailed error for ${taskId}: ${err}`);
    });

    // Publish task failed event (CRDT projection + notifications)
    const failGoalId = task?.goalId || "";
    await this.publishEvents([{
      type: "task_status_changed",
      goalId: failGoalId, teamId: this.teamId,
      taskId, oldStatus: task?.status || "in_progress", newStatus: "failed",
      role: task?.assigned_role, output: { error },
      timestamp: Date.now(),
    }]);

    // Check research phase completion
    const goal = task?.goalId ? this.goals.get(task.goalId) : undefined;
    const goalId = task?.goalId;
    if (!goalId) { log.warn(`onTaskFailed: task ${taskId} has no goalId`); }
    const allTasksDone = goalId
      ? this.taskStore.getByGoal(goalId).every((t) => t.status === "completed" || t.status === "failed")
      : false;
    if (goal?.state === "researching" && allTasksDone) {
      goal.state = "idle";
      this.callbacks.onNotifyPlanner(goalId || "",
        PromptLoader.loadTemplate("orchestrator", "research-failed"),
      );
      this.callbacks.onProgress?.({
        teamId: this.teamId, state: "idle",
        message: "Research phase completed with failures",
        timestamp: new Date().toISOString(),
      });
    }

    this.callbacks.onTaskUpdate?.({
      taskId, status: "failed", role: task?.assigned_role, timestamp: Date.now(),
    });

    // Cascade to dependants
    await this.handleTaskFailure(taskId, error);

    // Notify planner with blocked downstream info
    if (!goalId) log.error(`onTaskFailed: task ${taskId} has no goalId for blocked task scan`);
    const blockedTasks = (goalId ? this.taskStore.getByGoal(goalId) : [])
      .filter(t => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed")
      .map(t => `${t.id} (${t.assigned_role})`)
      .join(", ") || null;

    this.callbacks.onNotifyPlanner(goalId || "",
      PromptLoader.loadTemplate("orchestrator", "task-failed", {
        description: task?.description || taskId,
        role: task?.assigned_role || "unknown",
        error,
        blockedSuffix: blockedTasks
          ? `⚠️ Blocked downstream tasks: ${blockedTasks}\n`
          : "",
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // WORKER DONE (complete_task tool called by agent)
  // ═══════════════════════════════════════════════════════════════════

  /** Worker completed via complete_task tool → merge workspace, then mark complete */
  async onWorkerDone(data: {
    taskId: string; role: string; summary: string;
    deliverables?: string[]; nextSteps?: string[];
    producedDocs?: Array<{ uri: string; name: string; description?: string }>;
    decisions?: string[];
    timestamp: number;
  }): Promise<void> {
    log.info(`[GoalManager] Worker done: ${data.taskId}`);

    const currentTask = this.taskStore.get(data.taskId);

    // Collab workers have IDs like "collab-task-5-discussion-frontend" — not in TaskStore
    if (!currentTask && data.taskId.startsWith("collab-")) {
      log.debug(`Collab worker ${data.taskId} completed — no TaskStore entry (expected)`);
      return;
    }

    if (currentTask && (currentTask.status === "completed" || currentTask.status === "discarded")) {
      log.debug(`Task ${data.taskId} already ${currentTask.status} — skipping onWorkerDone`);
      return;
    }

    // Mark that agent called complete_task — prevents auto-complete race
    if (currentTask) {
      currentTask.completionSource = "tool";
    }

    // Auto-close discussion CRDT (before marking complete)
    const completingTask = this.taskStore.get(data.taskId);
    if (completingTask && (completingTask.type === "discussion" || completingTask.type === "collaboration")) {
      try {
        const crdtSync = this.crdtTaskSyncProxy?.get?.();
        if (crdtSync) {
          const discussionDoc = await crdtSync.space.openDoc(`${data.taskId}/discussion`);
          const configMap = discussionDoc.getMap("config");
          if (configMap.get("status") !== "closed") {
            configMap.set("status", "closed");
            log.info(`Auto-closed discussion for completed task ${data.taskId}`);
          }
        }
      } catch (err) {
        log.debug(`Failed to auto-close discussion for ${data.taskId}: ${err}`);
      }
    }

    // 1. Publish + Merge SYNCHRONOUSLY (before completing task)
    //    Downstream tasks create worktrees from main — main must have this task's work.
    //    Merge failures are non-fatal: task still completes, dependents may lack files.
    if (this.pluginRegistry) {
      const taskForGoal = this.taskStore.get(data.taskId);
      const goalId = taskForGoal?.goalId;
      if (!goalId) log.error(`[GoalManager] onWorkerDone: task ${data.taskId} has no goalId — data integrity bug`);
      try {
        const result = await this.pluginRegistry.onTaskComplete(data.taskId, goalId);
        if (!result.success) {
          log.warn(`[GoalManager] Workspace merge failed for ${data.taskId}: ${result.error} (task will still complete)`);
        } else {
          log.info(`[GoalManager] Infrastructure complete for ${data.taskId}`);
        }
      } catch (err: any) {
        log.warn(`[GoalManager] Infrastructure error for ${data.taskId}: ${err.message} (task will still complete)`);
      }
    }

    // 2. Mark complete — agent work succeeded regardless of merge outcome
    //    completeTask() resolves dependents internally → unblocks downstream tasks
    //    Dependents create worktrees AFTER merge, so they see upstream files.
    await this.taskStore.completeTask(data.taskId, {
      summary: data.summary,
      deliverables: data.deliverables,
      nextSteps: data.nextSteps,
      producedDocs: data.producedDocs,
      decisions: data.decisions,
      completedBy: "agent", timestamp: data.timestamp,
    });
    // Note: TaskStore write-through handles MongoDB persistence

    // Publish task completed event (CRDT projection + notifications)
    const doneGoalId = this.taskStore.get(data.taskId)?.goalId || "";
    await this.publishEvents([{
      type: "task_completed",
      goalId: doneGoalId, teamId: this.teamId,
      taskId: data.taskId, role: data.role,
      output: { summary: data.summary, deliverables: data.deliverables, producedDocs: data.producedDocs, decisions: data.decisions },
      newlyReady: [],
      timestamp: data.timestamp,
    }]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  reset(): void {
    // Dispose agents for all goals
    for (const goal of this.goals.values()) {
      this.disposeGoalAgents(goal);
    }
    // Clear all goals
    this.goals.clear();
    this.activeGoalId = null;
  }

  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    try {
      if (this.planStore) {
        const s = await this.planStore.getLatestActivePlan();
        if (s && (s.metadata.status === "executing" || s.metadata.status === "approved")) {
          await this.planStore.archivePlan(s.plan.planId, s.metadata.goalId);
          await this.publishEvents([{
            type: "plan_status_changed",
            goalId: s.metadata.goalId || "", teamId: this.teamId,
            status: "archived", planId: s.plan.planId,
            timestamp: Date.now(),
          }]);
          this.reset();
          return { deleted: true, planId: s.plan.planId };
        }
      }
      this.reset();
      return { deleted: false };
    } catch {
      this.reset();
      return { deleted: false };
    }
  }

  async interruptPlan(): Promise<void> {
    if (!this.planStore) return;
    try {
      const s = await this.planStore.getLatestActivePlan();
      if (s?.metadata.status === "executing") {
        await this.planStore.updatePlanStatus(s.plan.planId, s.metadata.goalId, "interrupted");
        await this.publishEvents([{
          type: "plan_status_changed",
          goalId: s.metadata.goalId || "", teamId: this.teamId,
          status: "interrupted", planId: s.plan.planId,
          timestamp: Date.now(),
        }]);
      }
    } catch { /* best effort */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESTART RECOVERY
  // ═══════════════════════════════════════════════════════════════════
  // v3.0: DATABASE RECOVERY
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Load tasks from database on startup (v3.0).
   * Hydrates TaskStore + GoalContext from persisted state.
   * in_progress tasks → ready (workers can't be recovered).
   * Returns true if recovery succeeded, false if no data found.
   */
  async loadFromDatabase(): Promise<boolean> {
    if (!this.taskPersistence) return false;

    try {
      const tasks = await this.taskPersistence.getTasksByTeam(this.teamId);
      if (tasks.length === 0) return false;

      // Group by goalId
      const byGoal = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const arr = byGoal.get(t.goalId) || [];
        arr.push(t);
        byGoal.set(t.goalId, arr);
      }

      for (const [goalId, goalTasks] of byGoal) {
        // Derive goal state from task statuses
        const allCompleted = goalTasks.every(t => t.status === "completed");
        const anyFailed = goalTasks.some(t => t.status === "failed");
        const derivedState = allCompleted ? "done" : anyFailed ? "executing" : "executing";

        // Create GoalContext if missing
        if (!this.goals.has(goalId)) {
          this.goals.set(goalId, {
            goalId,
            state: derivedState as any,
            pendingPlan: null,
            currentPlanId: goalTasks[0]?.planId || null,
            title: goalTasks[0]?.title || "Recovered goal",
            createdAt: Date.now(),
            planner: null,
            chatAgents: new Map(),
          });
        }

        // Hydrate tasks into TaskStore
        for (const t of goalTasks) {
          // Reset in_progress → ready (workers can't survive restart)
          const status = t.status === "in_progress" ? "ready" : t.status;

          await this.taskStore.create({
            id: t.taskId,
            title: t.title,
            description: t.description,
            assigned_role: t.assignedRole,
            status: status as any,
            priority: t.priority,
            goalId: t.goalId,
            planId: t.planId,
            output: t.output,
            // Reconstruct prerequisites from persisted dependencies
            // completed deps → true, pending/ready/failed → false
            prerequisites: new Map(
              (t.dependencies || []).map((depId: string) => {
                const dep = goalTasks.find(dt => dt.taskId === depId);
                return [depId, dep?.status === "completed"] as [string, boolean];
              }),
            ),
            dependants: [], // rebuilt by dagResolver.rebuildForGoal below
          });
        }

        this.dagResolver.rebuildForGoal(this.taskStore, goalId);
      }

      log.info(`[loadFromDatabase] Recovered ${tasks.length} tasks across ${byGoal.size} goals`);
      return true;
    } catch (err) {
      log.error({ err }, "[loadFromDatabase] Database recovery failed — no fallback, system will start without prior state");
      return false;
    }
  }

  dispose(): void {
    // Nothing to dispose in single-goal mode.
    // Phase 4: dispose per-goal planners and ChatAgents.
  }
}
