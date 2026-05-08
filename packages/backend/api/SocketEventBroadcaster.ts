/**
 * SocketEventBroadcaster — Manager event callbacks → Socket.IO room broadcasts.
 *
 * Extracted from SocketServerV2.ts (v5.0 communication layer refactor).
 *
 * Responsibilities:
 * - Register stream/event/done/error/taskUpdate/planUpdate/goalStatusChange callbacks
 * - Accumulate stream parts for persistence (text + tool calls + reasoning)
 * - Broadcast to goal-scoped or team-scoped Socket.IO rooms
 * - Wire CollabServer discussion events
 */

import type { Server as SocketIOServer } from "socket.io";
import { rootLogger } from "../logging/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";
import type { AgentManager } from "../agentManager/AgentManagerV2.js";
import type { StreamPayload } from "./types/streamTypes.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./types/socketEvents.js";
import {
  type WorkerEventType,
  type ProgressResponse,
  type StateResponse,
  WORKER_EVENT_ROUTES,
  toRenderedParts,
  formatProgressContent,
  toStreamPart,
  buildStateResponse,
  buildPlan,
  buildPlanFromPending,
} from "./socket-types.js";

const logger = rootLogger.child({ module: "SocketEventBroadcaster" });

export class SocketEventBroadcaster {
  private attachedTeams = new Set<string>();

  constructor(
    private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>,
    private services: ServiceRegistry | null,
  ) {}

  /**
   * Register direct callbacks on the manager to broadcast events to Socket.IO room.
   * Called once per team on first interaction.
   */
  ensureTeamCallbacks(teamId: string, manager: AgentManager): void {
    if (this.attachedTeams.has(teamId)) return;
    this.attachedTeams.add(teamId);

    const room = `team:${teamId}`;
    const streamedTasks = new Set<string>();

    const goalRoom = (goalId?: string | null): string =>
      goalId ? `team:${teamId}:goal:${goalId}` : room;

    const taskGoalId = (taskId?: string): string | undefined => {
      if (!taskId) return undefined;
      return manager.getTaskStore()?.get(taskId)?.goalId;
    };

    const messageAccumulator = new Map<string, {
      agentId: string;
      text: string;
      parts: Array<{ type: string; [key: string]: any }>;
    }>();

    manager.registerStreamCallbacks({
      onStream: async ({ taskId, agentId, part, goalId: streamGoalId }) => {
        if (taskId) streamedTasks.add(taskId);

        // Composite key — must include `streamGoalId` so concurrent
        // planner/chat runs across different goals don't collide on
        // `agentId="planner"` or `agentId="chat-{role}"` (May 9 2026 PM-7
        // — review fix #1: prevents cross-goal accumulator contamination
        // while SocketEventBroadcaster remains the persistence bridge).
        // For task-scoped runs the taskId is already goal-unique, so
        // including streamGoalId is redundant but harmless.
        const accKey = `${streamGoalId ?? "no-goal"}::${taskId || agentId || "unknown"}`;
        const acc = messageAccumulator.get(accKey) || { agentId: agentId || "worker", text: "", parts: [] };

        switch (part?.type) {
          case "text-delta":
            if (part.delta) acc.text += part.delta;
            break;
          case "tool-call":
            acc.parts.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, args: part.args });
            break;
          case "tool-result":
            acc.parts.push({ type: "tool-result", toolCallId: part.toolCallId, result: part.result });
            break;
          case "tool-input-available":
            acc.parts.push({ type: "tool-input", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
            break;
          case "tool-output-available":
            acc.parts.push({ type: "tool-output", toolCallId: part.toolCallId, output: part.output });
            break;
          case "reasoning-delta": {
            const lastReasoning = acc.parts.findLast((p: { type: string; text?: string }) => p.type === "reasoning") as { type: string; text?: string } | undefined;
            if (lastReasoning) {
              lastReasoning.text = (lastReasoning.text || "") + (part.delta || "");
            } else {
              acc.parts.push({ type: "reasoning", id: part.id, text: part.delta || "" });
            }
            break;
          }
        }

        messageAccumulator.set(accKey, acc);

        if (part?.type === "finish" && this.services) {
          if (acc.text.trim() || acc.parts.length > 0) {
            const contextMessages = taskId
              ? manager.getWorkerContext(taskId)
              : null;

            if (!streamGoalId) {
              logger.warn(`[SocketEventBroadcaster] Skipping stream message persistence — no goalId. agentId=${acc.agentId}, taskId=${taskId}`);
            } else {
              const msgPayload = {
                teamId,
                userId: await this.services.teamRegistry?.getOwner(teamId) ?? "system",
                role: "assistant" as const,
                agentId: acc.agentId || "unknown",
                taskId: taskId || undefined,
                goalId: streamGoalId,
                content: acc.text || " ",
                streamParts: (acc.text.trim() || acc.parts.length > 0) ? JSON.stringify(toRenderedParts(acc.text, acc.parts)) : undefined,
                agentLayer: (acc.agentId === "planner" || acc.agentId === "manager" || acc.agentId === "orchestrator")
                  ? "planner" as const
                  : acc.agentId.startsWith("chat-")
                  ? "chat-agent" as const
                  : "worker" as const,
                contextMessages: contextMessages || undefined,
                timestamp: new Date().toISOString(),
              };

              try {
                await this.services.chat.addMessage(msgPayload);
              } catch (err) {
                logger.warn({ err, taskId, agentId: acc.agentId }, "[SocketEventBroadcaster] Failed to save message — retrying once");
                setTimeout(() => {
                  this.services?.chat.addMessage(msgPayload).catch(() => {});
                }, 500);
              }
            }
          }
          messageAccumulator.delete(accKey);
        }

        const payload: StreamPayload = {
          sessionId: "default",
          taskId,
          agentId: agentId || "worker",
          part,
          goalId: streamGoalId,
          timestamp: Date.now(),
        };
        this.io.to(goalRoom(streamGoalId)).emit("stream", payload);
      },

      onEvent: ({ taskId, event }) => {
        const eventType = event.type as WorkerEventType;
        const routes = WORKER_EVENT_ROUTES[eventType];
        if (!routes) return;

        const agentId = event.role || "worker";

        if (routes.includes("progress")) {
          this.io.to(goalRoom(taskGoalId(taskId))).emit("progress", {
            sessionId: "default",
            taskId,
            agentId,
            type: eventType,
            content: formatProgressContent(event),
            tool: event.tool,
            timestamp: Date.now(),
          } as any);
        }

        if (routes.includes("stream")) {
          const streamPartData = toStreamPart(eventType, event, taskId);
          if (streamPartData) {
            const payload: StreamPayload = {
              sessionId: "default",
              taskId,
              agentId,
              part: streamPartData,
              timestamp: Date.now(),
            };
            this.io.to(goalRoom(taskGoalId(taskId))).emit("stream", payload);
          }
        }
      },

      onDone: ({ taskId, role }) => {
        if (taskId && streamedTasks.has(taskId)) {
          streamedTasks.delete(taskId);
          return;
        }
        this.io.to(goalRoom(taskGoalId(taskId))).emit("stream", {
          sessionId: "default",
          agentId: role,
          taskId,
          part: { type: "finish", finishReason: "stop" },
          timestamp: Date.now(),
        } as StreamPayload);
      },

      onError: ({ taskId, error }) => {
        this.io.to(goalRoom(taskGoalId(taskId))).emit("error", {
          taskId,
          error,
          timestamp: Date.now(),
        });
      },

      onTaskUpdate: ({ taskId, status, role }) => {
        const gid = taskGoalId(taskId);
        const target = goalRoom(gid);
        const stateResponse = buildStateResponse(manager, undefined, gid);
        this.io.to(target).emit("state", stateResponse);
        logger.debug(`[SocketEventBroadcaster] Task ${taskId} → ${status}, broadcast to ${target}`);

        if (status === "in_progress") {
          const payload: StreamPayload = {
            sessionId: "default", taskId,
            agentId: role || "worker",
            part: { type: "task-started", taskId, role: role || "worker" },
            timestamp: Date.now(),
          };
          this.io.to(target).emit("stream", payload);
        } else if (status === "completed") {
          const payload: StreamPayload = {
            sessionId: "default", taskId,
            agentId: role || "worker",
            part: { type: "task-completed", taskId, role: role || "worker" },
            timestamp: Date.now(),
          };
          this.io.to(target).emit("stream", payload);
        } else if (status === "failed") {
          const payload: StreamPayload = {
            sessionId: "default", taskId,
            agentId: role || "worker",
            part: { type: "task-failed", taskId, role: role || "worker", error: "Task failed" },
            timestamp: Date.now(),
          };
          this.io.to(target).emit("stream", payload);
        }
      },

      onPlanUpdate: ({ action, goalId: planGoalId }) => {
        const gid = planGoalId || undefined;
        const target = gid ? goalRoom(gid) : room;
        const stateResponse = buildStateResponse(manager, undefined, gid);
        // Set sessionState based on action — proposals await approval, approvals start execution
        stateResponse.sessionState = action === "approved" ? "executing" : "awaiting_approval";
        logger.info(`[SocketEventBroadcaster] onPlanUpdate: action=${action}, goalId=${gid}, target=${target}, tasks=${stateResponse.plan?.length ?? 0}`);
        this.io.to(target).emit("state", stateResponse);
        if (target !== room) {
          this.io.to(room).emit("state", { sessionId: "default", sessionState: action === "approved" ? "executing" : "awaiting_approval", goalId: gid, timestamp: Date.now() } as StateResponse);
        }
        logger.debug(`[SocketEventBroadcaster] Plan ${action} for goal ${gid}, broadcast to ${target}`);

        // Update goal status on approval (goal row already exists — created in SocketMessageHandler)
        if (action === "approved" && this.services && gid) {
          this.services.goals.updateGoal(gid, { status: "executing" })
            .catch(err => logger.warn("[SocketEventBroadcaster] Failed to update goal status:", err));
        }

        const payload: StreamPayload = {
          sessionId: "default",
          agentId: "orchestrator",
          part: action === "approved"
            ? { type: "plan-approved", planId: "current" }
            : { type: "plan-proposed", planId: "current", taskCount: 0 },
          timestamp: Date.now(),
        };
        this.io.to(room).emit("stream", payload);
      },

      onPlanProposed: (_data) => {
        const proposedGoalId = (_data as any)?.goalId;
        logger.info(`[SocketEventBroadcaster] onPlanProposed fired, goalId=${proposedGoalId}`);

        // Build plan tasks from the proposed (pending) plan data — NOT from TaskStore
        // (TaskStore is only populated after approval)
        const planTasks = (_data as any)?.plan
          ? buildPlanFromPending((_data as any).plan)
          : [];

        const target = proposedGoalId ? goalRoom(proposedGoalId) : room;
        const stateResponse: StateResponse = {
          sessionId: "default",
          sessionState: "awaiting_approval",
          plan: planTasks,
          goalId: proposedGoalId,
          timestamp: Date.now(),
        };
        this.io.to(target).emit("state", stateResponse);
        // Also broadcast to team room if goal-scoped
        if (target !== room) {
          this.io.to(room).emit("state", {
            sessionId: "default",
            sessionState: "awaiting_approval",
            goalId: proposedGoalId,
            timestamp: Date.now(),
          } as StateResponse);
        }
        logger.info(`[SocketEventBroadcaster] Plan proposed: emitted state with ${planTasks.length} tasks to ${target}`);
      },

      onWorkerTaskUpdate: (update) => {
        this.io.to(goalRoom(taskGoalId(update.taskId))).emit("task_update", {
          ...update,
          teamId,
        });
      },

      onGoalStatusChange: ({ teamId: tid, goalId: completedGoalId, status }) => {
        if (!this.services) return;
        if (completedGoalId) {
          this.services.goals.updateGoal(completedGoalId, { status })
            .then(() => logger.info(`[SocketEventBroadcaster] Goal ${completedGoalId} → ${status}`))
            .catch(err => logger.warn("[SocketEventBroadcaster] Failed to update goal status:", err));
        } else {
          logger.error(`[SocketEventBroadcaster] onGoalStatusChange received without goalId — cannot update DB`);
        }

        const allGoals = manager.getAllGoalSummaries?.() ?? [];
        this.io.to(room).emit("goal:stateChange", {
          teamId: tid,
          goalId: completedGoalId,
          state: status,
          allGoals,
        });
      },
    });

    this.wireDiscussionEvents(teamId, manager, room);
    logger.info(`[SocketEventBroadcaster] Callbacks registered for team ${teamId}`);
  }

  /**
   * Wire CollabServer discussion onChange → Socket.IO discussion events.
   */
  private wireDiscussionEvents(teamId: string, manager: AgentManager, room: string): void {
    try {
      const plugin = manager.getPluginRegistry().get("collaboration") as any;
      const collabServer = plugin?.l2Plugin?.collabServer ?? plugin?.collabServer;
      if (!collabServer?.onDiscussionChange) {
        logger.info(`[SocketEventBroadcaster] No CollabServer for team ${teamId} — discussion events will not work.`);
        return;
      }

      collabServer.onDiscussionChange((event: {
        teamId: string; goalId: string; taskId: string;
        docName: string; blockCount: number; mentions: string[];
      }) => {
        this.io.to(room).emit("discussion:activity", {
          teamId: event.teamId,
          goalId: event.goalId,
          taskId: event.taskId,
          docName: event.docName,
          blockCount: event.blockCount,
          timestamp: Date.now(),
        });

        if (event.mentions.length > 0) {
          this.io.to(room).emit("discussion:mention", {
            teamId: event.teamId,
            goalId: event.goalId,
            taskId: event.taskId,
            docName: event.docName,
            mentions: event.mentions,
            timestamp: Date.now(),
          });
        }
      });

      logger.info(`[SocketEventBroadcaster] Discussion events wired for team ${teamId}`);
    } catch (err) {
      logger.warn(`[SocketEventBroadcaster] Failed to wire discussion events for team ${teamId}: ${err}`);
    }
  }
}
