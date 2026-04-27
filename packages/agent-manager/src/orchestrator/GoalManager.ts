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
    log.info(`GoalManager created for team ${config.teamId}`);
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

  /** Get ChatAgent by role, searching across goals. Creates ChatAgents lazily if needed. */
  getChatAgentByRole(role: string): ChatAgent | null {
    const roleKey = role.toLowerCase();
    // Try active goal first
    if (this.activeGoalId) {
      const goal = this.goals.get(this.activeGoalId);
      if (goal) {
        // Lazy-create ChatAgents if goal has none (e.g., restored from previous session)
        if (goal.chatAgents.size === 0 && this.chatAgentsEnabled) {
          this.enableChatAgentsForGoal(this.activeGoalId, this.teamRoles);
        }
        const agent = goal.chatAgents.get(roleKey);
        if (agent) return agent;
      }
    }
    // Fallback: search all goals
    for (const goal of this.goals.values()) {
      if (goal.chatAgents.size === 0 && this.chatAgentsEnabled) {
        this.enableChatAgentsForGoal(goal.goalId, this.teamRoles);
      }
      const agent = goal.chatAgents.get(roleKey);
      if (agent) return agent;
    }
    return null;
  }

  /** Ingest a task update into the appropriate ChatAgent. */
  ingestTaskUpdateToChatAgent(update: import("../types/TaskUpdate.js").TaskUpdate): void {
    const role = (update as any).role?.toLowerCase();
    if (!role) return;
    const agent = this.getChatAgentByRole(role);
    agent?.ingestTaskUpdate(update);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE ACCESSORS (delegate to active goal)
  // ═══════════════════════════════════════════════════════════════════

  getState(): OrchestratorState {
    const goal = this.activeGoalId ? this.goals.get(this.activeGoalId) : undefined;
    return goal?.state ?? "idle";
  }
  setState(state: OrchestratorState): void {
    if (this.activeGoalId) {
      const goal = this.goals.get(this.activeGoalId);
      if (goal) goal.state = state;
    }
  }
  getGoalId(): string | null { return this.activeGoalId; }
  getPendingPlan(): any | null {
    const goal = this.activeGoalId ? this.goals.get(this.activeGoalId) : undefined;
    return goal?.pendingPlan ?? null;
  }
  setPendingPlan(plan: any | null): void {
    if (this.activeGoalId) {
      const goal = this.goals.get(this.activeGoalId);
      if (goal) goal.pendingPlan = plan;
    } else if (plan) {
      // activeGoalId must be set by _handleMessage before plan submission.
      // If we reach here, it's a bug — log and reject.
      log.error(`setPendingPlan called without activeGoalId — this is a bug`);
    }
  }
  setAutoExecute(enabled: boolean): void { this.autoExecute = enabled; }
  getAutoExecute(): boolean { return this.autoExecute; }

  // ═══════════════════════════════════════════════════════════════════
  // PLAN APPROVAL (moved from OrchestratorService.approvePlan)
  // ═══════════════════════════════════════════════════════════════════

  async approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }> {
    // Find the goal with a pending plan
    let goal: GoalContext | undefined;
    for (const g of this.goals.values()) {
      if (g.pendingPlan) { goal = g; break; }
    }
    if (!goal || !goal.pendingPlan) {
      return { success: false, error: "No pending plan to approve" };
    }

    try {
      const planToApprove = goal.pendingPlan;
      const planId = planToApprove.planId;
      // goalId must already be set on GoalContext (by _handleMessage via client correlation ID)
      const goalId = goal.goalId;
      if (!goalId) {
        return { success: false, error: "GoalContext has no goalId — client must provide it" };
      }
      goal.pendingPlan = null;

      // Clear previous state for THIS goal only (preserve other goals)
      await this.workerPool.disposeByGoal(goalId);
      this.taskStore.clearByGoal(goalId);

      // Build dependants map
      const dependantsMap = new Map<string, string[]>();
      for (const task of planToApprove.tasks) {
        for (const depId of task.dependencies) {
          const existing = dependantsMap.get(depId) || [];
          existing.push(task.id);
          dependantsMap.set(depId, existing);
        }
      }

      // Add tasks to TaskStore (single writer)
      let tasksQueued = 0;
      for (const task of planToApprove.tasks) {
        const taskContext = (task as any).context || {};
        const taskType = (task as any).type || taskContext.type || "work";
        this.taskStore.create({
          id: task.id,
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
            task.dependencies.map((depId: string) => [depId, false] as [string, boolean]),
          ),
          dependants: dependantsMap.get(task.id) || [],
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
            repoUrl: (planToApprove as any).repoUrl,
            repoBranch: (planToApprove as any).repoBranch,
          },
        });
        tasksQueued++;
      }

      // Rebuild DAG from TaskStore
      this.dagResolver.rebuild(this.taskStore);

      // Update state — execution mutex
      const executing = this.getExecutingGoal();
      if (executing && executing.goalId !== goalId) {
        goal.state = "queued";
        log.info(`Goal ${goalId} queued — ${executing.goalId} is executing`);
      } else {
        goal.state = "executing";
        this.activeGoalId = goalId;
      }
      goal.currentPlanId = planId;
      this.workerPool.setTeamId(this.teamId);

      // Enable per-goal ChatAgents (direct — no callback roundtrip)
      this.enableChatAgentsForGoal(goalId, this.teamRoles);

      // ─── CRDT Persistence ───
      if (this.crdtTaskSyncProxy?.resolveForGoal) {
        this.crdtTaskSyncProxy.resolveForGoal(goalId);
      }

      // Persist all tasks to CRDT (enables restore on restart)
      const crdtSync = this.crdtTaskSyncProxy?.get?.();
      if (crdtSync?.persistTask) {
        const allTasks = this.taskStore.getByGoal(goalId);
        for (const task of allTasks) {
          await crdtSync.persistTask(task);
        }
        await crdtSync.updateIndex(allTasks);
        log.info(`[approvePlan] Persisted ${allTasks.length} tasks to CRDT`);
      }

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
          planId,
          goalId,
        });
      }

      // Persist goal, plan, and tasks to CRDT
      const crdtGoalStore = this.crdtGoalStoreProxy?.get?.();
      if (crdtGoalStore) {
        await crdtGoalStore.saveGoal(
          goalId,
          planToApprove.goal || planId,
          planToApprove.goal || "",
        );
        await crdtGoalStore.updateStatus("executing", planId);
      }

      const crdtTaskSync = this.crdtTaskSyncProxy?.get?.();
      if (crdtTaskSync) {
        let persistedCount = 0;
        const allTasks = this.taskStore.getAll();
        for (const task of allTasks) {
          try {
            await crdtTaskSync.persistTask(task);
            persistedCount++;
          } catch (err) {
            log.error(`[approvePlan] Failed to persist task ${task.id} to CRDT: ${err}`);
          }
        }
        log.info(`[approvePlan] Persisted ${persistedCount}/${allTasks.length} tasks to CRDT`);
        try {
          await crdtTaskSync.persistPlan(planToApprove, goalId);
        } catch (err) {
          log.error(`[approvePlan] Failed to persist plan to CRDT: ${err}`);
        }
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

  /** Task became ready → notify frontend, delegate dispatch to OrchestratorService */
  onTaskReady({ taskId, role }: { taskId: string; role: string }): void {
    log.info(`onTaskReady: ${taskId} (${role})`);

    this.callbacks.onTaskUpdate?.({
      taskId, status: "ready", role, timestamp: Date.now(),
    });

    // Delegate dispatch decision to OrchestratorService
    // (handles autoExecute check, ChatAgent routing, concurrency limits)
    this.callbacks.onDispatchTask(taskId, role);
  }

  /** Task completed → check if all done for this goal, notify planner */
  onTaskComplete({ taskId, output }: { taskId: string; output: any }): void {
    log.info(`onTaskComplete: ${taskId}`);
    const task = this.taskStore.get(taskId);
    const goal = task?.goalId ? this.goals.get(task.goalId) : this.activeGoalId ? this.goals.get(this.activeGoalId) : undefined;

    this.callbacks.onTaskUpdate?.({
      taskId, status: "completed", role: task?.assigned_role, output, timestamp: Date.now(),
    });

    const goalId = task?.goalId || this.activeGoalId;
    const allComplete = goalId ? this.taskStore.isAllCompleteForGoal(goalId) : this.taskStore.isAllComplete();

    if (allComplete && goal) {
      if (goal.state === "researching") {
        goal.state = "idle";
        this.callbacks.onNotifyPlanner(
          PromptLoader.loadTemplate("orchestrator", "research-complete"),
        );
        this.callbacks.onProgress?.({
          teamId: this.teamId, state: "idle",
          message: "Research complete — ready for planning",
          timestamp: new Date().toISOString(),
        });
      } else {
        const goalTasks = goalId ? this.taskStore.getByGoal(goalId) : this.taskStore.getAll();
        const failedTasks = goalTasks.filter(t => t.status === "failed");
        const discardedTasks = goalTasks.filter(t => t.status === "discarded");
        const completedTasks = goalTasks.filter(t => t.status === "completed");

        goal.state = "done";

        if (failedTasks.length > 0) {
          this.callbacks.onNotifyPlanner(
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
            this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, status: "failed" });
          }
          this.callbacks.onProgress?.({
            teamId: this.teamId, state: "idle",
            message: `${completedTasks.length} completed, ${failedTasks.length} failed`,
            timestamp: new Date().toISOString(),
          });
        } else {
          const crdtSyncComplete = this.crdtTaskSyncProxy?.get?.();
          if (crdtSyncComplete?.syncPlanStatus) {
            crdtSyncComplete.syncPlanStatus("completed").catch((err: any) => {
              log.warn(`Failed to sync plan completion to CRDT: ${err}`);
            });
          }
          this.callbacks.onNotifyPlanner(PromptLoader.loadTemplate("orchestrator", "all-complete"));
          this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, status: "completed" });
          this.callbacks.onProgress?.({
            teamId: this.teamId, state: "idle",
            message: "All tasks completed successfully",
            timestamp: new Date().toISOString(),
          });
        }

        // Auto-advance: if this goal is done, start the next queued goal
        if (goal.state === "done") {
          // Dispose agents for the completed goal (direct — no callback roundtrip)
          this.disposeGoalAgents(goal);
          this.autoAdvanceToNextGoal();
        }
      }
    }
  }

  /** Auto-advance: find and start the next queued goal after the current one completes. */
  private autoAdvanceToNextGoal(): void {
    for (const candidate of this.goals.values()) {
      if (candidate.state === "queued") {
        candidate.state = "executing";
        this.activeGoalId = candidate.goalId;
        log.info(`Auto-advancing to queued goal: ${candidate.goalId} ("${candidate.title}")`);

        // Enable ChatAgents for the new executing goal (direct)
        this.enableChatAgentsForGoal(candidate.goalId, this.teamRoles);

        // Dispatch ready tasks for the new active goal
        for (const task of this.taskStore.getByGoal(candidate.goalId)) {
          if (task.status === "ready") {
            this.callbacks.onDispatchTask(task.id, task.assigned_role);
          }
        }
        this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, status: "executing" as any });
        return;
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
  handleTaskFailure(taskId: string, reason: string): void {
    const task = this.taskStore.get(taskId);
    if (!task) return;

    const dependants = this.taskStore.getAll().filter(
      (t) => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed"
    );

    if (dependants.length === 0) return;

    for (const dep of dependants) {
      const strategy = (dep.context as any)?.onDependencyFail || "replan";

      switch (strategy) {
        case "fail":
          this.taskStore.updateStatus(dep.id, "failed");
          this.callbacks.onTaskUpdate?.({
            taskId: dep.id, status: "failed", role: dep.assigned_role, timestamp: Date.now(),
          });
          log.info(`[DependencyFail] Cascaded failure: ${taskId} → ${dep.id} (${dep.assigned_role})`);
          this.handleTaskFailure(dep.id, `Upstream dependency ${taskId} failed`);
          break;

        case "skip":
          this.taskStore.completeTask(dep.id, {
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
  onTaskFailed({ taskId, error }: { taskId: string; error: string }): void {
    log.error(`onTaskFailed: ${taskId}: ${error}`);
    const task = this.taskStore.get(taskId);

    if (task) {
      task.output = { error, failedAt: new Date().toISOString(), summary: `FAILED: ${error}` };
    }

    this.pluginRegistry?.onTaskFailed(taskId).catch((err) => {
      log.warn(`Plugin onTaskFailed error for ${taskId}: ${err}`);
    });

    // CRDT sync
    const crdtSync = this.crdtTaskSyncProxy?.get?.();
    if (crdtSync) {
      crdtSync.syncStatus(taskId, "failed").catch((err: any) => {
        log.warn(`CRDT sync failed for task ${taskId}: ${err}`);
      });
      crdtSync.updateIndex(this.taskStore.getAll()).catch(() => {});
    }

    // Check research phase completion
    const goal = task?.goalId ? this.goals.get(task.goalId) : this.activeGoalId ? this.goals.get(this.activeGoalId) : undefined;
    const goalId = task?.goalId || this.activeGoalId;
    const allTasksDone = goalId
      ? this.taskStore.getByGoal(goalId).every((t) => t.status === "completed" || t.status === "failed")
      : this.taskStore.getAll().every((t) => t.status === "completed" || t.status === "failed");
    if (goal?.state === "researching" && allTasksDone) {
      goal.state = "idle";
      this.callbacks.onNotifyPlanner(
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
    this.handleTaskFailure(taskId, error);

    // Notify planner with blocked downstream info
    const blockedTasks = this.taskStore.getAll()
      .filter(t => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed")
      .map(t => `${t.id} (${t.assigned_role})`)
      .join(", ") || null;

    this.callbacks.onNotifyPlanner(
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

  /** Worker completed via complete_task tool → notify plugins, mark complete */
  async onWorkerDone(data: {
    taskId: string; role: string; summary: string;
    deliverables?: string[]; nextSteps?: string[]; timestamp: number;
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

    // Notify plugins (workspace publish + merge)
    if (this.pluginRegistry) {
      try {
        const result = await this.pluginRegistry.onTaskComplete(data.taskId, this.activeGoalId || undefined);
        if (!result.success) {
          const mergeError = `Workspace merge failed: ${result.error}`;
          log.error(`[GoalManager] ${mergeError}`);
          try { this.taskStore.updateStatus(data.taskId, "failed"); } catch { /* already failed */ }
          this.taskStore.queue.failTask(data.taskId, mergeError);
          this.callbacks.onTaskUpdate?.({ taskId: data.taskId, status: "failed", timestamp: data.timestamp });

          // Merge conflicts → create resolution task
          if (result.error?.includes("Merge conflicts")) {
            const failedTask = this.taskStore.get(data.taskId);
            if (failedTask) {
              const resolveId = `resolve-${data.taskId}`;
              try {
                this.taskStore.create({
                  id: resolveId,
                  title: `Resolve merge conflicts from: ${failedTask.title || data.taskId}`,
                  description: `Merge conflicts detected after task completion. ${result.error}. ` +
                    `Resolve the conflicts on branch and commit the resolution.`,
                  assigned_role: failedTask.assigned_role,
                  goalId: failedTask.goalId,
                  planId: failedTask.planId,
                  status: "pending",
                  prerequisites: new Map(),
                  dependants: failedTask.dependants || [],
                });
                log.info(`Created merge resolution task: ${resolveId} for role ${failedTask.assigned_role}`);
              } catch (err) {
                log.warn(`Failed to create resolution task: ${err}`);
              }
            }
          }
          return;
        }
      } catch (err) {
        const mergeError = `Plugin cleanup crashed for task ${data.taskId}: ${err}`;
        log.error(`[GoalManager] ${mergeError}`);
        try { this.taskStore.updateStatus(data.taskId, "failed"); } catch { /* already failed */ }
        this.taskStore.queue.failTask(data.taskId, mergeError);
        this.callbacks.onTaskUpdate?.({ taskId: data.taskId, status: "failed", timestamp: data.timestamp });
        return;
      }
    }

    // Auto-close discussion CRDT
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

    // Mark complete in TaskStore → triggers onTaskComplete via RoleTaskQueue
    this.taskStore.completeTask(data.taskId, {
      summary: data.summary,
      deliverables: data.deliverables,
      nextSteps: data.nextSteps, completedBy: "agent", timestamp: data.timestamp,
    });

    // CRDT persistence
    const crdtSyncDone = this.crdtTaskSyncProxy?.get?.();
    if (crdtSyncDone) {
      await crdtSyncDone.syncStatus(data.taskId, "completed", {
        summary: data.summary,
        deliverables: data.deliverables,
        nextSteps: data.nextSteps,
      });
      await crdtSyncDone.updateIndex(this.taskStore.getAll());
    }
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
          const crdtSync = this.crdtTaskSyncProxy?.get?.();
          if (crdtSync?.syncPlanStatus) {
            await crdtSync.syncPlanStatus("interrupted").catch(() => {});
          }
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
        const crdtSync = this.crdtTaskSyncProxy?.get?.();
        if (crdtSync?.syncPlanStatus) {
          await crdtSync.syncPlanStatus("interrupted").catch(() => {});
        }
      }
    } catch { /* best effort */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESTART RECOVERY
  // ═══════════════════════════════════════════════════════════════════

  async loadActivePlan(): Promise<void> {
    if (!this.planStore) { log.info("[loadActivePlan] No planStore — skipping"); return; }
    try {
      const stored = await this.planStore.getLatestActivePlan();
      if (!stored) { log.info("[loadActivePlan] No active plan found on disk"); return; }
      const goalId = stored.metadata.goalId || null;
      if (!goalId) { log.info("[loadActivePlan] Plan has no goalId — skipping"); return; }

      log.info(`[loadActivePlan] Found plan: goalId=${goalId}, planId=${stored.plan?.planId}, status=${stored.metadata.status}, tasks=${stored.plan?.tasks?.length}`);

      this.activeGoalId = goalId;
      const goal = this.getOrCreateGoal(goalId, stored.plan?.goal || goalId);

      if (stored.metadata.status === "approved") {
        goal.pendingPlan = stored.plan;
        goal.state = "awaiting_approval";
        log.info("[loadActivePlan] Plan awaiting approval");
      } else if (stored.metadata.status === "executing") {
        goal.currentPlanId = stored.plan?.planId || null;
        const dep = new Map<string, string[]>();
        for (const t of stored.plan.tasks) {
          for (const d of t.dependencies) {
            const e = dep.get(d) || []; e.push(t.id); dep.set(d, e);
          }
        }

        // Restore task statuses from CRDT
        let crdtTasks: Map<string, any> | null = null;
        log.info(`[loadActivePlan] crdtTaskSyncProxy exists: ${!!this.crdtTaskSyncProxy}`);
        if (this.crdtTaskSyncProxy) {
          try {
            this.crdtTaskSyncProxy.resolveForGoal(goalId);
            this.crdtGoalStoreProxy?.resolveForGoal?.(goalId);
            const crdtSync = this.crdtTaskSyncProxy.get?.();
            log.info(`[loadActivePlan] crdtSync resolved: ${!!crdtSync}, hasLoadAllTasks: ${!!crdtSync?.loadAllTasks}`);
            if (crdtSync?.loadAllTasks) {
              const loaded = await crdtSync.loadAllTasks();
              log.info(`[loadActivePlan] CRDT returned ${loaded.length} tasks`);
              if (loaded.length > 0) {
                crdtTasks = new Map(loaded.map((t: any) => [t.id, t]));
                for (const t of loaded) {
                  log.info(`  CRDT task ${t.id}: status=${t.status}, hasOutput=${!!t.output}`);
                }
              }
            }
          } catch (err) {
            log.warn(`[loadActivePlan] Failed to read CRDT task state: ${err}`);
          }
        }

        for (const t of stored.plan.tasks) {
          const crdtTask = crdtTasks?.get(t.id);
          let status = crdtTask?.status ?? "pending";
          if (status === "in_progress") status = "ready";

          log.info(`  Restoring task ${t.id} (${t.assignedRole}): crdtStatus=${crdtTask?.status ?? 'NONE'} → finalStatus=${status}`);

          const prerequisites = crdtTask?.prerequisites
            ?? new Map(t.dependencies.map((d: string) => [d, false] as [string, boolean]));

          this.taskStore.create({
            id: t.id,
            description: crdtTask?.description ?? `${t.title}: ${t.description}`,
            assigned_role: t.assignedRole.toLowerCase(),
            status,
            output: crdtTask?.output,
            prerequisites,
            dependants: dep.get(t.id) || [],
            goalId,
            planId: stored.plan?.planId,
            context: crdtTask?.context ?? { title: t.title, planId: stored.plan.planId, goal: stored.plan.goal },
          });
        }
        goal.state = "executing";

        const completed = this.taskStore.getByGoal(goalId).filter(t => t.status === "completed").length;
        const total = this.taskStore.getByGoal(goalId).length;
        log.info(`[loadActivePlan] Restored ${completed}/${total} tasks completed for goal ${goalId}`);

        if (this.taskStore.isAllCompleteForGoal(goalId)) {
          goal.state = "done";
          log.info("[loadActivePlan] All tasks already completed — plan finished");
        }
      }

      if (stored.metadata.status === "completed") {
        goal.state = "done";
        log.info("[loadActivePlan] Plan already completed");
      }
    } catch (error) {
      log.error(`[GoalManager] Failed to load active plan: ${error}`);
    }
  }

  dispose(): void {
    // Nothing to dispose in single-goal mode.
    // Phase 4: dispose per-goal planners and ChatAgents.
  }
}
