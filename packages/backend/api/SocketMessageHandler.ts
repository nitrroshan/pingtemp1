/**
 * SocketMessageHandler — Bidirectional message routing (Socket.IO "message" event).
 *
 * Extracted from SocketServerV2.ts (v5.0 communication layer refactor).
 *
 * Responsibilities:
 * - Validate + route incoming user messages
 * - Orchestrator messages (planning, goalId generation, room join)
 * - Chat Agent messages (L2 persistent agents)
 * - Worker messages (task-scoped agent chat)
 * - Persist user + assistant messages via ServiceRegistry
 */

import type { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { rootLogger } from "../logging/index.js";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import type { SocketConnection } from "./SocketConnectionManager.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";
import type { AgentManager } from "../agentManager/AgentManagerV2.js";
import type { StreamPayload } from "./types/streamTypes.js";
import type { SocketEventBroadcaster } from "./SocketEventBroadcaster.js";
import {
  MessagePayloadSchema,
  type MessagePayload,
  type StateResponse,
  type TokenBucketLimiter,
  toRenderedParts,
  buildStateResponse,
  buildPlan,
  buildPlanFromPending,
  emitError,
} from "./socket-types.js";

const logger = rootLogger.child({ module: "SocketMessageHandler" });

export class SocketMessageHandler {
  constructor(
    private services: ServiceRegistry | null,
    private rateLimiter: TokenBucketLimiter,
    private broadcaster: SocketEventBroadcaster,
    private joinTeamRoom: (socket: Socket, teamId: string) => Promise<boolean>,
  ) {}

  async handleMessage(
    socket: Socket,
    connection: SocketConnection,
    data: MessagePayload,
  ): Promise<void> {
    const parsed = MessagePayloadSchema.safeParse(data);
    if (!parsed.success) {
      emitError(socket, { error: `Invalid message: ${parsed.error.issues[0]?.message || "validation failed"}` });
      return;
    }
    const { teamId, agentId, taskId, sessionId, content, goalId: clientGoalId, nonce, repoUrl, repoBranch } = parsed.data;

    if (!this.rateLimiter.allow(connection.userId)) {
      emitError(socket, { error: "Rate limit exceeded. Please wait before sending more messages." });
      return;
    }

    logger.info({ teamId, agentId, taskId, sessionId, contentPreview: content?.substring(0, 50) }, "[SocketMessageHandler] handleMessage");

    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);

      // Save user message (defer orchestrator messages until goalId is resolved)
      const isOrchestratorMsg = agentId === "manager" || agentId === "orchestrator";

      // Reject non-orchestrator messages without goalId at the boundary.
      // Chat-agent and worker messages MUST be goal-scoped — ephemeral chat is not supported.
      if (!isOrchestratorMsg && !clientGoalId) {
        emitError(socket, { error: "goalId is required for chat-agent and worker messages" });
        return;
      }

      if (this.services && !isOrchestratorMsg) {
        if (clientGoalId) {
          const layer = agentId.startsWith("chat-") ? "chat-agent" as const : "worker" as const;
          this.services.chat.addMessage({
            teamId,
            userId: connection.userId,
            role: "user",
            agentId,
            taskId: taskId || undefined,
            goalId: clientGoalId,
            content,
            agentLayer: layer,
            timestamp: new Date().toISOString(),
          }).catch((err) => logger.warn("[SocketMessageHandler] Failed to save user message:", err));
        }
      }


      const joined = await this.joinTeamRoom(socket, teamId);
      if (!joined) return;
      this.broadcaster.ensureTeamCallbacks(teamId, manager);

      if (agentId === "manager" || agentId === "orchestrator") {
        await this.handleOrchestratorMessage(socket, manager, teamId, sessionId, content, clientGoalId ?? undefined, nonce, repoUrl, repoBranch);
      } else if (agentId.startsWith("chat-") && manager.isChatAgentEnabled()) {
        const role = agentId.replace("chat-", "");
        await this.handleChatAgentMessage(socket, manager, teamId, role, sessionId, content, clientGoalId ?? undefined);
      } else {
        await this.handleWorkerMessage(socket, manager, agentId, taskId, content);
      }
    } catch (error: any) {
      logger.error("[SocketMessageHandler] Message error:", error);
      emitError(socket, { error: error.message || String(error), sessionId, taskId });
    }
  }

  private async handleOrchestratorMessage(
    socket: Socket,
    manager: AgentManager,
    teamId: string,
    sessionId: string | undefined,
    content: string,
    goalId?: string,
    nonce?: string,
    repoUrl?: string,
    repoBranch?: string,
  ): Promise<void> {
    logger.info(`[SocketMessageHandler] handleOrchestratorMessage: repoUrl=${repoUrl || 'NONE'}, repoBranch=${repoBranch || 'NONE'}, goalId=${goalId || 'NONE'}`);

    // Wire auth token resolver for workspace push
    if (repoUrl) {
      const userId = socket.data.userId;
      manager.getWorkerPool()?.setAuthTokenResolver(async () => {
        try {
          const mongoose = await import("mongoose");
          if (mongoose.connection.readyState !== 1) return null;
          const account = await mongoose.connection.db?.collection("account").findOne({
            userId,
            providerId: "github",
          });
          return (account as any)?.accessToken || null;
        } catch { return null; }
      });
    }

    // Generate goalId server-side BEFORE planner starts
    const resolvedGoalId = goalId || randomUUID();

    // Persist goal row IMMEDIATELY so it exists before any tasks are created
    // (tasks reference goals via FK — must exist first)
    // MUST be awaited — fire-and-forget causes race where tasks insert before goal row commits
    if (this.services) {
      try {
        // Verify team is registered in PG before creating goals.
        // Teams must be installed via POST /api/v2/teams (or seed:teams in dev).
        if (this.services.teamRegistry) {
          const owner = await this.services.teamRegistry.getOwner(teamId);
          if (!owner) {
            logger.error(`[SocketMessageHandler] Team ${teamId} not installed in PostgreSQL — cannot create goal. Install via POST /api/v2/teams first.`);
            emitError(socket, { error: "Team not installed. Please install the team before sending messages." });
            return;
          }
        }

        await this.services.goals.addGoal({
          teamId,
          userId: socket.data.userId,
          goal: content,
          goalId: resolvedGoalId,
          status: "planning",
          repoUrl: repoUrl || undefined,
          repoBranch: repoBranch || undefined,
        });
      } catch (err) {
        // Non-fatal — goal may already exist (e.g., page refresh re-sends), or we're in local mode
        logger.warn({ err }, "[SocketMessageHandler] Failed to save goal row");
      }
    }

    // Auto-join socket to goal room BEFORE calling orchestratorMessage
    const prevGoalRoom = socket.data.currentGoalRoom as string | undefined;
    if (prevGoalRoom) socket.leave(prevGoalRoom);
    const goalRoomName = `team:${teamId}:goal:${resolvedGoalId}`;
    socket.join(goalRoomName);
    socket.data.currentGoalRoom = goalRoomName;

    const result = await manager.orchestratorMessage(content, resolvedGoalId, repoUrl, repoBranch);

    // Save user message with server-resolved goalId
    if (this.services) {
      this.services.chat.addMessage({
        teamId,
        userId: socket.data.userId,
        role: "user",
        agentId: "manager",
        goalId: resolvedGoalId,
        content,
        agentLayer: "planner",
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn("[SocketMessageHandler] Failed to save user message:", err));
    }

    logger.info(`[SocketMessageHandler] Orchestrator message processed (goalId=${resolvedGoalId})`);

    if (!goalId) {
      socket.emit("goal:created", { goalId: resolvedGoalId, ...(nonce ? { nonce } : {}) });
    }

    const pendingPlan = manager.getOrchestratorPendingPlan(resolvedGoalId);
    if (pendingPlan) {
      const stateResponse: StateResponse = {
        sessionId: sessionId || "default",
        sessionState: "awaiting_approval",
        plan: pendingPlan.tasks,
        goalId: resolvedGoalId || undefined,
        timestamp: Date.now(),
      };
      socket.emit("state", stateResponse);
    } else {
      const goalTasks = buildPlan(manager, resolvedGoalId);
      if (goalTasks.length > 0) {
        const stateResponse = buildStateResponse(manager, sessionId, resolvedGoalId);
        stateResponse.plan = goalTasks;
        socket.emit("state", stateResponse);
        logger.info(`[SocketMessageHandler] Sent ${goalTasks.length} tasks for goal ${resolvedGoalId}`);
      }
    }
  }

  private async handleChatAgentMessage(
    socket: Socket,
    manager: AgentManager,
    teamId: string,
    role: string,
    sessionId: string | undefined,
    content: string,
    goalId?: string,
  ): Promise<void> {
    if (!goalId) {
      logger.error(`[SocketMessageHandler] ChatAgent for role '${role}' rejected — goalId is required`);
      socket.emit("stream", {
        teamId,
        agentId: `chat-${role}`,
        sessionId: sessionId || "default",
        part: { type: "error", error: "goalId is required for chat-agent messages" },
      });
      return;
    }
    const resolvedGoalId = goalId;
    logger.info(`[SocketMessageHandler] ChatAgent message for role '${role}' goalId=${resolvedGoalId}`);

    try {
      const agentId = `chat-${role}`;
      const stream = manager.chatAgentMessage(role, content, resolvedGoalId);

      const acc = { text: "", parts: [] as Array<{ type: string; [key: string]: any }> };

      for await (const event of stream) {
        if (event.type === "stream_part") {
          socket.emit("stream", {
            teamId,
            agentId,
            sessionId: sessionId || "default",
            part: event.part,
            goalId: resolvedGoalId,
          });

          switch (event.part?.type) {
            case "text-delta":
              if (event.part.delta) acc.text += event.part.delta;
              break;
            case "tool-call":
              acc.parts.push({ type: "tool-call", toolCallId: event.part.toolCallId, toolName: event.part.toolName, args: event.part.args });
              break;
            case "tool-result":
              acc.parts.push({ type: "tool-result", toolCallId: event.part.toolCallId, result: event.part.result });
              break;
            case "tool-input-available":
              acc.parts.push({ type: "tool-input", toolCallId: event.part.toolCallId, toolName: event.part.toolName, input: event.part.input });
              break;
            case "tool-output-available":
              acc.parts.push({ type: "tool-output", toolCallId: event.part.toolCallId, output: event.part.output });
              break;
            case "reasoning-delta": {
              const lastReasoning = acc.parts.findLast((p: any) => p.type === "reasoning");
              if (lastReasoning) {
                lastReasoning.text = (lastReasoning.text || "") + (event.part.delta || "");
              } else {
                acc.parts.push({ type: "reasoning", id: event.part.id, text: event.part.delta || "" });
              }
              break;
            }
          }

          if (event.part?.type === "finish" && this.services) {
            if (acc.text.trim() || acc.parts.length > 0) {
              const contextMessages = manager.getChatAgentContext(role, resolvedGoalId);

              this.services.chat.addMessage({
                teamId,
                userId: await this.services.teamRegistry?.getOwner(teamId) ?? "system",
                role: "assistant",
                agentId,
                goalId: resolvedGoalId,
                content: acc.text,
                streamParts: (acc.text.trim() || acc.parts.length > 0) ? JSON.stringify(toRenderedParts(acc.text, acc.parts)) : undefined,
                agentLayer: "chat-agent",
                contextMessages: contextMessages || undefined,
                timestamp: new Date().toISOString(),
              }).catch(err => logger.warn("[SocketMessageHandler] Failed to save chat agent message:", err));
            }
          }
        }
      }
    } catch (err: any) {
      logger.error(`[SocketMessageHandler] ChatAgent error for role '${role}':`, err);
      socket.emit("stream", {
        teamId,
        agentId: `chat-${role}`,
        sessionId: sessionId || "default",
        part: { type: "error", error: err.message || String(err) },
        goalId: resolvedGoalId,
      });
    }
  }

  private async handleWorkerMessage(
    socket: Socket,
    manager: AgentManager,
    agentId: string,
    taskId: string | undefined,
    content: string,
  ): Promise<void> {
    let actualTaskId: string;

    if (!taskId) {
      const result = await manager.startTask(agentId, content);
      actualTaskId = result.taskId;
    } else {
      actualTaskId = taskId;
      await manager.continueTask(taskId, content);
    }

    logger.debug(`[SocketMessageHandler] Worker message processed: ${actualTaskId}`);
  }
}
