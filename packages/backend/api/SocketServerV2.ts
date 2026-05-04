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
 * v5.0 refactor: Delegates to extracted modules:
 *   - socket-types.ts: Shared types, schemas, helpers
 *   - SocketEventBroadcaster.ts: Manager → Socket.IO room broadcasts
 *   - SocketMessageHandler.ts: Bidirectional message routing
 *   - SocketActionHandler.ts: Client action routing
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
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import {
  socketConnectionManager,
  type SocketConnection,
} from "./SocketConnectionManager.js";
import { userManager } from "./UserManager.js";
import { getAuth } from "../auth/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./types/socketEvents.js";

// v5.0 extracted modules
import { TokenBucketLimiter, emitError } from "./socket-types.js";
import { SocketEventBroadcaster } from "./SocketEventBroadcaster.js";
import { SocketMessageHandler } from "./SocketMessageHandler.js";
import { SocketActionHandler } from "./SocketActionHandler.js";

const logger = rootLogger.child({ module: "SocketServerV2" });

// ============================================================================
// SocketServerV2 — Slim Orchestrator
// ============================================================================

export class SocketServerV2 {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private services: ServiceRegistry | null;
  private rateLimiter = new TokenBucketLimiter(5, 1);

  // v5.0 sub-modules
  private broadcaster: SocketEventBroadcaster;
  private messageHandler: SocketMessageHandler;
  private actionHandler: SocketActionHandler;

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
      path: "/socket.io/v2",
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Initialize sub-modules
    this.broadcaster = new SocketEventBroadcaster(this.io, this.services);
    this.messageHandler = new SocketMessageHandler(
      this.services,
      this.rateLimiter,
      this.broadcaster,
      this.joinTeamRoom.bind(this),
    );
    this.actionHandler = new SocketActionHandler(
      this.rateLimiter,
      this.broadcaster,
      this.joinTeamRoom.bind(this),
    );

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
      emitError(socket, { error: "userId is required" });
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

    // Wire handlers — delegate to sub-modules
    socket.on("message", (data) =>
      this.messageHandler.handleMessage(socket, connection, data),
    );
    socket.on("action", (data) =>
      this.actionHandler.handleAction(socket, connection, data),
    );
    socket.on("disconnect", () => this.handleDisconnect(connection));

    // Goal-scoped room subscription
    socket.on("subscribeToGoal", ({ teamId, goalId }: { teamId: string; goalId: string }) => {
      const prevGoalRoom = socket.data.currentGoalRoom as string | undefined;
      if (prevGoalRoom) socket.leave(prevGoalRoom);

      const goalRoom = `team:${teamId}:goal:${goalId}`;
      socket.join(goalRoom);
      socket.data.currentGoalRoom = goalRoom;
      logger.debug(`[SocketServerV2] Socket ${connectionId} joined goal room ${goalRoom}`);
    });

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
  // Team Room Management
  // ============================================================================

  /** Join socket to team's broadcast room — checks team access */
  private async joinTeamRoom(socket: Socket, teamId: string): Promise<boolean> {
    if (this.services) {
      const userId = socket.data.userId;
      if (userId) {
        const canAccess = await this.services.teamRegistry.canAccess(userId, teamId);
        if (!canAccess) {
          emitError(socket, { error: "Not authorized to access this team" });
          return false;
        }
      }
    }
    socket.join(`team:${teamId}`);

    // Emit current goal summaries to newly connected client
    try {
      const manager = await agentManagerRegistry.getForTeam(teamId);
      const allGoals = manager.getAllGoalSummaries?.() ?? [];
      if (allGoals.length > 0) {
        socket.emit("goal:stateChange", {
          teamId,
          goalId: undefined,
          state: "connected",
          allGoals,
        });
      }
    } catch { /* best effort — manager may not exist yet */ }

    return true;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  private handleDisconnect(connection: SocketConnection) {
    logger.info(`[SocketServerV2] ${connection.userId} disconnected`);
    socketConnectionManager.removeConnection(connection.connectionId);
  }

  close() {
    logger.info("[SocketServerV2] Closing all connections");
    this.io.close();
  }
}
