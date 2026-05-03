/**
 * SocketActionHandler — Client action routing (Socket.IO "action" event).
 *
 * Extracted from SocketServerV2.ts (v5.0 communication layer refactor).
 *
 * Responsibilities:
 * - Validate + route action payloads
 * - approve-plan, start-task, complete-task, cancel-task, auto-execute, get-state
 * - Goal-scoped state responses
 */

import type { Socket } from "socket.io";
import { rootLogger } from "../logging/index.js";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import type { SocketConnection } from "./SocketConnectionManager.js";
import type { AgentManager } from "../agentManager/AgentManagerV2.js";
import type { SocketEventBroadcaster } from "./SocketEventBroadcaster.js";
import {
  ActionPayloadSchema,
  type ActionPayload,
  type MessageResponse,
  type OutputResponse,
  type StateResponse,
  type TokenBucketLimiter,
  buildStateResponse,
  buildPlanFromPending,
  emitError,
} from "./socket-types.js";

const logger = rootLogger.child({ module: "SocketActionHandler" });

export class SocketActionHandler {
  constructor(
    private rateLimiter: TokenBucketLimiter,
    private broadcaster: SocketEventBroadcaster,
    private joinTeamRoom: (socket: Socket, teamId: string) => Promise<boolean>,
  ) {}

  async handleAction(
    socket: Socket,
    connection: SocketConnection,
    data: ActionPayload,
  ): Promise<void> {
    const parsed = ActionPayloadSchema.safeParse(data);
    if (!parsed.success) {
      emitError(socket, { error: `Invalid action: ${parsed.error.issues[0]?.message || "validation failed"}` });
      return;
    }
    const { teamId, type, sessionId, taskId, goalId: actionGoalId, output, changes } = parsed.data;

    if (type !== "get-state" && !this.rateLimiter.allow(connection.userId)) {
      emitError(socket, { error: "Rate limit exceeded. Please wait." });
      return;
    }

    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);

      switch (type) {
        case "approve-plan":
          await this.handleApprovePlan(socket, manager, sessionId, actionGoalId);
          break;
        case "start-task":
          await this.handleStartTask(socket, manager, taskId!, actionGoalId);
          break;
        case "complete-task":
          await this.handleCompleteTask(socket, manager, taskId!, output, actionGoalId);
          break;
        case "cancel-task":
          await this.handleCancelTask(socket, manager, taskId!, actionGoalId);
          break;
        case "modify-task":
          emitError(socket, { error: "modify-task not yet implemented" });
          break;
        case "auto-execute":
          this.handleAutoExecute(socket, manager, data.enabled, actionGoalId);
          break;
        case "get-state":
          await this.handleGetState(socket, manager, teamId, sessionId, actionGoalId);
          break;
        default:
          emitError(socket, { error: `Unknown action type: ${type}` });
      }
    } catch (error: any) {
      logger.error(`[SocketActionHandler] Action ${type} error:`, error);
      emitError(socket, { error: error.message || String(error), sessionId, taskId });
    }
  }

  private async handleApprovePlan(
    socket: Socket,
    manager: AgentManager,
    sessionId: string | undefined,
    goalId?: string,
  ): Promise<void> {
    if (!goalId) {
      emitError(socket, { error: "goalId is required for approve-plan" });
      return;
    }
    const result = await manager.approveOrchestratorPlan(goalId);

    if (result.success) {
      const stateResponse = buildStateResponse(manager, sessionId, goalId);
      stateResponse.sessionState = "executing";
      socket.emit("state", stateResponse);
      logger.info(`[SocketActionHandler] Plan approved for goal ${goalId}, ${result.tasksQueued} tasks queued`);
    } else {
      emitError(socket, { error: result.error || "Plan approval failed", sessionId });
    }
  }

  private async handleStartTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    goalId?: string,
  ): Promise<void> {
    if (!taskId) {
      emitError(socket, { error: "taskId is required for start-task" });
      return;
    }

    const pendingPlan = manager.getOrchestratorPendingPlan(goalId);
    if (pendingPlan) {
      logger.info(`[SocketActionHandler] Auto-approving pending plan before starting task ${taskId}`);
      const approvalResult = await manager.approveOrchestratorPlan(goalId);
      if (!approvalResult.success) {
        emitError(socket, { error: approvalResult.error || "Failed to approve plan" });
        return;
      }
    }

    try {
      await manager.manualDispatchTask(taskId);
      logger.info(`[SocketActionHandler] Task ${taskId} manually dispatched`);
    } catch (err: any) {
      emitError(socket, { error: err.message || "Failed to start task" });
    }
  }

  private async handleCompleteTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    output?: any,
    goalId?: string,
  ): Promise<void> {
    if (!taskId) {
      emitError(socket, { error: "taskId is required for complete-task" });
      return;
    }

    const taskStore = manager.getTaskStore();
    const task = taskStore?.getTask(taskId);
    const agentRole = task?.assigned_role || "unknown";

    if (taskStore) {
      try {
        taskStore.completeTask(taskId, output || { completedBy: "user" });
      } catch (err) {
        logger.warn(`[SocketActionHandler] Failed to complete task ${taskId} in TaskStore:`, err);
      }
    }

    if (!goalId && !(task as any)?.goalId) logger.warn(`[SocketActionHandler] handleCompleteTask: task ${taskId} has no goalId`);
    const gid = goalId || (task as any)?.goalId || undefined;
    socket.emit("state", buildStateResponse(manager, undefined, gid));

    if (output) {
      socket.emit("output", {
        sessionId: "default",
        taskId,
        agentId: agentRole,
        output: {
          content: typeof output === "string" ? output : JSON.stringify(output),
        },
        timestamp: Date.now(),
      } satisfies OutputResponse);
    }

    logger.info(`[SocketActionHandler] Task ${taskId} completed`);
  }

  private handleAutoExecute(
    socket: Socket,
    manager: AgentManager,
    enabled?: boolean,
    goalId?: string,
  ): void {
    if (enabled !== undefined) {
      manager.setAutoExecute(enabled);

      const messageResponse: MessageResponse = {
        sessionId: "default",
        agentId: "system",
        content: enabled
          ? "Auto-execute enabled: tasks will run automatically after plan approval"
          : "Auto-execute disabled: you can chat with workers before completing tasks",
        timestamp: Date.now(),
      };
      socket.emit("message", messageResponse);
      logger.info(`[SocketActionHandler] AutoExecute set to ${enabled}`);
    }

    const current = manager.getAutoExecute();
    const gid = goalId || undefined;
    const stateResponse = buildStateResponse(manager, undefined, gid);
    (stateResponse as any).autoExecute = current;
    socket.emit("state", stateResponse);
  }

  private async handleGetState(
    socket: Socket,
    manager: AgentManager,
    teamId: string,
    sessionId: string | undefined,
    goalId?: string,
  ): Promise<void> {
    const joined = await this.joinTeamRoom(socket, teamId);
    if (!joined) return;
    this.broadcaster.ensureTeamCallbacks(teamId, manager);

    const pendingPlan = manager.getOrchestratorPendingPlan(goalId);
    const autoExecute = manager.getAutoExecute();

    if (pendingPlan) {
      const plan = buildPlanFromPending(pendingPlan);
      const stateResponse: StateResponse = {
        sessionId: sessionId || "default",
        sessionState: "awaiting_approval",
        plan,
        autoExecute,
        goalId: goalId || undefined,
        timestamp: Date.now(),
      };
      socket.emit("state", stateResponse);
      logger.info(`[SocketActionHandler] State sent: awaiting_approval, ${plan.length} pending tasks`);
      return;
    }

    const stateResponse = buildStateResponse(manager, sessionId, goalId);
    (stateResponse as any).autoExecute = autoExecute;
    socket.emit("state", stateResponse);
    logger.info(`[SocketActionHandler] State sent: ${stateResponse.sessionState}, ${stateResponse.plan?.length || 0} tasks`);
  }

  private async handleCancelTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    goalId?: string,
  ): Promise<void> {
    if (!taskId) {
      emitError(socket, { error: "taskId is required for cancel-task" });
      return;
    }

    logger.warn(`[SocketActionHandler] Task ${taskId} cancel requested (not yet implemented)`);

    const cancelTask = manager.getTaskStore()?.getTask(taskId);
    if (!goalId && !cancelTask?.goalId) logger.warn(`[SocketActionHandler] handleCancelTask: task ${taskId} has no goalId`);
    const stateResponse: StateResponse = {
      sessionId: "default",
      tasks: [{ id: taskId, status: "cancelled" }],
      goalId: goalId || cancelTask?.goalId || undefined,
      timestamp: Date.now(),
    };
    socket.emit("state", stateResponse);
  }
}
