/**
 * SocketStatePublisher — non-stream state events extracted from
 * SocketEventBroadcaster.
 *
 * Phase 1.3 of the agent-stream-bus refactor.
 * See: docs/features/agent-stream-bus/feature_implementation_planning.md
 *
 * Behaviour ported VERBATIM from SocketEventBroadcaster (non-stream paths):
 *   - onTaskUpdate     → `state` + per-status `stream` event
 *   - onPlanUpdate     → `state` + per-action `stream` event + goal DB update
 *                        (sets `sessionState`, mirrors goal-room → team-room)
 *   - onPlanProposed   → `state` (with proposed plan tasks) + team mirror
 *   - onWorkerTaskUpdate → `task_update`
 *   - onGoalStatusChange → goal DB update + `goal:stateChange` (with allGoals)
 *   - wireDiscussionEvents → CollabServer onDiscussionChange →
 *                            `discussion:activity` + `discussion:mention`
 *
 * Why this is separate from streaming:
 *   StreamPublisherVisitor handles per-token output (StreamingHooks). State
 *   events are orchestration-level fan-outs — they don't fit the StreamingHooks
 *   contract. Phase 2 will replace them with `IStreamPublisher` calls from
 *   OrchestratorService directly. Until Phase 1.11 deletes
 *   SocketEventBroadcaster, this class is loaded but not wired — the existing
 *   broadcaster keeps running so stream behaviour stays exactly as today.
 *
 * Status: ADDITIVE. Not yet wired into SocketServerV2.
 */

import type { Server as SocketIOServer } from "socket.io";
import { rootLogger } from "../../logging/index.js";
import type { ServiceRegistry } from "../../services/ServiceRegistry.js";
import type { AgentManager } from "../../agentManager/AgentManagerV2.js";
import type { StreamPayload } from "../types/streamTypes.js";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../types/socketEvents.js";
import type { TaskUpdate } from "@ping/agent-manager";
import {
  type StateResponse,
  buildStateResponse,
  buildPlanFromPending,
} from "../socket-types.js";

const logger = rootLogger.child({ module: "SocketStatePublisher" });

// =============================================================================
// Public callback shapes (mirror ManagerStreamCallbacks subset)
// =============================================================================

export interface TaskUpdateData {
  taskId: string;
  status: string;
  role?: string;
  output?: any;
}

export interface PlanUpdateData {
  action: string;
  goalId?: string;
  tasksQueued?: number;
  timestamp: number;
}

export interface PlanProposedData {
  goalId?: string;
  plan?: unknown;
  [k: string]: any;
}

/** Channel B coarse-grained task update payload (re-export for callers). */
export type WorkerTaskUpdateData = TaskUpdate;

export interface GoalStatusChangeData {
  teamId: string;
  goalId: string;
  status: "completed" | "failed";
}

export interface SocketStatePublisherDeps {
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  services: ServiceRegistry | null;
  manager: AgentManager;
  teamId: string;
}

// =============================================================================
// Implementation
// =============================================================================

export class SocketStatePublisher {
  /**
   * Tracks teams whose discussion listener has already been registered.
   * Module-level so it survives across SocketStatePublisher instances
   * created for the same team — mirrors `attachedTeams` in the legacy
   * SocketEventBroadcaster.
   */
  private static readonly discussionWiredTeams = new Set<string>();

  private readonly io: SocketStatePublisherDeps["io"];
  private readonly services: SocketStatePublisherDeps["services"];
  private readonly manager: AgentManager;
  private readonly teamId: string;
  private readonly room: string;

  constructor(deps: SocketStatePublisherDeps) {
    this.io = deps.io;
    this.services = deps.services;
    this.manager = deps.manager;
    this.teamId = deps.teamId;
    this.room = `team:${deps.teamId}`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Goal-scoped room name; falls back to team room when no goal. */
  private goalRoom(goalId?: string | null): string {
    return goalId ? `team:${this.teamId}:goal:${goalId}` : this.room;
  }

  private taskGoalId(taskId?: string): string | undefined {
    if (!taskId) return undefined;
    return this.manager.getTaskStore()?.get(taskId)?.goalId;
  }

  // ---------------------------------------------------------------------------
  // State event handlers (parity with SocketEventBroadcaster)
  // ---------------------------------------------------------------------------

  /** Mirrors SocketEventBroadcaster.onTaskUpdate. */
  handleTaskUpdate(data: TaskUpdateData): void {
    const { taskId, status, role } = data;
    const gid = this.taskGoalId(taskId);
    const target = this.goalRoom(gid);

    const stateResponse = buildStateResponse(this.manager, undefined, gid);
    this.io.to(target).emit("state", stateResponse);
    logger.debug(`[SocketStatePublisher] Task ${taskId} → ${status}, broadcast to ${target}`);

    if (status === "in_progress") {
      this.io.to(target).emit("stream", {
        sessionId: "default",
        taskId,
        agentId: role || "worker",
        part: { type: "task-started", taskId, role: role || "worker" },
        timestamp: Date.now(),
      } as StreamPayload);
    } else if (status === "completed") {
      this.io.to(target).emit("stream", {
        sessionId: "default",
        taskId,
        agentId: role || "worker",
        part: { type: "task-completed", taskId, role: role || "worker" },
        timestamp: Date.now(),
      } as StreamPayload);
    } else if (status === "failed") {
      this.io.to(target).emit("stream", {
        sessionId: "default",
        taskId,
        agentId: role || "worker",
        part: { type: "task-failed", taskId, role: role || "worker", error: "Task failed" },
        timestamp: Date.now(),
      } as StreamPayload);
    }
  }

  /** Mirrors SocketEventBroadcaster.onPlanUpdate. */
  handlePlanUpdate(data: PlanUpdateData): void {
    const { action, goalId } = data;
    const gid = goalId || undefined;
    const target = gid ? this.goalRoom(gid) : this.room;

    const stateResponse = buildStateResponse(this.manager, undefined, gid);
    stateResponse.sessionState =
      action === "approved" ? "executing" : "awaiting_approval";

    logger.info(
      `[SocketStatePublisher] onPlanUpdate: action=${action}, goalId=${gid}, target=${target}, tasks=${stateResponse.plan?.length ?? 0}`,
    );
    this.io.to(target).emit("state", stateResponse);

    // Mirror goal-scoped state to team room with a minimal payload.
    if (target !== this.room) {
      this.io.to(this.room).emit("state", {
        sessionId: "default",
        sessionState: action === "approved" ? "executing" : "awaiting_approval",
        goalId: gid,
        timestamp: Date.now(),
      } as StateResponse);
    }
    logger.debug(`[SocketStatePublisher] Plan ${action} for goal ${gid}, broadcast to ${target}`);

    // Goal DB status update on approval.
    if (action === "approved" && this.services && gid) {
      this.services.goals
        .updateGoal(gid, { status: "executing" })
        .catch((err) =>
          logger.warn("[SocketStatePublisher] Failed to update goal status:", err),
        );
    }

    // Stream marker for plan lifecycle (room-wide so dashboards see it).
    const payload: StreamPayload = {
      sessionId: "default",
      agentId: "orchestrator",
      part:
        action === "approved"
          ? { type: "plan-approved", planId: "current" }
          : { type: "plan-proposed", planId: "current", taskCount: 0 },
      timestamp: Date.now(),
    };
    this.io.to(this.room).emit("stream", payload);
  }

  /** Mirrors SocketEventBroadcaster.onPlanProposed. */
  handlePlanProposed(data: PlanProposedData): void {
    const proposedGoalId = data?.goalId;
    logger.info(`[SocketStatePublisher] onPlanProposed fired, goalId=${proposedGoalId}`);

    const planTasks = data?.plan ? buildPlanFromPending(data.plan) : [];
    const target = proposedGoalId ? this.goalRoom(proposedGoalId) : this.room;

    const stateResponse: StateResponse = {
      sessionId: "default",
      sessionState: "awaiting_approval",
      plan: planTasks,
      goalId: proposedGoalId,
      timestamp: Date.now(),
    };
    this.io.to(target).emit("state", stateResponse);

    if (target !== this.room) {
      this.io.to(this.room).emit("state", {
        sessionId: "default",
        sessionState: "awaiting_approval",
        goalId: proposedGoalId,
        timestamp: Date.now(),
      } as StateResponse);
    }
    logger.info(
      `[SocketStatePublisher] Plan proposed: emitted state with ${planTasks.length} tasks to ${target}`,
    );
  }

  /** Mirrors SocketEventBroadcaster.onWorkerTaskUpdate. */
  handleWorkerTaskUpdate(update: WorkerTaskUpdateData): void {
    this.io.to(this.goalRoom(this.taskGoalId(update.taskId))).emit("task_update", {
      ...update,
      teamId: this.teamId,
    });
  }

  /** Mirrors SocketEventBroadcaster.onGoalStatusChange. */
  handleGoalStatusChange(data: GoalStatusChangeData): void {
    const { teamId: tid, goalId: completedGoalId, status } = data;

    if (this.services) {
      if (completedGoalId) {
        this.services.goals
          .updateGoal(completedGoalId, { status })
          .then(() =>
            logger.info(`[SocketStatePublisher] Goal ${completedGoalId} → ${status}`),
          )
          .catch((err) =>
            logger.warn("[SocketStatePublisher] Failed to update goal status:", err),
          );
      } else {
        logger.error(
          `[SocketStatePublisher] onGoalStatusChange received without goalId — cannot update DB`,
        );
      }
    }

    const allGoals = this.manager.getAllGoalSummaries?.() ?? [];
    this.io.to(this.room).emit("goal:stateChange", {
      teamId: tid,
      goalId: completedGoalId,
      state: status,
      allGoals,
    });
  }

  /**
   * Wire CollabServer.onDiscussionChange → discussion:* events.
   * Mirrors SocketEventBroadcaster.wireDiscussionEvents.
   *
   * Idempotent: if called more than once for the same team (e.g. because a
   * second SocketStatePublisher is constructed for the same team), the
   * second call is a no-op so we don't double-fire `discussion:activity` /
   * `discussion:mention`.
   */
  wireDiscussionEvents(): void {
    if (SocketStatePublisher.discussionWiredTeams.has(this.teamId)) {
      logger.debug(
        `[SocketStatePublisher] Discussion events already wired for team ${this.teamId} — skipping`,
      );
      return;
    }

    try {
      const plugin = this.manager.getPluginRegistry().get("collaboration") as any;
      const collabServer = plugin?.l2Plugin?.collabServer ?? plugin?.collabServer;
      if (!collabServer?.onDiscussionChange) {
        logger.info(
          `[SocketStatePublisher] No CollabServer for team ${this.teamId} — discussion events will not work.`,
        );
        return;
      }

      collabServer.onDiscussionChange(
        (event: {
          teamId: string;
          goalId: string;
          taskId: string;
          docName: string;
          blockCount: number;
          mentions: string[];
        }) => {
          this.io.to(this.room).emit("discussion:activity", {
            teamId: event.teamId,
            goalId: event.goalId,
            taskId: event.taskId,
            docName: event.docName,
            blockCount: event.blockCount,
            timestamp: Date.now(),
          });

          if (event.mentions.length > 0) {
            this.io.to(this.room).emit("discussion:mention", {
              teamId: event.teamId,
              goalId: event.goalId,
              taskId: event.taskId,
              docName: event.docName,
              mentions: event.mentions,
              timestamp: Date.now(),
            });
          }
        },
      );

      logger.info(
        `[SocketStatePublisher] Discussion events wired for team ${this.teamId}`,
      );
      SocketStatePublisher.discussionWiredTeams.add(this.teamId);
    } catch (err) {
      logger.warn(
        `[SocketStatePublisher] Failed to wire discussion events for team ${this.teamId}: ${err}`,
      );
    }
  }
}
