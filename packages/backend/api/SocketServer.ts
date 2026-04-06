/**
 * SocketServer - Socket.IO server for real-time communication
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import { Logger } from "tslog";
import { randomUUID } from "crypto";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import {
  socketConnectionManager,
  type SocketConnection,
} from "./SocketConnectionManager.js";
import { userManager } from "./UserManager.js";

const logger = new Logger({ name: "SocketServer" });

export class SocketServer {
  private io: SocketIOServer;
  private agentManager: AgentManager;

  constructor(httpServer: any, agentManager: AgentManager) {
    this.agentManager = agentManager;

    // Initialize Socket.IO on V1 path (legacy)
    this.io = new SocketIOServer(httpServer, {
      path: "/socket.io/v1",  // Explicit V1 path to avoid conflicts with V2
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.setupSocketIO();
  }

  /**
   * Setup Socket.IO connection handlers
   */
  private setupSocketIO() {
    logger.info("[SocketServer] Socket.IO server initialized");
    this.io.on("connection", this.handleConnection.bind(this));
  }

  /**
   * Handle new socket connection
   */
  private handleConnection(socket: Socket) {
    logger.info("[SocketServer] New socket connection attempt");

    socket.once("register", this.handleRegister.bind(this, socket));

    // Registration timeout
    setTimeout(() => this.handleRegistrationTimeout(socket), 5000);
  }

  /**
   * Handle user registration
   */
  private handleRegister(socket: Socket, data: { userId: string }) {
    const { userId } = data;

    if (!userId) {
      logger.error("[SocketServer] Registration failed: userId missing");
      socket.emit("error", {
        message: "userId is required for registration",
      });
      socket.disconnect();
      return;
    }

    const connectionId = randomUUID();
    const timestamp = Date.now();

    // Create or update user
    userManager.createOrUpdateUser(userId, timestamp);

    // Create socket connection
    const connection: SocketConnection = {
      connectionId,
      userId,
      socket,
      subscribedAgents: new Set(),
      connectedAt: timestamp,
    };
    socketConnectionManager.addConnection(connection);

    // Send registration confirmation
    socket.emit("registered", {
      clientId: connectionId, // Keep 'clientId' for backwards compatibility with frontend
      userId,
      timestamp,
    });

    // Mark socket as registered
    socket.data.registered = true;

    // Setup socket event handlers
    this.setupSocketHandlers(socket, connection);
  }

  /**
   * Handle registration timeout
   */
  private handleRegistrationTimeout(socket: Socket) {
    if (!socket.data.registered) {
      logger.warn(
        "[SocketServer] Client did not register within timeout, disconnecting",
      );
      socket.disconnect();
    }
  }

  /**
   * Setup handlers for individual socket
   */
  private setupSocketHandlers(socket: Socket, connection: SocketConnection) {
    socket.on(
      "agent:message",
      this.handleAgentMessage.bind(this, socket, connection),
    );
    socket.on(
      "orchestrator:message",
      this.handleOrchestratorMessage.bind(this, socket, connection),
    );
    socket.on(
      "plan:approve",
      this.handlePlanApprove.bind(this, socket, connection),
    );
    // Task lifecycle handlers (v2)
    socket.on(
      "task:approve",
      this.handleTaskApprove.bind(this, socket, connection),
    );
    socket.on(
      "task:complete",
      this.handleTaskComplete.bind(this, socket, connection),
    );
    socket.on("disconnect", this.handleDisconnect.bind(this, connection));

    // Forward orchestrator events to this socket
    this.setupOrchestratorEventForwarding(socket, connection);
  }

  /**
   * Setup forwarding of orchestrator events to connected client
   */
  private setupOrchestratorEventForwarding(
    socket: Socket,
    _connection: SocketConnection,
  ) {
    const forwardEvent = (eventName: string) => (data: any) => {
      socket.emit(eventName, {
        ...data,
        timestamp: Date.now(),
      });
    };

    // Forward plan lifecycle events via registerStreamCallbacks
    this.agentManager.registerStreamCallbacks({
      onPlanProposed: forwardEvent("plan:proposed"),
      onPlanUpdate: (data) => {
        if ((data as any).action === "approved") {
          forwardEvent("plan:approved")(data);
        }
      },
      onTaskUpdate: forwardEvent("task:update"),
      onError: forwardEvent("task:error"),
    });

    // Cleanup on disconnect
    socket.on("disconnect", () => {
      this.agentManager.registerStreamCallbacks({});
    });
  }

  /**
   * Handle orchestrator message (conversational planning mode)
   */
  private async handleOrchestratorMessage(
    socket: Socket,
    connection: SocketConnection,
    data: { content: string; teamId?: string; teamRoles?: string[] },
  ) {
    try {
      const { content, teamId, teamRoles } = data;

      // Initialize orchestrator if not already done
      if (!this.agentManager.getOrchestratorState()) {
        if (!teamId || !teamRoles?.length) {
          socket.emit("orchestrator:error", {
            error: "First message requires teamId and teamRoles",
            timestamp: Date.now(),
          });
          return;
        }
        await this.agentManager.initializeOrchestrator(teamId, teamRoles);
      }

      // Send message to orchestrator
      const response = await this.agentManager.orchestratorMessage(content);

      socket.emit("orchestrator:message", {
        content: response,
        state: this.agentManager.getOrchestratorState(),
        pendingPlan: this.agentManager.getOrchestratorPendingPlan(),
        timestamp: Date.now(),
      });
    } catch (error: any) {
      logger.error("[SocketServer] Orchestrator error:", error);
      socket.emit("orchestrator:error", {
        error: error.message || String(error),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle plan approval request
   */
  private async handlePlanApprove(
    socket: Socket,
    connection: SocketConnection,
    data?: { feedback?: string },
  ) {
    try {
      const result = await this.agentManager.approveOrchestratorPlan();

      if (result.success) {
        socket.emit("plan:approval:success", {
          tasksQueued: result.tasksQueued,
          timestamp: Date.now(),
        });
      } else {
        socket.emit("plan:approval:failed", {
          error: result.error,
          timestamp: Date.now(),
        });
      }
    } catch (error: any) {
      logger.error("[SocketServer] Plan approval error:", error);
      socket.emit("plan:approval:failed", {
        error: error.message || String(error),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle task approval request (v2 - enables user chat with task)
   */
  private async handleTaskApprove(
    socket: Socket,
    connection: SocketConnection,
    data: { taskId: string },
  ) {
    try {
      const { taskId } = data;
      if (!taskId) {
        socket.emit("task:error", {
          error: "taskId is required",
          timestamp: Date.now(),
        });
        return;
      }

      const result = this.agentManager.approveTaskForChat(taskId);

      socket.emit("task:approved", {
        taskId: result.taskId,
        role: result.role,
        timestamp: Date.now(),
      });

      logger.info(`[SocketServer] Task ${taskId} approved for chat`);
    } catch (error: any) {
      logger.error("[SocketServer] Task approval error:", error);
      socket.emit("task:error", {
        error: error.message || String(error),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle task completion request (v2 - user marks task done)
   */
  private async handleTaskComplete(
    socket: Socket,
    connection: SocketConnection,
    data: { taskId: string; output?: any },
  ) {
    try {
      const { taskId, output } = data;
      if (!taskId) {
        socket.emit("task:error", {
          error: "taskId is required",
          timestamp: Date.now(),
        });
        return;
      }

      const result = await this.agentManager.completeTaskByUser(taskId, output);

      socket.emit("task:completed", {
        taskId,
        mergeError: result.mergeError,
        timestamp: Date.now(),
      });

      logger.info(`[SocketServer] Task ${taskId} completed by user${result.mergeError ? ' (merge failed)' : ''}`);
    } catch (error: any) {
      logger.error("[SocketServer] Task completion error:", error);
      socket.emit("task:error", {
        error: error.message || String(error),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle agent message from client
   */
  private async handleAgentMessage(
    socket: Socket,
    connection: SocketConnection,
    data: any,
  ) {
    const message = {
      agentRole: data.agentRole?.toLowerCase() || "default",
      taskId: data.taskId, // Optional: provided by frontend after first message
      payload: { content: data.content },
    };
    await this.routeMessageToAgent(connection.connectionId, socket, message);
  }

  /**
   * Handle socket disconnection
   */
  private handleDisconnect(connection: SocketConnection) {
    logger.info(
      `[SocketServer] Connection ${connection.connectionId} (User ${connection.userId}) disconnected`,
    );
    socketConnectionManager.removeConnection(connection.connectionId);
  }

  /**
   * Route message to appropriate agent using startTask/continueTask
   *
   * Flow:
   * - First message: no taskId → startTask(role, content) → returns { taskId, response }
   * - Subsequent: taskId provided → continueTask(taskId, content) → returns response
   */
  private async routeMessageToAgent(
    connectionId: string,
    socket: Socket,
    message: {
      agentRole: string;
      taskId?: string;
      payload: any;
    },
  ) {
    const { agentRole, taskId: existingTaskId, payload } = message;
    const content =
      typeof payload === "string"
        ? payload
        : payload.content || JSON.stringify(payload);

    try {
      logger.debug(
        `[SocketServer] Routing message to agent: ${agentRole} (taskId: ${existingTaskId || "new"})`,
      );

      let response: any;
      let taskId: string;

      if (!existingTaskId) {
        // First message: start new task
        const result = await this.agentManager.startTask(agentRole, content);
        taskId = result.taskId;
        response = result.response;
        logger.debug(`[SocketServer] Started new task: ${taskId}`);
      } else {
        // Subsequent messages: continue existing task
        taskId = existingTaskId;
        response = await this.agentManager.continueTask(taskId, content);
        logger.debug(`[SocketServer] Continued task: ${taskId}`);
      }

      // Send response to client (includes taskId for frontend to store)
      const responseContent =
        typeof response === "string"
          ? response
          : response?.response || JSON.stringify(response);

      socketConnectionManager.sendToConnection(connectionId, "agent:message", {
        agentRole,
        taskId, // Frontend stores this for subsequent messages
        content: responseContent,
        timestamp: Date.now(),
      });

      socketConnectionManager.sendToConnection(connectionId, "agent:done", {
        agentRole,
        taskId,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      logger.error(`[SocketServer] Error in agent ${agentRole}:`, error);
      socketConnectionManager.sendToConnection(connectionId, "agent:error", {
        agentRole,
        error: error.message || String(error),
        timestamp: Date.now(),
      });
    }
  } // Note: roleDiscovery is now handled via request/response pattern
  // instead of broadcasting to all clients

  // logger.info("[SocketServer] AgentManager event listeners configured")
  //   logger.info(`[SocketServer] Broadcasting task update for ${agentRole}`);

  //   const subscribedClients =
  //     clientConnectionManager.getClientsSubscribedToAgent(agentRole);
  //   subscribedClients.forEach((client) => {
  //     this.sendToClient(client.clientId, "task_update", {
  //       agentRole,
  //       update,
  //       timestamp: Date.now(),
  //     });
  //   });
  // }

  // /**
  //  * Get connected clients count
  //  */
  // getClientsCount(): number {
  //   return clientConnectionManager.getClientCount();
  // }

  /**
   * Get connection and user statistics
   */

  /**
   * Close all connections
   */
  close() {
    logger.info("[SocketServer] Closing all connections...");
    this.io.close();
  }
}
