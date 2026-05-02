/**
 * SocketServerV2 - Simplified Socket.IO server with 6 events
 *
 * Events:
 *   Bidirectional:
 *     - message: Chat messages between user and agents
 *
 *   Client → Server:
 *     - action: approve-plan, start-task, complete-task, cancel-task, auto-execute
 *
 *   Server → Client:
 *     - state: Session/task state changes
 *     - output: Agent produced structured output
 *     - progress: Real-time updates during task execution (thinking, tool calls)
 *     - error: Error occurred
 *
 * Uses AgentManagerRegistry for team isolation (no passed AgentManager)
 *
 * TODO: Future Streaming Enhancements
 * - Token-level streaming for LLM responses (currently waits for full response)
 * - SSE fallback for environments where WebSocket is unreliable
 * - Backpressure handling for very high-frequency events
 * - Progress event batching/throttling to reduce network overhead
 *
 * Streaming Enhancement (Phase 2):
 * - AI SDK `streamText` streams are forwarded via the `stream` channel
 * - The `stream` channel uses AI SDK Data Stream Protocol typed parts
 * - Both `progress` (legacy) and `stream` (new) events are emitted simultaneously
 *   for backward compatibility with legacy event listeners
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import { rootLogger } from "../logging/index.js";
import { randomUUID } from "crypto";
import { z } from "zod";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import {
  socketConnectionManager,
  type SocketConnection,
} from "./SocketConnectionManager.js";
import { userManager } from "./UserManager.js";
import { getAuth } from "../auth/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";
import type { AgentManager } from "../agentManager/AgentManagerV2.js";
import type { StreamPayload } from "./types/streamTypes.js";
import type { ClientToServerEvents, ServerToClientEvents } from "@ping/shared";

const logger = rootLogger.child({ module: "SocketServerV2" });

// Input validation schemas
const MessagePayloadSchema = z.object({
  teamId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  taskId: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  goalId: z.string().max(200).nullish(),
  nonce: z.string().max(200).optional(),
  content: z.string().min(1).max(100000), // 100KB max message
  repoUrl: z.string().url().max(500).optional(),
  repoBranch: z.string().max(200).optional(),
});

const ActionPayloadSchema = z.object({
  teamId: z.string().min(1).max(200),
  type: z.enum(["approve-plan", "start-task", "complete-task", "cancel-task", "modify-task", "auto-execute", "get-state"]),
  sessionId: z.string().max(200).optional(),
  taskId: z.string().max(200).optional(),
  goalId: z.string().max(200).optional(),
  output: z.any().optional(),
  changes: z.record(z.any()).optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// Types
// ============================================================================

/** Client → Server: message payload */
interface MessagePayload {
  teamId: string;
  agentId: string; // 'orchestrator' | worker role
  taskId?: string; // present when chatting with worker on specific task
  sessionId?: string; // optional, server creates if missing
  content: string;
}

/** Client → Server: action payload */
interface ActionPayload {
  teamId: string;
  type:
    | "approve-plan"
    | "start-task"
    | "complete-task"
    | "cancel-task"
    | "modify-task"
    | "auto-execute" // set if enabled provided, get if not
    | "get-state"; // fetch current tasks/plan state
  sessionId?: string;
  taskId?: string;
  output?: any;
  changes?: Record<string, any>;
  enabled?: boolean; // for auto-execute: set value (omit to just query)
}

/** Server → Client: message payload */
interface MessageResponse {
  sessionId: string;
  agentId: string;
  taskId?: string;
  content: string;
  isStreaming?: boolean;
  timestamp: number;
}

/** Server → Client: state payload */
interface StateResponse {
  sessionId: string;
  sessionState?:
    | "planning"
    | "ready"
    | "executing"
    | "completed"
    | "awaiting_approval";
  plan?: PlanTask[];
  tasks?: any[];
  autoExecute?: boolean;
  goalId?: string;
  timestamp: number;
}

/** Task in a plan, sent to frontend */
interface PlanTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  status: string;
  priority: number;
  dependencies: string[];
  goalId?: string;
}

/** Server → Client: output payload */
interface OutputResponse {
  sessionId: string;
  taskId: string;
  agentId: string;
  output: {
    content: string;
    contentType?: string;
    filePath?: string;
    links?: string[];
  };
  timestamp: number;
}

/** Server → Client: progress payload */
interface ProgressResponse {
  sessionId: string;
  taskId: string;
  agentId: string;
  type: WorkerEventType;
  content: string;
  tool?: string;
  timestamp: number;
}

// ============================================================================
// Worker Event Routing
// ============================================================================

/**
 * All known worker event types emitted by agents (see AgentEvent in agent/types.ts).
 * Each type maps to zero or more socket channels via WORKER_EVENT_ROUTES.
 */
type WorkerEventType =
  | "thinking"
  | "planning"
  | "tool_start"
  | "tool_result"
  | "message"
  | "message_delta"
  | "artifact"
  | "frame"
  | "hotspots"
  | "error"
  | "done";

/** Which socket channels a worker event should be forwarded to */
type SocketChannel = "progress" | "stream";

/**
 * Routing table: worker event type → socket channels.
 * Add new event types here instead of scattering if-checks across the file.
 */
const WORKER_EVENT_ROUTES: Record<WorkerEventType, SocketChannel[]> = {
  // Legacy events → progress panel only (stream_part handles the stream channel)
  thinking:      ["progress"],
  planning:      ["progress"],
  tool_start:    ["progress"],
  tool_result:   ["progress"],
  // Dead routes — handled by dedicated handlers, not the generic event router
  message:       [],                    // worker:done handler
  message_delta: [],                    // no longer emitted (stream_part replaced it)
  error:         [],                    // worker:error handler
  done:          [],                    // worker:done handler
  // Non-agent events that still use the legacy stream path
  artifact:      ["stream"],
  frame:         ["stream"],
  hotspots:      ["stream"],
};

/** Server → Client: error payload */
interface ErrorResponse {
  sessionId?: string | undefined;
  taskId?: string | undefined;
  error: string;
  timestamp: number;
}

// ============================================================================
// Socket Rate Limiter — Token Bucket
// ============================================================================

/**
 * Convert raw accumulator parts into RenderedPart[] format for persistence.
 *
 * The frontend renders messages using RenderedPart[] (text, tool-card, reasoning).
 * This converter transforms the backend's raw accumulator format into the exact
 * shape StreamMessage/ToolCard/ReasoningSection expect, so messages look identical
 * after reload as they did during live streaming.
 */
function toRenderedParts(
  accText: string,
  accParts: Array<{ type: string; [key: string]: any }>,
): any[] {
  const rendered: any[] = [];

  // 1. Text part — from accumulated text
  if (accText.trim()) {
    rendered.push({ type: "text", id: "text-0", text: accText, done: true });
  }

  // 2. Tool cards — merge tool-call/tool-input with matching tool-result/tool-output by toolCallId
  const toolCards = new Map<string, {
    toolCallId: string; toolName: string; status: string;
    argsText: string; args?: unknown; result?: unknown;
  }>();
  // Track insertion order for stable rendering
  const toolOrder: string[] = [];

  for (const p of accParts) {
    if (p.type === "tool-call" || p.type === "tool-input") {
      const id = p.toolCallId;
      if (!toolCards.has(id)) toolOrder.push(id);
      const card = toolCards.get(id) || { toolCallId: id, toolName: p.toolName || "unknown", status: "complete", argsText: "" };
      card.toolName = p.toolName || card.toolName;
      card.args = p.args ?? p.input;
      try { card.argsText = JSON.stringify(p.args ?? p.input, null, 2); } catch { card.argsText = ""; }
      toolCards.set(id, card);
    } else if (p.type === "tool-result" || p.type === "tool-output") {
      const id = p.toolCallId;
      if (!toolCards.has(id)) toolOrder.push(id);
      const card = toolCards.get(id) || { toolCallId: id, toolName: "unknown", status: "complete", argsText: "" };
      card.result = p.result ?? p.output;
      card.status = "complete";
      toolCards.set(id, card);
    }
  }
  for (const id of toolOrder) {
    rendered.push({ type: "tool-card", card: toolCards.get(id) });
  }

  // 3. Reasoning parts — add done: true
  for (const p of accParts) {
    if (p.type === "reasoning") {
      rendered.push({ type: "reasoning", id: p.id || "reasoning-0", text: p.text || "", done: true });
    }
  }

  return rendered;
}

/**
 * Token bucket rate limiter — per userId.
 *
 * Each user gets a bucket with `capacity` tokens. Each request consumes 1 token.
 * Tokens refill at `refillRate` tokens per second. Allows controlled bursts
 * (up to capacity) then enforces a steady rate.
 *
 * Example: capacity=5, refillRate=1 → user can send 5 messages instantly,
 * then 1 per second. After 5 idle seconds, bucket is full again.
 */
class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private capacity: number = 5,
    private refillRate: number = 1, // tokens per second
  ) {}

  /** Returns true if the request is allowed (consumes 1 token), false if throttled */
  allow(userId: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(userId);

    if (!bucket) {
      // New user — full bucket minus this request
      this.buckets.set(userId, { tokens: this.capacity - 1, lastRefill: now });
      return true;
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return false; // No tokens — throttled
    }

    bucket.tokens -= 1;
    return true;
  }

  /** Cleanup idle buckets (call periodically) */
  cleanup(): void {
    const now = Date.now();
    const idleThreshold = this.capacity / this.refillRate * 1000 * 2; // 2x time to full refill
    for (const [userId, bucket] of this.buckets) {
      if (now - bucket.lastRefill > idleThreshold) {
        this.buckets.delete(userId);
      }
    }
  }
}

// ============================================================================
// SocketServerV2
// ============================================================================

export class SocketServerV2 {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private services: ServiceRegistry | null;
  private rateLimiter = new TokenBucketLimiter(5, 1); // 5 burst, 1 token/sec refill

  /** Track teams that have event listeners attached */
  private attachedTeams = new Set<string>();

  constructor(httpServer: any, services?: ServiceRegistry) {
    this.services = services ?? null;

    // Cleanup rate limiter windows periodically
    setInterval(() => this.rateLimiter.cleanup(), 30_000);

    // CORS — allowlist specific origins
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000",
      process.env.BETTER_AUTH_URL || "http://localhost:3002",
      "http://localhost:3001",
    ];

    // Initialize Socket.IO
    this.io = new SocketIOServer(httpServer, {
      path: "/socket.io/v2", // V2 path to coexist with V1
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupSocketIO();
  }

  private setupSocketIO() {
    logger.info("[SocketServerV2] Initialized on /socket.io/v2");

    // Auth middleware — validate better-auth session cookie on every connection
    this.io.use(async (socket, next) => {
      try {
        const auth = await getAuth();
        const headers = socket.handshake.headers;
        const session = await auth.api.getSession({
          headers: new Headers({
            cookie: headers.cookie || "",
            authorization: headers.authorization || "",
          }),
        });
        if (!session?.user?.id) {
          return next(new Error("Authentication required"));
        }
        socket.data.userId = session.user.id;
        socket.data.userEmail = session.user.email;
        socket.data.userName = session.user.name;
        next();
      } catch (err) {
        logger.warn("[SocketServerV2] Socket auth failed:", err);
        next(new Error("Authentication failed"));
      }
    });

    this.io.on("connection", this.handleConnection.bind(this));
  }

  private handleConnection(socket: Socket) {
    logger.info("[SocketServerV2] New connection");

    socket.once("register", this.handleRegister.bind(this, socket));

    // Registration timeout
    setTimeout(() => {
      if (!socket.data.registered) {
        logger.warn("[SocketServerV2] Registration timeout, disconnecting");
        socket.disconnect();
      }
    }, 5000);
  }

  private async handleRegister(socket: Socket, data: { userId: string; token?: string }) {
    // Use server-verified userId from auth middleware (not client-provided)
    const userId = socket.data.userId || data.userId;

    if (!userId) {
      this.emitError(socket, { error: "userId is required" });
      socket.disconnect();
      return;
    }

    const connectionId = randomUUID();
    const timestamp = Date.now();

    userManager.createOrUpdateUser(userId, timestamp);

    const connection: SocketConnection = {
      connectionId,
      userId,
      socket,
      subscribedAgents: new Set(),
      connectedAt: timestamp,
    };
    socketConnectionManager.addConnection(connection);

    socket.emit("registered", { clientId: connectionId, userId, timestamp });
    socket.data.registered = true;

    // Setup V2 handlers - only 2 incoming events!
    socket.on("message", (data) =>
      this.handleMessage(socket, connection, data),
    );
    socket.on("action", (data) => this.handleAction(socket, connection, data));
    socket.on("disconnect", () => this.handleDisconnect(connection));

    // Phase 4.5: Goal-scoped room subscription
    socket.on("subscribeToGoal", ({ teamId, goalId }: { teamId: string; goalId: string }) => {
      // Leave previous goal room (if any)
      const prevGoalRoom = socket.data.currentGoalRoom as string | undefined;
      if (prevGoalRoom) socket.leave(prevGoalRoom);

      const goalRoom = `team:${teamId}:goal:${goalId}`;
      socket.join(goalRoom);
      socket.data.currentGoalRoom = goalRoom;
      logger.debug(`[SocketServerV2] Socket ${connectionId} joined goal room ${goalRoom}`);
    });

    // Phase 4.5: Goal-scoped room unsubscription
    socket.on("unsubscribeFromGoal", ({ teamId, goalId }: { teamId: string; goalId: string }) => {
      const goalRoom = `team:${teamId}:goal:${goalId}`;
      socket.leave(goalRoom);
      if (socket.data.currentGoalRoom === goalRoom) {
        socket.data.currentGoalRoom = undefined;
      }
      logger.debug(`[SocketServerV2] Socket ${connectionId} left goal room ${goalRoom}`);
    });

    logger.info(`[SocketServerV2] User ${userId} registered (${connectionId})`);
  }

  // ============================================================================
  // Event Streaming - Manager → Socket.IO Room Broadcasts
  // ============================================================================
  //
  // Manager events (from AgentManager):     Socket events (to clients):
  // ─────────────────────────────────────   ─────────────────────────────────
  // worker:event (thinking/tool)        →   progress  (real-time streaming)
  // worker:done  (task output)          →   message   (chat response)
  // worker:error (task failed)          →   error     (error notification)
  // task:update  (status change)        →   state     (task list refresh)
  // plan:update  (plan approved/changed)→   state     (plan refresh)
  //
  // ============================================================================

  /**
   * Register direct callbacks on the manager to broadcast events to Socket.IO room.
   * Called once per team on first interaction.
   */
  private ensureTeamCallbacks(
    teamId: string,
    manager: AgentManager,
  ): void {
    if (this.attachedTeams.has(teamId)) return;
    this.attachedTeams.add(teamId);

    const room = `team:${teamId}`;
    const streamedTasks = new Set<string>();

    /** Resolve goal room for goal-scoped events, fall back to team room */
    const goalRoom = (goalId?: string | null): string =>
      goalId ? `team:${teamId}:goal:${goalId}` : room;

    /** Get goalId from a taskId via TaskStore */
    const taskGoalId = (taskId?: string): string | undefined => {
      if (!taskId) return undefined;
      return manager.getTaskStore()?.get(taskId)?.goalId;
    };

    /**
     * Accumulate complete stream parts per message for persistence.
     * On finish, save the full message (text + tool calls + reasoning) to chat service.
     * This follows the AI SDK pattern: save the complete UIMessage, not piecemeal text.
     */
    const messageAccumulator = new Map<string, {
      agentId: string;
      text: string;
      parts: Array<{ type: string; [key: string]: any }>;
    }>();

    manager.registerStreamCallbacks({
      onStream: async ({ taskId, agentId, part, goalId: streamGoalId }) => {
        if (taskId) streamedTasks.add(taskId);

        const accKey = taskId || agentId || "unknown";
        const acc = messageAccumulator.get(accKey) || { agentId: agentId || "worker", text: "", parts: [] };

        // Accumulate by part type
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
          case "reasoning-delta":
            // Append reasoning text (accumulated separately in parts)
            const lastReasoning = acc.parts.findLast((p: any) => p.type === "reasoning");
            if (lastReasoning) {
              lastReasoning.text = (lastReasoning.text || "") + (part.delta || "");
            } else {
              acc.parts.push({ type: "reasoning", id: part.id, text: part.delta || "" });
            }
            break;
        }

        messageAccumulator.set(accKey, acc);

        // On stream finish: persist complete message
        if (part?.type === "finish" && this.services) {
          if (acc.text.trim() || acc.parts.length > 0) {
            // Get full ModelMessage[] context for persistence (tool calls/results included)
            const contextMessages = taskId
              ? manager.getWorkerContext(taskId)
              : null; // Planner context saved separately

            const msgPayload = {
              teamId,
              userId: await this.services.teamRegistry?.getOwner(teamId) ?? "system",
              role: "assistant" as const,
              agentId: acc.agentId || "unknown",
              taskId: taskId || undefined,
              goalId: streamGoalId || undefined,
              content: acc.text || " ",
              streamParts: (acc.text.trim() || acc.parts.length > 0) ? JSON.stringify(toRenderedParts(acc.text, acc.parts)) : undefined,
              agentLayer: (acc.agentId === "planner" || acc.agentId === "manager" || acc.agentId === "orchestrator") ? "planner" as const : "worker" as const,
              contextMessages: contextMessages || undefined,
              timestamp: new Date().toISOString(),
            };

            try {
              await this.services.chat.addMessage(msgPayload);
            } catch (err) {
              logger.warn({ err, taskId, agentId: acc.agentId }, "[SocketServerV2] Failed to save message — retrying once");
              // Single retry after 500ms
              setTimeout(() => {
                this.services?.chat.addMessage(msgPayload).catch(() => {});
              }, 500);
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
        // Emit to goal room (goal-scoped) or team room (fallback)
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
            content: this.formatProgressContent(event),
            tool: event.tool,
            timestamp: Date.now(),
          } satisfies ProgressResponse);
        }

        if (routes.includes("stream")) {
          const streamPart = this.toStreamPart(eventType, event, taskId);
          if (streamPart) {
            const payload: StreamPayload = {
              sessionId: "default",
              taskId,
              agentId,
              part: streamPart,
              timestamp: Date.now(),
            };
            this.io.to(goalRoom(taskGoalId(taskId))).emit("stream", payload);
          }
        }
      },

      onDone: ({ taskId, role }) => {
        if (taskId && streamedTasks.has(taskId)) {
          streamedTasks.delete(taskId);
          return; // stream finish part already sent
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
        } satisfies ErrorResponse);
      },

      onTaskUpdate: ({ taskId, status, role }) => {
        const gid = taskGoalId(taskId);
        const target = goalRoom(gid);
        const stateResponse = this.buildStateResponse(manager, undefined, gid);
        this.io.to(target).emit("state", stateResponse);
        logger.debug(
          `[SocketServerV2] Task ${taskId} → ${status}, broadcast to ${target}`,
        );

        if (status === "in_progress") {
          const payload: StreamPayload = {
            sessionId: "default",
            taskId,
            agentId: role || "worker",
            part: { type: "task-started", taskId, role: role || "worker" },
            timestamp: Date.now(),
          };
          this.io.to(target).emit("stream", payload);
        } else if (status === "completed") {
          const payload: StreamPayload = {
            sessionId: "default",
            taskId,
            agentId: role || "worker",
            part: { type: "task-completed", taskId, role: role || "worker" },
            timestamp: Date.now(),
          };
          this.io.to(target).emit("stream", payload);
        } else if (status === "failed") {
          const payload: StreamPayload = {
            sessionId: "default",
            taskId,
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
        const stateResponse = this.buildStateResponse(manager, undefined, gid);
        stateResponse.sessionState = "executing";
        logger.info(`[SocketServerV2] onPlanUpdate: action=${action}, goalId=${gid}, target=${target}, tasks=${stateResponse.plan?.length ?? 0}`);
        this.io.to(target).emit("state", stateResponse);
        // Also emit to team room for sidebar plan list updates
        if (target !== room) {
          this.io.to(room).emit("state", { sessionId: "default", sessionState: "executing", goalId: gid, timestamp: Date.now() } as StateResponse);
        }
        logger.debug(`[SocketServerV2] Plan ${action} for goal ${gid}, broadcast to ${target}`);

        // Phase 4.5: When plan is approved, auto-join the submitting socket to the goal room.
        // Other clients join explicitly via subscribeToGoal when they switch to this plan.
        // NOTE: We can't identify the submitting socket here (onPlanUpdate is a broadcast callback).
        // Instead, the client auto-subscribes via the goal:created event handler.
        // No socketsJoin needed — goal:created already triggers subscribeToGoal on the client.

        // Save goal to database when plan is approved (for cross-browser restore)
        if (action === "approved" && this.services && gid) {
          this.services.chat.getGoalMessages(teamId, gid!, { limit: 5 }).then(msgs => {
            const userMsg = msgs.find(m => m.role === "user");
            const goalText = userMsg?.content || "Plan";
            const ownerId = userMsg?.userId || "system";
            this.services!.goals.addGoal({
              teamId,
              userId: ownerId,
              goal: goalText,
              goalId: gid || undefined,
              status: "executing",
            }).catch(err => logger.warn("[SocketServerV2] Failed to save goal:", err));
          }).catch(() => {});
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
        logger.info(`[SocketServerV2] onPlanProposed fired, goalId=${(_data as any)?.goalId}`);
      },

      // Channel B: broadcast task updates to goal room
      onWorkerTaskUpdate: (update) => {
        this.io.to(goalRoom(taskGoalId(update.taskId))).emit("task_update", {
          ...update,
          teamId,
        });
      },

      // Goal lifecycle: update goal status in database when plan completes/fails
      onGoalStatusChange: ({ teamId: tid, goalId: completedGoalId, status }) => {
        if (!this.services) return;
        if (completedGoalId) {
          this.services.goals.updateGoal(completedGoalId, { status })
            .then(() => logger.info(`[SocketServerV2] Goal ${completedGoalId} → ${status}`))
            .catch(err => logger.warn("[SocketServerV2] Failed to update goal status:", err));
        } else {
          logger.error(`[SocketServerV2] onGoalStatusChange received without goalId — cannot update DB`);
        }

        // Emit goal:stateChange to frontend with the exact goalId
        const allGoals = manager.getAllGoalSummaries?.() ?? [];
        this.io.to(room).emit("goal:stateChange", {
          teamId: tid,
          goalId: completedGoalId,
          state: status,
          allGoals,
        });
      },
    });

    // Wire discussion event emission from CollabServer → Socket.IO
    this.wireDiscussionEvents(teamId, manager, room);

    logger.info(`[SocketServerV2] Callbacks registered for team ${teamId}`);
  }

  /** Join socket to team's broadcast room — checks team access */
  private async joinTeamRoom(socket: Socket, teamId: string): Promise<boolean> {
    // Check team access if registry is available
    if (this.services) {
      const userId = socket.data.userId;
      if (userId) {
        const canAccess = await this.services.teamRegistry.canAccess(userId, teamId);
        if (!canAccess) {
          this.emitError(socket, { error: "Not authorized to access this team" });
          return false;
        }
      }
    }
    socket.join(`team:${teamId}`);

    // Phase 4 v1.1: Emit current goal summaries to newly connected client
    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);
      const allGoals = manager.getAllGoalSummaries?.() ?? [];
      if (allGoals.length > 0) {
        socket.emit("goal:stateChange", {
          teamId,
          goalId: undefined, // no implicit current goal — client picks from allGoals
          state: "connected",
          allGoals,
        });
      }
    } catch { /* best effort — manager may not exist yet */ }

    return true;
  }

  /**
   * Wire CollabServer discussion onChange → Socket.IO discussion events.
   * Emits `discussion:activity` and `discussion:mention` to team room.
   */
  private wireDiscussionEvents(teamId: string, manager: AgentManager, room: string): void {
    try {
      const plugin = manager.getPluginRegistry().get("collaboration") as any;
      const collabServer = plugin?.l2Plugin?.collabServer ?? plugin?.collabServer;
      if (!collabServer?.onDiscussionChange) {
        logger.info(`[SocketServerV2] No CollabServer for team ${teamId} — discussion events will not work. Ensure collaboration plugin is loaded.`);
        return;
      }

      collabServer.onDiscussionChange((event: {
        teamId: string; goalId: string; taskId: string;
        docName: string; blockCount: number; mentions: string[];
      }) => {
        // Broadcast activity to all team subscribers
        this.io.to(room).emit("discussion:activity", {
          teamId: event.teamId,
          goalId: event.goalId,
          taskId: event.taskId,
          docName: event.docName,
          blockCount: event.blockCount,
          timestamp: Date.now(),
        });

        // Emit targeted mention events
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

      logger.info(`[SocketServerV2] Discussion events wired for team ${teamId}`);
    } catch (err) {
      logger.warn(`[SocketServerV2] Failed to wire discussion events for team ${teamId}: ${err}`);
    }
  }

  // ============================================================================
  // Plan Building Helpers
  // ============================================================================

  /**
   * Convert any task format to PlanTask for frontend
   * Handles both MemoryManager tasks (assigned_role, prerequisites Map)
   * and pending plan tasks (assignedRole, dependencies array)
   */
  private toPlanTask(task: any): PlanTask {
    // Handle dependencies: prerequisites Map (MemoryManager) or dependencies array (pending)
    let dependencies: string[] = [];
    if (task.prerequisites instanceof Map) {
      dependencies = Array.from(task.prerequisites.keys());
    } else if (Array.isArray(task.dependencies)) {
      dependencies = task.dependencies;
    }

    return {
      id: task.id,
      title: task.title || task.description,
      description: task.description,
      assignedRole: task.assignedRole || task.assigned_role,
      status: task.status || "pending",
      priority: task.priority || 0,
      dependencies,
      goalId: task.goalId || undefined,
    };
  }

  /**
   * Build plan array from TaskStore tasks.
   * Returns ALL tasks — frontend filters by goalId.
   */
  private buildPlanFromTasks(manager: AgentManager): PlanTask[] {
    const taskStore = manager.getTaskStore();
    const allTasks = taskStore?.getAllTasks() || [];
    return allTasks.map((t) => this.toPlanTask(t));
  }

  /**
   * Build plan array scoped to a specific goal.
   */
  private buildPlanForGoal(manager: AgentManager, goalId: string): PlanTask[] {
    const taskStore = manager.getTaskStore();
    const goalTasks = taskStore?.getByGoal(goalId) || [];
    return goalTasks.map((t) => this.toPlanTask(t));
  }

  /**
   * Build plan array from pending plan
   */
  private buildPlanFromPending(pendingPlan: any): PlanTask[] {
    return pendingPlan.tasks?.map((t: any) => this.toPlanTask(t)) || [];
  }

  /**
   * Derive session state from tasks
   */
  private deriveSessionState(plan: PlanTask[]): NonNullable<StateResponse["sessionState"]> {
    if (plan.length === 0) return "ready";
    const hasInProgress = plan.some((t) => t.status === "in_progress");
    const allCompleted = plan.every((t) => t.status === "completed");
    return allCompleted ? "completed" : hasInProgress ? "executing" : "ready";
  }

  /** Build state response from current manager state */
  private buildStateResponse(
    manager: AgentManager,
    sessionId?: string,
    goalId?: string,
  ): StateResponse {
    // Goal-scoped: only include tasks for the specific goal if provided
    const plan = goalId
      ? this.buildPlanForGoal(manager, goalId)
      : this.buildPlanFromTasks(manager);
    const sessionState = this.deriveSessionState(plan);

    const response: StateResponse = {
      sessionId: sessionId || "default",
      sessionState,
      timestamp: Date.now(),
      ...(goalId ? { goalId } : {}),
    };

    if (plan.length > 0) {
      response.plan = plan;
    }

    return response;
  }

  /** Format progress event for display */
  private formatProgressContent(event: any): string {
    switch (event.type) {
      case "thinking":
        return event.content || "Thinking...";
      case "tool_start":
        return `Using tool: ${event.tool || "unknown"}`;
      case "tool_result":
        return typeof event.result === "string"
          ? event.result.substring(0, 200)
          : "completed";
      default:
        return event.content || event.message || JSON.stringify(event);
    }
  }

  /**
   * Convert a worker event to an AI SDK stream part for the `stream` channel.
   * Returns null for event types that don't map to a stream part.
   */
  private toStreamPart(eventType: WorkerEventType, event: any, taskId: string): StreamPayload["part"] | null {
    switch (eventType) {
      case "message_delta":
        return { type: "text-delta", id: `${taskId}-txt`, delta: event.delta ?? "" };
      case "thinking":
        return { type: "reasoning-delta", id: `${taskId}-reason`, delta: event.content ?? "" };
      case "tool_start":
        return { type: "tool-input-start", toolCallId: `${taskId}-${event.tool}`, toolName: event.tool ?? "unknown" };
      case "tool_result":
        return { type: "tool-output-available", toolCallId: `${taskId}-${event.tool}`, toolName: event.tool ?? "unknown", output: event.result ?? "" };
      case "artifact":
        return { type: "artifact-state", artifactId: event.artifactId ?? taskId, state: event.state ?? "ready" };
      case "frame":
        return null; // frame events have no stream-protocol equivalent yet
      case "hotspots":
        return null; // hotspot events have no stream-protocol equivalent yet
      default:
        return null;
    }
  }

  // ============================================================================
  // Message Handler (Bidirectional)
  // ============================================================================

  private async handleMessage(
    socket: Socket,
    connection: SocketConnection,
    data: MessagePayload,
  ) {
    // Validate input
    const parsed = MessagePayloadSchema.safeParse(data);
    if (!parsed.success) {
      this.emitError(socket, { error: `Invalid message: ${parsed.error.issues[0]?.message || "validation failed"}` });
      return;
    }
    const { teamId, agentId, taskId, sessionId, content, goalId: clientGoalId, nonce, repoUrl, repoBranch } = parsed.data;

    // Rate limit — prevent LLM API cost abuse
    if (!this.rateLimiter.allow(connection.userId)) {
      this.emitError(socket, { error: "Rate limit exceeded. Please wait before sending more messages." });
      return;
    }

    logger.info(`[SocketServerV2] handleMessage called:`, {
      teamId,
      agentId,
      taskId,
      sessionId,
      contentPreview: content?.substring(0, 50),
    });

    // Persist user message via ServiceRegistry
    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);

      // Save user message with goalId — use client-provided goalId (required)
      // For orchestrator messages, defer save until after goalId is resolved (Step 1: server-goalid)
      const isOrchestratorMsg = agentId === "manager" || agentId === "orchestrator";
      if (this.services && !isOrchestratorMsg) {
        const layer = agentId.startsWith("chat-") ? "chat-agent" as const : "worker" as const;

        this.services.chat.addMessage({
          teamId,
          userId: connection.userId,
          role: "user",
          agentId,
          taskId: taskId || undefined,
          goalId: clientGoalId || undefined,
          content,
          agentLayer: layer,
          timestamp: new Date().toISOString(),
        }).catch((err) => logger.warn("[SocketServerV2] Failed to save user message:", err));
      }

      // Join team room (checks access) and ensure event broadcasting is set up
      const joined = await this.joinTeamRoom(socket, teamId);
      if (!joined) return;
      this.ensureTeamCallbacks(teamId, manager);

      // "manager" is the planning agent (maps to orchestrator internally)
      if (agentId === "manager" || agentId === "orchestrator") {
        await this.handleOrchestratorMessage(
          socket,
          manager,
          teamId,
          sessionId,
          content,
          clientGoalId,
          nonce,
          repoUrl,
          repoBranch,
        );
      } else if (agentId.startsWith("chat-") && manager.isChatAgentEnabled()) {
        // Chat Agent message — route to the role's persistent L2 agent
        const role = agentId.replace("chat-", "");
        await this.handleChatAgentMessage(socket, manager, teamId, role, sessionId, content, clientGoalId || undefined);
      } else {
        await this.handleWorkerMessage(
          socket,
          manager,
          agentId,
          taskId,
          content,
        );
      }
    } catch (error: any) {
      logger.error("[SocketServerV2] Message error:", error);
      this.emitError(socket, {
        error: error.message || String(error),
        sessionId,
        taskId,
      });
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
  ) {
    // repoUrl is stored on GoalContext → injected into tasks → used by WorkspacePlugin
    logger.info(`[SocketServerV2] handleOrchestratorMessage: repoUrl=${repoUrl || 'NONE'}, repoBranch=${repoBranch || 'NONE'}, goalId=${goalId || 'NONE'}`);

    // Wire auth token resolver so workspace push uses the user's GitHub OAuth token
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

    // v2.5: Generate goalId in SocketServerV2 BEFORE planner starts.
    // This allows us to join the goal room before any broadcast can happen.
    const resolvedGoalId = goalId || randomUUID();

    // Auto-join socket to goal room BEFORE calling orchestratorMessage (which starts planner).
    // Eliminates the race between planner finishing and client subscribing.
    const prevGoalRoom = socket.data.currentGoalRoom as string | undefined;
    if (prevGoalRoom) socket.leave(prevGoalRoom);
    const goalRoomName = `team:${teamId}:goal:${resolvedGoalId}`;
    socket.join(goalRoomName);
    socket.data.currentGoalRoom = goalRoomName;

    // Now call orchestratorMessage with pre-generated goalId
    const result = await manager.orchestratorMessage(content, resolvedGoalId, repoUrl, repoBranch);

    // Save user message with the server-resolved goalId (deferred from handleMessage)
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
      }).catch((err) => logger.warn("[SocketServerV2] Failed to save user message:", err));
    }

    logger.info(`[SocketServerV2] Orchestrator message processed (goalId=${resolvedGoalId})`);

    // Only emit goal:created when client didn't send a goalId (= new goal from GoalScreen).
    // Follow-up messages from ChatArea always include goalId, so no event needed.
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
      // Check if tasks exist for this goal (plan was approved)
      const goalTasks = this.buildPlanForGoal(manager, resolvedGoalId);

      if (goalTasks.length > 0) {
        const stateResponse = this.buildStateResponse(manager, sessionId, resolvedGoalId);
        stateResponse.plan = goalTasks;
        socket.emit("state", stateResponse);
        logger.info(
          `[SocketServerV2] Sent ${goalTasks.length} tasks for goal ${resolvedGoalId}`,
        );
      }
    }
  }

  /**
   * Handle a user message to a persistent Chat Agent (L2).
   * Streams the response using the same stream channel as workers.
   * Accumulates response parts for proper persistence (text + tool calls + reasoning).
   */
  private async handleChatAgentMessage(
    socket: Socket,
    manager: AgentManager,
    teamId: string,
    role: string,
    sessionId: string | undefined,
    content: string,
    goalId?: string,
  ) {
    if (!goalId) {
      logger.error(`[SocketServerV2] ChatAgent for role '${role}' rejected — goalId is required`);
      socket.emit("stream", {
        teamId,
        agentId: `chat-${role}`,
        sessionId: sessionId || "default",
        part: { type: "error", error: "goalId is required for chat-agent messages" },
      });
      return;
    }
    const resolvedGoalId = goalId; // strict — no getCurrentGoalId() fallback
    logger.info(`[SocketServerV2] ChatAgent message for role '${role}' goalId=${resolvedGoalId}`);

    try {
      const agentId = `chat-${role}`;
      const stream = manager.chatAgentMessage(role, content, resolvedGoalId);

      // Accumulate response for persistence (same pattern as worker streams)
      const acc = { text: "", parts: [] as Array<{ type: string; [key: string]: any }> };

      // Stream events to the same 'stream' channel — frontend handles them identically
      for await (const event of stream) {
        if (event.type === "stream_part") {
          socket.emit("stream", {
            teamId,
            agentId,
            sessionId: sessionId || "default",
            part: event.part,
            goalId: resolvedGoalId,
          });

          // Accumulate by part type (mirror of worker accumulator in ensureTeamCallbacks)
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

          // Persist on finish — save actual accumulated content + full context
          if (event.part?.type === "finish" && this.services) {
            if (acc.text.trim() || acc.parts.length > 0) {
              // Get full ModelMessage[] context (with tool calls/results)
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
              }).catch(err => logger.warn("[SocketServerV2] Failed to save chat agent message:", err));
            }
          }
        }
      }
    } catch (err: any) {
      logger.error(`[SocketServerV2] ChatAgent error for role '${role}':`, err);
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
  ) {
    let actualTaskId: string;

    if (!taskId) {
      // Ad-hoc worker chat: Start new conversation without a planned task
      // Uses legacy startTask() which creates a task on-the-fly
      // For planned tasks, use action: start-task first to get taskId
      const result = await manager.startTask(agentId, content);
      actualTaskId = result.taskId;
      // Note: Response is broadcast via worker:done event listener
    } else {
      // Continue existing task conversation
      actualTaskId = taskId;
      await manager.continueTask(taskId, content);
      // Note: Response is broadcast via worker:done event listener
    }

    // Return taskId for tracking (useful for frontend to continue conversation)
    // The actual response message is emitted via worker:done event listener
    // to avoid duplicate messages
    logger.debug(`[SocketServerV2] Worker message processed: ${actualTaskId}`);
  }

  // ============================================================================
  // Action Handler
  // ============================================================================

  private async handleAction(
    socket: Socket,
    connection: SocketConnection,
    data: ActionPayload,
  ) {
    // Validate input
    const parsed = ActionPayloadSchema.safeParse(data);
    if (!parsed.success) {
      this.emitError(socket, { error: `Invalid action: ${parsed.error.issues[0]?.message || "validation failed"}` });
      return;
    }
    const { teamId, type, sessionId, taskId, goalId: actionGoalId, output, changes } = parsed.data;

    // Rate limit actions that trigger LLM calls
    if (type !== "get-state" && !this.rateLimiter.allow(connection.userId)) {
      this.emitError(socket, { error: "Rate limit exceeded. Please wait." });
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
          // TODO: Implement task modification
          this.emitError(socket, { error: "modify-task not yet implemented" });
          break;

        case "auto-execute":
          this.handleAutoExecute(socket, manager, data.enabled, actionGoalId);
          break;

        case "get-state":
          await this.handleGetState(socket, manager, teamId, sessionId, actionGoalId);
          break;

        default:
          this.emitError(socket, { error: `Unknown action type: ${type}` });
      }
    } catch (error: any) {
      logger.error(`[SocketServerV2] Action ${type} error:`, error);
      this.emitError(socket, {
        error: error.message || String(error),
        sessionId,
        taskId,
      });
    }
  }

  private async handleApprovePlan(
    socket: Socket,
    manager: AgentManager,
    sessionId: string | undefined,
    goalId?: string,
  ) {
    if (!goalId) {
      this.emitError(socket, { error: "goalId is required for approve-plan" });
      return;
    }
    const result = await manager.approveOrchestratorPlan(goalId);

    if (result.success) {
      const gid = goalId;
      const stateResponse = this.buildStateResponse(manager, sessionId, gid);
      stateResponse.sessionState = "executing";
      socket.emit("state", stateResponse);
      logger.info(
        `[SocketServerV2] Plan approved for goal ${gid}, ${result.tasksQueued} tasks queued`,
      );
    } else {
      this.emitError(socket, {
        error: result.error || "Plan approval failed",
        sessionId,
      });
    }
  }

  private async handleStartTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    goalId?: string,
  ) {
    if (!taskId) {
      this.emitError(socket, { error: "taskId is required for start-task" });
      return;
    }

    // If there's a pending plan, approve it first to add tasks to TaskStore
    const pendingPlan = manager.getOrchestratorPendingPlan(goalId);
    if (pendingPlan) {
      logger.info(
        `[SocketServerV2] Auto-approving pending plan before starting task ${taskId}`,
      );
      const approvalResult = await manager.approveOrchestratorPlan(goalId);
      if (!approvalResult.success) {
        this.emitError(socket, {
          error: approvalResult.error || "Failed to approve plan",
        });
        return;
      }
    }

    try {
      // Use manualDispatch which routes through OrchestratorService → WorkerPool
      await manager.manualDispatchTask(taskId);
      logger.info(`[SocketServerV2] Task ${taskId} manually dispatched`);
    } catch (err: any) {
      this.emitError(socket, { error: err.message || "Failed to start task" });
    }
  }

  private async handleCompleteTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    output?: any,
    goalId?: string,
  ) {
    if (!taskId) {
      this.emitError(socket, { error: "taskId is required for complete-task" });
      return;
    }

    // Get task info before completing (for role)
    const taskStore = manager.getTaskStore();
    const task = taskStore?.getTask(taskId);
    const agentRole = task?.assigned_role || "unknown";

    // Complete task in TaskStore
    if (taskStore) {
      try {
        taskStore.completeTask(taskId, output || { completedBy: "user" });
      } catch (err) {
        logger.warn(`[SocketServerV2] Failed to complete task ${taskId} in TaskStore:`, err);
      }
    }

    // Broadcast updated state (goal-scoped — prefer task goalId)
    if (!goalId && !(task as any)?.goalId) logger.warn(`[SocketServerV2] handleCompleteTask: task ${taskId} has no goalId`);
    const gid = goalId || (task as any)?.goalId || undefined; // strict — no getCurrentGoalId() fallback
    socket.emit("state", this.buildStateResponse(manager, undefined, gid));

    // Emit output if provided
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

    logger.info(`[SocketServerV2] Task ${taskId} completed`);
  }

  /**
   * Handle auto-execute action
   * - If enabled is provided: set the value
   * - If enabled is undefined: just return current state
   */
  private handleAutoExecute(
    socket: Socket,
    manager: AgentManager,
    enabled?: boolean,
    goalId?: string,
  ) {
    // Set if value provided
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
      logger.info(`[SocketServerV2] AutoExecute set to ${enabled}`);
    }

    // Return full state with autoExecute flag (goal-scoped via explicit goalId)
    const current = manager.getAutoExecute();
    const gid = goalId || undefined; // strict — no getCurrentGoalId() fallback
    const stateResponse = this.buildStateResponse(manager, undefined, gid);
    (stateResponse as any).autoExecute = current;
    socket.emit("state", stateResponse);
  }

  /**
   * Handle get-state action - sends current tasks/plan state to frontend
   * Called on page refresh/reconnect to restore UI state
   */
  private async handleGetState(
    socket: Socket,
    manager: AgentManager,
    teamId: string,
    sessionId: string | undefined,
    goalId?: string,
  ) {
    // Join team room (checks access) and ensure event broadcasting
    const joined = await this.joinTeamRoom(socket, teamId);
    if (!joined) return;
    this.ensureTeamCallbacks(teamId, manager);

    const pendingPlan = manager.getOrchestratorPendingPlan(goalId);
    const autoExecute = manager.getAutoExecute();

    // If there's a pending plan awaiting approval, send that (goal-scoped)
    if (pendingPlan) {
      const plan = this.buildPlanFromPending(pendingPlan);
      const gidPending = goalId || undefined; // strict — no getCurrentGoalId() fallback
      const stateResponse: StateResponse = {
        sessionId: sessionId || "default",
        sessionState: "awaiting_approval",
        plan,
        autoExecute,
        goalId: gidPending,
        timestamp: Date.now(),
      };
      socket.emit("state", stateResponse);
      logger.info(
        `[SocketServerV2] State sent: awaiting_approval, ${plan.length} pending tasks`,
      );
      return;
    }

    // Otherwise, build from current tasks (goal-scoped via explicit goalId)
    const gid = goalId || undefined; // strict — no getCurrentGoalId() fallback
    const stateResponse = this.buildStateResponse(manager, sessionId, gid);
    (stateResponse as any).autoExecute = autoExecute;
    socket.emit("state", stateResponse);
    logger.info(
      `[SocketServerV2] State sent: ${stateResponse.sessionState}, ${stateResponse.plan?.length || 0} tasks`,
    );
  }

  private async handleCancelTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    goalId?: string,
  ) {
    if (!taskId) {
      this.emitError(socket, { error: "taskId is required for cancel-task" });
      return;
    }

    // TODO: Add cancelTask method to AgentManager
    logger.warn(
      `[SocketServerV2] Task ${taskId} cancel requested (not yet implemented)`,
    );

    const cancelTask = manager.getTaskStore()?.getTask(taskId);
    if (!goalId && !cancelTask?.goalId) logger.warn(`[SocketServerV2] handleCancelTask: task ${taskId} has no goalId`);
    const stateResponse: StateResponse = {
      sessionId: "default",
      tasks: [{ id: taskId, status: "cancelled" }],
      goalId: goalId || cancelTask?.goalId || undefined, // strict — no getCurrentGoalId() fallback
      timestamp: Date.now(),
    };
    socket.emit("state", stateResponse);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private handleDisconnect(connection: SocketConnection) {
    logger.info(`[SocketServerV2] ${connection.userId} disconnected`);
    // Socket.IO automatically removes socket from all rooms on disconnect
    socketConnectionManager.removeConnection(connection.connectionId);
  }

  private emitError(socket: Socket, data: Partial<ErrorResponse>) {
    const response: ErrorResponse = {
      ...data,
      error: data.error || "Unknown error",
      timestamp: Date.now(),
    };
    socket.emit("error", response);
  }

  close() {
    logger.info("[SocketServerV2] Closing all connections");
    this.io.close();
  }
}
