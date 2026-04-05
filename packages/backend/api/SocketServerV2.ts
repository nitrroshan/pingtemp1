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
import { Logger } from "tslog";
import { randomUUID } from "crypto";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import {
  socketConnectionManager,
  type SocketConnection,
} from "./SocketConnectionManager.js";
import { userManager } from "./UserManager.js";
import type { AgentManager } from "../agentManager/AgentManagerV2.js";
import type { StreamPayload } from "./types/streamTypes.js";

const logger = new Logger({ name: "SocketServerV2" });

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
// SocketServerV2
// ============================================================================

export class SocketServerV2 {
  private io: SocketIOServer;

  /** Track teams that have event listeners attached */
  private attachedTeams = new Set<string>();

  constructor(httpServer: any) {
    // Initialize Socket.IO
    this.io = new SocketIOServer(httpServer, {
      path: "/socket.io/v2", // V2 path to coexist with V1
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupSocketIO();
  }

  private setupSocketIO() {
    logger.info("[SocketServerV2] Initialized on /socket.io/v2");
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

  private handleRegister(socket: Socket, data: { userId: string }) {
    const { userId } = data;

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
   * Attach event listeners to broadcast manager events to Socket.IO room.
   * Called once per team on first interaction.
   */
  private ensureTeamEventsBroadcast(
    teamId: string,
    manager: AgentManager,
  ): void {
    if (this.attachedTeams.has(teamId)) return;
    this.attachedTeams.add(teamId);

    const room = `team:${teamId}`;

    // Route worker events to appropriate socket channels via WORKER_EVENT_ROUTES
    manager.events.on("worker:event", ({ taskId, event }) => {
      const eventType = event.type as WorkerEventType;
      const routes = WORKER_EVENT_ROUTES[eventType];

      if (!routes) return; // Unknown event type — skip silently

      const agentId = event.role || "worker";

      if (routes.includes("progress")) {
        this.io.to(room).emit("progress", {
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
          this.io.to(room).emit("stream", payload);
        }
      }
    });

    // AI SDK stream parts forwarded directly from WorkerPool
    // Track which tasks have had stream parts sent (to skip duplicate worker:done message)
    const streamedTasks = new Set<string>();
    manager.events.on("worker:stream", ({ taskId, agentId, part }) => {
      if (taskId) streamedTasks.add(taskId);
      const payload: StreamPayload = {
        sessionId: "default",
        taskId,
        agentId: agentId || "worker",
        part,
        timestamp: Date.now(),
      };
      this.io.to(room).emit("stream", payload);
    });

    // Task lifecycle notifications on the `stream` channel
    manager.events.on("task:update", ({ taskId, status, role }) => {
      const stateResponse = this.buildStateResponse(manager);
      this.io.to(room).emit("state", stateResponse);
      logger.debug(
        `[SocketServerV2] Task ${taskId} → ${status}, broadcast to ${room}`,
      );

      // Also emit notification on stream channel
      if (status === "in_progress") {
        const payload: StreamPayload = {
          sessionId: "default",
          taskId,
          agentId: role || "worker",
          part: { type: "task-started", taskId, role: role || "worker" },
          timestamp: Date.now(),
        };
        this.io.to(room).emit("stream", payload);
      } else if (status === "completed") {
        const payload: StreamPayload = {
          sessionId: "default",
          taskId,
          agentId: role || "worker",
          part: { type: "task-completed", taskId, role: role || "worker" },
          timestamp: Date.now(),
        };
        this.io.to(room).emit("stream", payload);
      } else if (status === "failed") {
        const payload: StreamPayload = {
          sessionId: "default",
          taskId,
          agentId: role || "worker",
          part: { type: "task-failed", taskId, role: role || "worker", error: "Task failed" },
          timestamp: Date.now(),
        };
        this.io.to(room).emit("stream", payload);
      }
    });

    // Plan Update: Broadcast state when plan is approved or modified
    manager.events.on("plan:update", ({ action }) => {
      const stateResponse = this.buildStateResponse(manager);
      this.io.to(room).emit("state", stateResponse);
      logger.debug(`[SocketServerV2] Plan ${action}, broadcast to ${room}`);

      // Emit plan notifications on stream channel
      const payload: StreamPayload = {
        sessionId: "default",
        agentId: "orchestrator",
        part: action === "approved"
          ? { type: "plan-approved", planId: "current" }
          : { type: "plan-proposed", planId: "current", taskCount: 0 },
        timestamp: Date.now(),
      };
      this.io.to(room).emit("stream", payload);
    });

    // Worker done: stream_parts deliver all content, so worker:done
    // only needs to clean up tracking and emit a finish signal if
    // the stream didn't already send one.
    manager.events.on("worker:done", ({ taskId, role }) => {
      if (taskId && streamedTasks.has(taskId)) {
        streamedTasks.delete(taskId);
        return; // stream finish part already sent
      }
      // No stream_parts were sent (shouldn't happen, but safety net)
      this.io.to(room).emit("stream", {
        sessionId: "default",
        agentId: role,
        taskId,
        part: { type: "finish", finishReason: "stop" },
        timestamp: Date.now(),
      } as StreamPayload);
    });

    // Error: Task failure notification
    manager.events.on("worker:error", ({ taskId, error }) => {
      this.io.to(room).emit("error", {
        taskId,
        error,
        timestamp: Date.now(),
      } satisfies ErrorResponse);
    });

    logger.info(`[SocketServerV2] Event listeners attached for team ${teamId}`);
  }

  /** Join socket to team's broadcast room */
  private joinTeamRoom(socket: Socket, teamId: string): void {
    socket.join(`team:${teamId}`);
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
    };
  }

  /**
   * Build plan array from MemoryManager tasks
   */
  private buildPlanFromTasks(manager: AgentManager): PlanTask[] {
    const memoryManager = manager.getMemoryManager();
    const allTasks = memoryManager?.getAllTasks() || [];
    return allTasks.map((t) => this.toPlanTask(t));
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
  ): StateResponse {
    const plan = this.buildPlanFromTasks(manager);
    const sessionState = this.deriveSessionState(plan);

    const response: StateResponse = {
      sessionId: sessionId || "default",
      sessionState,
      timestamp: Date.now(),
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
    const { teamId, agentId, taskId, sessionId, content } = data;

    logger.info(`[SocketServerV2] handleMessage called:`, {
      teamId,
      agentId,
      taskId,
      sessionId,
      contentPreview: content?.substring(0, 50),
    });

    if (!teamId || !agentId || !content) {
      this.emitError(socket, {
        error: "teamId, agentId, and content are required",
        sessionId,
      });
      return;
    }

    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);

      // Join team room and ensure event broadcasting is set up
      this.joinTeamRoom(socket, teamId);
      this.ensureTeamEventsBroadcast(teamId, manager);

      // "manager" is the planning agent (maps to orchestrator internally)
      if (agentId === "manager" || agentId === "orchestrator") {
        await this.handleOrchestratorMessage(
          socket,
          manager,
          sessionId,
          content,
        );
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
    sessionId: string | undefined,
    content: string,
  ) {
    // Send message to orchestrator
    const response = await manager.orchestratorMessage(content);
    const state = manager.getOrchestratorState();
    const pendingPlan = manager.getOrchestratorPendingPlan();

    // Orchestrator response is delivered via stream parts (worker:stream events).
    // Only emit a 'message' if the response is non-empty AND no stream parts were sent
    // (e.g., structured mode with no streaming). The stream finish part already
    // finalizes the frontend message, so emitting 'message' here would duplicate it.
    // For now, always skip — stream parts are the sole delivery path.
    logger.info(`[SocketServerV2] Orchestrator responded (${response?.length ?? 0} chars)`);

    // If plan was proposed, emit state with pending plan
    if (pendingPlan) {
      const stateResponse: StateResponse = {
        sessionId: sessionId || "default",
        sessionState: "awaiting_approval",
        plan: pendingPlan.tasks,
        timestamp: Date.now(),
      };
      socket.emit("state", stateResponse);
    } else {
      // Check if tasks exist in MemoryManager (plan was approved via chat)
      const memoryManager = manager.getMemoryManager();
      const allTasks = memoryManager?.getAllTasks() || [];

      if (allTasks.length > 0) {
        socket.emit("state", this.buildStateResponse(manager, sessionId));
        logger.info(
          `[SocketServerV2] Orchestrator message processed, sent ${allTasks.length} tasks`,
        );
      }
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
    const { teamId, type, sessionId, taskId, output, changes } = data;

    if (!teamId || !type) {
      this.emitError(socket, { error: "teamId and type are required" });
      return;
    }

    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);

      switch (type) {
        case "approve-plan":
          await this.handleApprovePlan(socket, manager, sessionId);
          break;

        case "start-task":
          await this.handleStartTask(socket, manager, taskId!);
          break;

        case "complete-task":
          await this.handleCompleteTask(socket, manager, taskId!, output);
          break;

        case "cancel-task":
          await this.handleCancelTask(socket, manager, taskId!);
          break;

        case "modify-task":
          // TODO: Implement task modification
          this.emitError(socket, { error: "modify-task not yet implemented" });
          break;

        case "auto-execute":
          this.handleAutoExecute(socket, manager, data.enabled);
          break;

        case "get-state":
          await this.handleGetState(socket, manager, teamId, sessionId);
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
  ) {
    const result = await manager.approveOrchestratorPlan();

    if (result.success) {
      const stateResponse = this.buildStateResponse(manager, sessionId);
      stateResponse.sessionState = "executing"; // Override: just approved, starting execution
      socket.emit("state", stateResponse);
      logger.info(
        `[SocketServerV2] Plan approved, ${result.tasksQueued} tasks queued`,
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
  ) {
    if (!taskId) {
      this.emitError(socket, { error: "taskId is required for start-task" });
      return;
    }

    // If there's a pending plan, approve it first to add tasks to MemoryManager
    const pendingPlan = manager.getOrchestratorPendingPlan();
    if (pendingPlan) {
      logger.info(
        `[SocketServerV2] Auto-approving pending plan before starting task ${taskId}`,
      );
      const approvalResult = await manager.approveOrchestratorPlan();
      if (!approvalResult.success) {
        this.emitError(socket, {
          error: approvalResult.error || "Failed to approve plan",
        });
        return;
      }
    }

    // First approve the task if not already approved
    const approval = manager.approveTaskForChat(taskId);

    // Then actually start execution
    // Note: The response message is broadcast via worker:done event listener
    // to avoid duplicate messages
    const result = await manager.startTaskExecution(taskId);

    const stateResponse: StateResponse = {
      sessionId: "default",
      tasks: [{ id: taskId, status: "in_progress", role: result.role }],
      timestamp: Date.now(),
    };
    socket.emit("state", stateResponse);

    // Don't emit message here - worker:done event will broadcast it
    // This prevents duplicate messages

    logger.info(`[SocketServerV2] Task ${taskId} started and executing`);
  }

  private async handleCompleteTask(
    socket: Socket,
    manager: AgentManager,
    taskId: string,
    output?: any,
  ) {
    if (!taskId) {
      this.emitError(socket, { error: "taskId is required for complete-task" });
      return;
    }

    // Get task info before completing (for role)
    const memoryManager = manager.getMemoryManager();
    const task = memoryManager?.getTask(taskId);
    const agentRole = task?.assigned_role || "unknown";

    await manager.completeTaskByUser(taskId, output);

    // Broadcast updated state
    socket.emit("state", this.buildStateResponse(manager));

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

    // Always return current state
    const current = manager.getAutoExecute();
    const stateResponse: StateResponse = {
      sessionId: "default",
      sessionState: current ? "executing" : "ready",
      timestamp: Date.now(),
    };
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
  ) {
    // Join team room and ensure event broadcasting
    this.joinTeamRoom(socket, teamId);
    this.ensureTeamEventsBroadcast(teamId, manager);

    const pendingPlan = manager.getOrchestratorPendingPlan();
    const autoExecute = manager.getAutoExecute();

    // If there's a pending plan awaiting approval, send that
    if (pendingPlan) {
      const plan = this.buildPlanFromPending(pendingPlan);
      const stateResponse: StateResponse = {
        sessionId: sessionId || "default",
        sessionState: "awaiting_approval",
        plan,
        autoExecute,
        timestamp: Date.now(),
      };
      socket.emit("state", stateResponse);
      logger.info(
        `[SocketServerV2] State sent: awaiting_approval, ${plan.length} pending tasks`,
      );
      return;
    }

    // Otherwise, build from current tasks
    const stateResponse = this.buildStateResponse(manager, sessionId);
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
  ) {
    if (!taskId) {
      this.emitError(socket, { error: "taskId is required for cancel-task" });
      return;
    }

    // TODO: Add cancelTask method to AgentManager
    logger.warn(
      `[SocketServerV2] Task ${taskId} cancel requested (not yet implemented)`,
    );

    const stateResponse: StateResponse = {
      sessionId: "default",
      tasks: [{ id: taskId, status: "cancelled" }],
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
