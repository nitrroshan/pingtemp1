/**
 * OrchestratorService
 *
 * Main service class for the Orchestrator agent.
 * Manages conversation, planning, approval, and execution coordination.
 *
 * Usage:
 * ```typescript
 * const orchestrator = new OrchestratorService({
 *   teamId: "team-123",
 *   teamRoles: ["backend", "frontend", "devops"],
 *   memoryManager,
 *   events,
 * });
 *
 * await orchestrator.initialize();
 * const response = await orchestrator.handleMessage("Build a blog with Next.js");
 * ```
 */

import path from "path";
import { fileURLToPath } from "url";
import type { MemoryManager } from "../memory/MemoryManager.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import { AgentFactory } from "../agent/AgentFactory.js";
import type { IAgent, AgentEvent } from "../agent/types.js";
import { createOrchestratorTools } from "./tools/index.js";
import { toGoalId } from "../plugin/utils.js";
import { FilePlanStore } from "../persistence/FilePlanStore.js";
import type {
  OrchestratorState,
  OrchestratorContext,
  OrchestratorConfig,
  OrchestratorMessage,
  OrchestratorCallbacks,
  TaskPlan,
} from "./types.js";
import type { AgentPlanOutput } from "./schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OrchestratorService {
  // Configuration
  private teamId: string;
  private teamRoles: string[];
  private memoryManager: MemoryManager;
  private workerPool: WorkerPool;
  private callbacks: OrchestratorCallbacks;

  // State
  private state: OrchestratorState = "idle";
  private pendingPlan: AgentPlanOutput | null = null;
  private sessionId: string;

  /**
   * When true, tasks execute automatically when ready (sequentially to avoid workspace conflicts).
   * When false, tasks wait for manual start via CLI 'start <id>'.
   * Default: false — user must explicitly start each task.
   */
  private autoExecute: boolean = false;

  /**
   * Sequential dispatch chain for auto-executed tasks.
   * Ensures only one workspace is active at a time, preventing concurrent
   * file operations from corrupting the shared Git repo (files landing on wrong branches).
   */
  private dispatchChain: Promise<void> = Promise.resolve();

  /**
   * Serializes handleMessage calls so the LLM processes one user message at a time.
   * Prevents race conditions where concurrent messages both trigger create_plan.
   */
  private messageChain: Promise<string> = Promise.resolve("");

  // Agents
  private orchestratorAgent: IAgent | null = null;
  private planBuilderAgent: IAgent | null = null;
  private agentFactory: AgentFactory | null = null;

  // Plan persistence (goalId-scoped) — injected via config
  private planStore: any;

  // Current goal context for plan scoping
  private currentGoalId: string | null = null;

  // Message history
  private messages: OrchestratorMessage[] = [];

  constructor(config: OrchestratorConfig) {
    this.teamId = config.teamId;
    this.teamRoles = config.teamRoles;
    this.memoryManager = config.memoryManager;
    this.workerPool = config.workerPool;
    this.callbacks = config.callbacks || {};
    this.sessionId = `team-${config.teamId}`;
    this.planStore = config.planStore ?? new FilePlanStore(config.teamId);
    // Default to false — user controls when tasks start
    this.autoExecute = config.autoExecute ?? false;
  }

  /**
   * Initialize the orchestrator with its agents
   */
  async initialize(): Promise<void> {
    // Create agent factory pointing to agents directory
    const agentsDir = path.resolve(__dirname, "../agent/agents");
    this.agentFactory = new AgentFactory(agentsDir);

    // Create PlanBuilder agent (structured output mode)
    this.planBuilderAgent = this.agentFactory.createById("plan-builder");

    // Create Orchestrator agent (tool mode)
    this.orchestratorAgent = this.agentFactory.createById("orchestrator");

    // Customize orchestrator's system prompt to include team roles
    if (this.orchestratorAgent && this.orchestratorAgent.definition) {
      const originalPrompt =
        this.orchestratorAgent.definition.systemPrompt || "";
      this.orchestratorAgent.definition.systemPrompt = `${originalPrompt}

## TEAM CONFIGURATION
**Available Team Roles**: ${this.teamRoles.join(", ")}

CRITICAL: When calling create_plan, you MUST pass these exact roles in the 'roles' parameter.
DO NOT invent new roles. Only use roles from the list above.
`;
    }

    // Initialize orchestrator agent first
    if (this.orchestratorAgent) {
      await this.orchestratorAgent.initialize();
    }

    // Create context for tools
    const context = this.createContext();

    // Create tools with context
    const tools = createOrchestratorTools(context);

    // Inject tools into orchestrator agent (must await since it rebuilds the agent)
    if (this.orchestratorAgent && "setTools" in this.orchestratorAgent) {
      await (this.orchestratorAgent as any).setTools(tools);
    }

    // Subscribe to task lifecycle events directly from RoleTaskQueue
    this.memoryManager.taskQueue.setCallbacks({
      onTaskReady: this.wakeWorker.bind(this),
      onTaskComplete: this.handleTaskComplete.bind(this),
      onTaskFailed: this.handleTaskFailed.bind(this),
    });

    // Subscribe to agent-initiated task completion (via complete_task tool)
    this.workerPool.setCallbacks({
      onStream: (data) => this.callbacks.onStream?.(data),
      onEvent: (data) => this.callbacks.onEvent?.(data),
      onDone: (data) => this.callbacks.onDone?.(data),
      onError: (data) => this.callbacks.onError?.(data),
      onAgentComplete: this.handleAgentTaskComplete.bind(this),
    });

    // Load active plan if exists (for restart recovery)
    await this.loadActivePlan();

    this.state = "idle";
    console.log(`[OrchestratorService] Initialized for team ${this.teamId}`);
  }

  /**
   * Helper to execute an agent and collect final output.
   * Emits streaming events (message_delta, thinking, tool_start, tool_result)
   * via this.events so SocketServerV2 can forward them to the frontend.
   */
  /** Event types that should be forwarded to the frontend via worker:event */
  private static readonly STREAMING_EVENT_TYPES = new Set([
    "message_delta",
    "thinking",
    "tool_start",
    "tool_result",
  ]);

  private async executeAgent(
    agent: IAgent,
    message: string,
    threadId: string,
  ): Promise<any> {
    let result: any = null;

    let eventCount = 0;
    let deltaCount = 0;

    for await (const event of agent.execute({ message, threadId })) {
      eventCount++;

      // Forward stream_part events directly on onStream callback
      if (event.type === "stream_part") {
        this.callbacks.onStream?.({
          taskId: threadId,
          agentId: "orchestrator",
          part: event.part,
        });
        continue;
      }

      // Forward legacy streaming events to SocketServerV2 via onEvent callback
      if (OrchestratorService.STREAMING_EVENT_TYPES.has(event.type)) {
        if (event.type === "message_delta") deltaCount++;
        this.callbacks.onEvent?.({
          taskId: threadId,
          event: { ...event, role: "orchestrator" },
        });
      }

      switch (event.type) {
        case "message":
          // Capture the final text response (preferred over done.output for display)
          result = event.content;
          break;
        case "done":
          // Use done.output only if no message event was received
          // (e.g., structured mode where there's no text stream)
          if (result === null && event.output !== undefined) {
            result = event.output;
          }
          break;
        case "error":
          throw new Error(event.error);
      }
    }

    console.log(`[OrchestratorService] executeAgent finished: ${eventCount} events, ${deltaCount} text deltas`);
    return result;
  }

  /**
   * Create the context object for tools
   */
  private createContext(): OrchestratorContext {
    return {
      memoryManager: this.memoryManager,
      callbacks: this.callbacks,
      planStore: this.planStore,
      teamId: this.teamId,
      currentGoalId: this.currentGoalId,
      teamRoles: this.teamRoles,

      planBuilder: {
        invoke: async (params) => {
          if (!this.planBuilderAgent) {
            throw new Error("PlanBuilder not initialized");
          }
          // Use execute() pattern for IAgent
          return this.executeAgent(
            this.planBuilderAgent,
            JSON.stringify(params),
            `plan-${this.teamId}-${Date.now()}`,
          );
        },
      },

      getState: () => this.state,
      setState: (state) => {
        this.state = state;
      },

      getPendingPlan: () => this.pendingPlan,
      setPendingPlan: (plan) => {
        this.pendingPlan = plan;
      },
    };
  }

  /**
   * Handle an incoming message from the user
   */
  async handleMessage(content: string): Promise<string> {
    // Serialize messages — only one LLM call at a time to prevent race conditions
    const result = this.messageChain.then(() => this._handleMessage(content));
    this.messageChain = result.catch(() => "");
    return result;
  }

  private async _handleMessage(content: string): Promise<string> {
    if (!this.orchestratorAgent) {
      throw new Error(
        "OrchestratorService not initialized. Call initialize() first.",
      );
    }

    // Add user message to history
    this.messages.push({
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    });

    // Update state if we were idle
    if (this.state === "idle") {
      this.state = "gathering";
      this.callbacks.onProgress?.({
        teamId: this.teamId,
        state: "gathering",
        message: "Started gathering requirements",
        timestamp: new Date().toISOString(),
      });
    }

    try {
      // Execute the orchestrator agent using the execute() pattern
      const result = await this.executeAgent(
        this.orchestratorAgent,
        content,
        this.sessionId,
      );

      // Extract response content
      const responseContent = this.extractResponse(result);

      // Add assistant message to history
      this.messages.push({
        role: "assistant",
        content: responseContent,
        timestamp: new Date().toISOString(),
      });

      return responseContent;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        "[OrchestratorService] Error handling message:",
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Approve the pending plan (called from external trigger, e.g., WebSocket)
   */
  async approvePlan(): Promise<{
    success: boolean;
    tasksQueued?: number;
    error?: string;
  }> {
    if (!this.pendingPlan) {
      return { success: false, error: "No pending plan to approve" };
    }

    try {
      // Clear pending plan and get planId before state change
      const planId = this.pendingPlan.planId;
      const planToApprove = this.pendingPlan;
      this.pendingPlan = null;

      // Dispose all existing workers before clearing tasks
      // Prevents stale workers from the previous plan lingering in getActiveWorkers()
      await this.workerPool.disposeAll();

      // Clear all existing tasks from MemoryManager before adding new ones
      // This prevents conflicts when approving a new plan after initialization loaded an old plan
      console.log(
        "[OrchestratorService] Clearing old tasks before approving new plan",
      );
      this.memoryManager.clearAllTasks();

      // Add all tasks to MemoryManager
      let tasksQueued = 0;

      // Build dependants map (reverse of dependencies)
      const dependantsMap = new Map<string, string[]>();
      for (const task of planToApprove.tasks) {
        for (const depId of task.dependencies) {
          const existing = dependantsMap.get(depId) || [];
          existing.push(task.id);
          dependantsMap.set(depId, existing);
        }
      }

      for (const task of planToApprove.tasks) {
        // Get task's structured context (notes, artifacts, etc.) from plan
        const taskContext = (task as any).context || {};

        const memoryTask = {
          id: task.id,
          description: `${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending" as const,
          prerequisites: new Map<string, boolean>(
            task.dependencies.map((depId: string) => [depId, false]),
          ),
          dependants: dependantsMap.get(task.id) || [],
          context: {
            title: task.title,
            planId: planToApprove.planId,
            goal: planToApprove.goal,
            priority: task.priority,
            complexity: task.complexity,
            expectedOutput: task.expectedOutput,
            // Include structured context from PlanBuilder
            notes: taskContext.notes || "",
            files: taskContext.files || [],
            artifacts: taskContext.artifacts || [],
            relatedTasks: taskContext.relatedTasks || [],
          },
        };

        this.memoryManager.addTask(memoryTask);
        tasksQueued++;
      }

      // Update state to executing now that tasks are queued
      this.state = "executing";

      // Set goal context for memory tools (planId serves as goalId)
      // This enables workers to scope artifacts/collab docs to this plan
      const goalId = toGoalId(planToApprove.goal || planId);
      this.currentGoalId = goalId;
      this.workerPool.setTeamId(this.teamId);

      // Save plan with approved status (goalId-scoped)
      await this.planStore.savePlan(planToApprove, {
        goalId,
        status: "approved",
      });

      // Update plan status to executing
      await this.planStore.updatePlanStatus(planId, goalId, "executing");

      // Emit approval event
      this.callbacks.onPlanApproved?.({
        planId,
        teamId: this.teamId,
        tasksQueued,
        timestamp: new Date().toISOString(),
      });

      // Emit progress event for execution start
      this.callbacks.onProgress?.({
        teamId: this.teamId,
        state: "executing",
        message: `Plan approved, executing ${tasksQueued} tasks`,
        planId,
        tasksQueued,
        timestamp: new Date().toISOString(),
      });

      return { success: true, tasksQueued };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get current orchestrator state
   */
  getState(): OrchestratorState {
    return this.state;
  }

  /**
   * Get pending plan if any
   */
  getPendingPlan(): TaskPlan | null {
    return this.pendingPlan;
  }

  /**
   * Set auto-execute mode
   * When false, tasks wait for manual approval via AgentManager.approveTaskForChat()
   */
  setAutoExecute(enabled: boolean): void {
    this.autoExecute = enabled;
    console.log(
      `[OrchestratorService] Auto-execute mode: ${enabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * Get auto-execute mode status
   */
  getAutoExecute(): boolean {
    return this.autoExecute;
  }

  /**
   * Extract response content from agent result
   */
  private extractResponse(result: any): string {
    // Handle various response formats
    if (typeof result === "string") {
      return result;
    }

    // AiSdkAgent done event returns { response: "text" }
    if (result?.response && typeof result.response === "string") {
      return result.response;
    }

    if (result?.content) {
      return result.content;
    }

    if (result?.messages?.length > 0) {
      const lastMessage = result.messages[result.messages.length - 1];
      return lastMessage?.content || JSON.stringify(result);
    }

    return JSON.stringify(result);
  }

  /**
   * Handle task:available event from MemoryManager
   * When autoExecute is ON, chains the dispatch sequentially to prevent
   * concurrent workspace operations (shared Git repo).
   */
  private async wakeWorker({
    taskId,
    role,
  }: {
    taskId: string;
    role: string;
  }): Promise<void> {
    console.log(
      `[OrchestratorService] wakeWorker called - taskId: ${taskId}, role: ${role}`,
    );

    // If auto-execute is disabled, task waits for manual 'start <id>'
    if (!this.autoExecute) {
      console.log(
        `[OrchestratorService] Auto-execute OFF, task ${taskId} waiting for manual start`,
      );
      return;
    }
    // Chain dispatches sequentially. Multiple workspaces share a single Git
    // repo — concurrent file writes cause files to land on wrong branches.
    // By serializing, each task's workspace operations complete before the next starts.
    this.dispatchChain = this.dispatchChain
      .then(() => this.executeAutoDispatch(taskId, role))
      .catch((error) => {
        console.error(
          `[OrchestratorService] Dispatch chain error for ${taskId}:`,
          error,
        );
      });
  }

  /**
   * Execute a single auto-dispatched task. Called sequentially via dispatchChain.
   * Awaits the worker's first response before the chain moves to the next task.
   */
  private async executeAutoDispatch(
    taskId: string,
    role: string,
  ): Promise<void> {
    try {
      const task = this.memoryManager.getTask(taskId);
      if (!task) {
        console.error(
          `[OrchestratorService] Task ${taskId} not found in MemoryManager`,
        );
        return;
      }

      // Skip if already completed/failed (e.g. completed via another path)
      if (task.status === "completed" || task.status === "failed") {
        console.log(
          `[OrchestratorService] Task ${taskId} already ${task.status}, skipping dispatch`,
        );
        return;
      }

      const contextData = this.memoryManager.getTaskContext(taskId);

      console.log(
        `[OrchestratorService] Dispatching task ${taskId} to ${role}`,
      );

      this.memoryManager.updateTaskStatus(taskId, "in_progress");

      this.callbacks.onProgress?.({
        teamId: this.teamId,
        state: "executing",
        message: `Starting task: ${task.description}`,
        taskId,
        role,
        timestamp: new Date().toISOString(),
      });

      const taskWithContext = {
        id: taskId,
        assigned_role: role,
        description: task.description,
        priority: (task as any).priority || 0,
        context: {
          previousOutputs: contextData?.dependencyOutputs || [],
          artifacts: [],
        },
        createdAt: Date.now(),
        status: "in_progress" as const,
      };

      // AWAIT the worker — this serializes workspace access across tasks.
      // Task stays in_progress until agent calls complete_task or user completes.
      const output = await this.workerPool.runTask(taskWithContext);

      console.log(
        `[OrchestratorService] Task ${taskId} first response received (staying in_progress)`,
      );
    } catch (error: any) {
      console.error(
        `[OrchestratorService] Error executing task ${taskId}:`,
        error,
      );
      // Only fail if task hasn't already been completed by agent
      const currentTask = this.memoryManager.getTask(taskId);
      if (currentTask && currentTask.status !== "completed") {
        try {
          (this.memoryManager as any).taskQueue.failTask(taskId, error.message);
        } catch (err) {
          console.error(`[OrchestratorService] Failed to fail task ${taskId}:`, err);
        }
      }
    }
  }

  /**
   * Handle agent-initiated task completion (via complete_task tool)
   * Publishes workspace artifacts and merges branch before updating status.
   */
  private async handleAgentTaskComplete(data: {
    taskId: string;
    role: string;
    summary: string;
    deliverables?: string[];
    nextSteps?: string[];
    timestamp: number;
  }): Promise<void> {
    console.log(
      `[OrchestratorService] Agent completed task ${data.taskId}: ${data.summary}`,
    );

    // Publish workspace artifacts + merge branch to main (same as user-driven complete)
    try {
      const workspace = this.workerPool.getWorkspace(data.taskId);
      if (workspace) {
        await workspace.publish(this.currentGoalId || undefined);
      }
      const mergeResult = await this.workerPool.mergeAndCleanup(data.taskId);
      if (!mergeResult.success) {
        console.warn(
          `[OrchestratorService] Merge failed for task ${data.taskId}: ${mergeResult.error}`,
        );
      }
    } catch (err) {
      console.warn(
        `[OrchestratorService] Workspace cleanup failed for task ${data.taskId}:`,
        err,
      );
    }

    // Mark task as completed in MemoryManager and get newly-ready tasks
    const newlyReadyTasks = this.memoryManager.completeTask(data.taskId, {
      summary: data.summary,
      deliverables: data.deliverables,
      nextSteps: data.nextSteps,
      completedBy: "agent",
      timestamp: data.timestamp,
    });

    // Invoke callback for each newly-ready task so frontend updates
    for (const readyTask of newlyReadyTasks) {
      this.callbacks.onTaskUpdate?.({
        taskId: readyTask.id,
        status: "ready",
        role: readyTask.assigned_role,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle task:complete event from MemoryManager
   * Checks if all tasks are done and transitions to idle state
   */
  private handleTaskComplete({
    taskId,
    output,
  }: {
    taskId: string;
    output: any;
  }): void {
    console.log(`[OrchestratorService] Task ${taskId} completed`);

    // Register task output as artifact
    const task = this.memoryManager.getTask(taskId);

    // Invoke callback for SocketServerV2 to broadcast updated task list
    this.callbacks.onTaskUpdate?.({
      taskId,
      status: "completed",
      role: task?.assigned_role,
      output,
      timestamp: Date.now(),
    });

    // Emit progress event for task completion
    this.callbacks.onProgress?.({
      teamId: this.teamId,
      state: "executing",
      message: `Task completed: ${task?.description || taskId}`,
      taskId,
      role: task?.assigned_role,
      timestamp: new Date().toISOString(),
    });
    // Output manifests are now written by AgentWorkspace.publish()
    // No need to register artifacts here — they land in .ping/outputs/

    // Check if all tasks are done
    if (this.memoryManager.isComplete()) {
      this.state = "idle";

      // Update plan status to completed (archive, don't delete)
      if (task?.context) {
        const context = task.context;
        if (context.planId) {
          const goalId = this.currentGoalId || undefined;
          // Fire-and-forget async operations
          this.planStore
            .updatePlanStatus(context.planId, goalId || "unknown", "completed")
            .then(() => {
              console.log(
                `[OrchestratorService] Completed plan ${context.planId}`,
              );
            })
            .catch((error: any) => {
              console.error(
                "[OrchestratorService] Failed to update/delete plan:",
                error,
              );
            });
        }
      }

      // execution:complete: log and optionally invoke callback if needed in future
      console.log(`[OrchestratorService] All tasks complete for team ${this.teamId}`);

      // Emit final progress event
      this.callbacks.onProgress?.({
        teamId: this.teamId,
        state: "idle",
        message: "All tasks completed successfully",
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Handle task:failed event from MemoryManager
   * Emits error event for external monitoring
   */
  private handleTaskFailed({
    taskId,
    error,
  }: {
    taskId: string;
    error: string;
  }): void {
    console.error(`[OrchestratorService] Task ${taskId} failed: ${error}`);

    // Get task details for role information
    const task = this.memoryManager.getTask(taskId);
    const role = task?.assigned_role || "unknown";

    // task:error has no subscribers, skip

    // Emit progress event for task failure
    this.callbacks.onProgress?.({
      teamId: this.teamId,
      state: "executing",
      message: `Task failed: ${task?.description || taskId}`,
      taskId,
      role,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Load active plan from disk if exists (for restart recovery)
   */
  private async loadActivePlan(): Promise<void> {
    try {
      const storedPlan = await this.planStore.getLatestActivePlan();

      if (!storedPlan) {
        console.log(
          `[OrchestratorService] No active plan found for team ${this.teamId}`,
        );
        return;
      }

      // Restore goalId context
      this.currentGoalId = storedPlan.metadata.goalId || null;

      // Only restore if plan was executing or approved (not completed/failed)
      if (
        storedPlan.metadata.status === "executing" ||
        storedPlan.metadata.status === "approved"
      ) {
        console.log(
          `[OrchestratorService] Restoring plan ${storedPlan.plan.planId} with status ${storedPlan.metadata.status}`,
        );

        if (storedPlan.metadata.status === "approved") {
          // Plan was approved but not yet executing - set as pending
          this.pendingPlan = storedPlan.plan;
          this.state = "awaiting_approval";
        } else if (storedPlan.metadata.status === "executing") {
          // Plan was executing - restore tasks to MemoryManager
          console.log(
            `[OrchestratorService] Restoring ${storedPlan.plan.tasks.length} tasks to MemoryManager`,
          );

          // Build dependants map
          const dependantsMap = new Map<string, string[]>();
          for (const task of storedPlan.plan.tasks) {
            for (const depId of task.dependencies) {
              const existing = dependantsMap.get(depId) || [];
              existing.push(task.id);
              dependantsMap.set(depId, existing);
            }
          }

          // Re-add tasks to MemoryManager
          for (const task of storedPlan.plan.tasks) {
            this.memoryManager.addTask({
              id: task.id,
              description: `${task.title}: ${task.description}`,
              assigned_role: task.assignedRole.toLowerCase(),
              status: "pending" as const,
              prerequisites: new Map<string, boolean>(
                task.dependencies.map((depId: string) => [depId, false]),
              ),
              dependants: dependantsMap.get(task.id) || [],
              context: {
                title: task.title,
                planId: storedPlan.plan.planId,
                goal: storedPlan.plan.goal,
                priority: task.priority,
                complexity: task.complexity,
                expectedOutput: task.expectedOutput,
              },
            });
          }

          this.state = "executing";
        }
      }
    } catch (error) {
      console.error("[OrchestratorService] Failed to load active plan:", error);
      // Continue initialization without restored plan
    }
  }

  /**
   * Reset the orchestrator state
   */
  reset(): void {
    this.state = "idle";
    this.pendingPlan = null;
    this.messages = [];
  }

  /**
   * Reset the current plan — deletes it from disk and resets orchestrator state.
   * Use this to abandon the current plan so it won't be restored on next init.
   */
  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    try {
      const storedPlan = await this.planStore.getLatestActivePlan();
      if (
        storedPlan &&
        (storedPlan.metadata.status === "executing" ||
          storedPlan.metadata.status === "approved")
      ) {
        const planId = storedPlan.plan.planId;
        const goalId = storedPlan.metadata.goalId;
        await this.planStore.archivePlan(planId, goalId);
        console.log(`[OrchestratorService] Archived plan ${planId}`);
        this.currentGoalId = null;
        this.reset();
        return { deleted: true, planId };
      }
      this.reset();
      return { deleted: false };
    } catch (error) {
      console.error("[OrchestratorService] Failed to reset plan:", error);
      this.reset();
      return { deleted: false };
    }
  }

  /**
   * Mark the current plan as interrupted on disk so it won't auto-restore.
   * Called during graceful shutdown.
   */
  async interruptPlan(): Promise<void> {
    try {
      const storedPlan = await this.planStore.getLatestActivePlan();
      if (storedPlan && storedPlan.metadata.status === "executing") {
        const goalId = storedPlan.metadata.goalId;
        await this.planStore.updatePlanStatus(
          storedPlan.plan.planId,
          goalId,
          "interrupted",
        );
        console.log(
          `[OrchestratorService] Plan ${storedPlan.plan.planId} marked as interrupted`,
        );
      }
    } catch (error) {
      console.error("[OrchestratorService] Failed to interrupt plan:", error);
    }
  }

  /**
   * Cleanup resources and remove callbacks
   */
  dispose(): void {
    this.memoryManager.taskQueue.setCallbacks({});
    this.workerPool.setCallbacks({});
    this.reset();
  }
}
