/**
 * SocketService - Handles Socket.IO communication with backend
 */

import { io, Socket } from "socket.io-client";

export class SocketService {
  private socket: Socket | null = null;
  private clientId: string | null = null;
  private userId: string | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private reconnectInterval: number = 5000;
  private reconnectTimer: any = null;

  constructor(private socketUrl: string = "http://localhost:3002") {
    // Get or create userId from localStorage
    this.userId = this.getOrCreateUserId();
  }

  /**
   * Get or create a persistent userId
   */
  private getOrCreateUserId(): string {
    const storageKey = "agentManagerUserId";
    let userId = localStorage.getItem(storageKey);

    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      localStorage.setItem(storageKey, userId);
      console.log("[SocketService] Created new userId:", userId);
    } else {
      console.log("[SocketService] Retrieved existing userId:", userId);
    }

    return userId;
  }

  /**
   * Socket event handlers - Named functions for better tracking
   */
  private handleSocketConnect = () => {
    console.log("[SocketService] ✓ Socket connected, registering...");

    // Register with userId
    if (this.socket) {
      this.socket.emit("register", { userId: this.userId });
    }
  };

  private handleSocketRegistered = (data: {
    clientId: string;
    userId: string;
    timestamp: number;
  }) => {
    this.clientId = data.clientId;
    console.log(
      `[SocketService] ✓ Registered - ClientId: ${data.clientId}, UserId: ${data.userId}`,
    );

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  };

  private handleSocketError = (error: { message: string }) => {
    console.error("[SocketService] Socket.IO server error:", error.message);
  };

  private handleSocketAnyEvent = (eventName: string, ...args: any[]) => {
    const data = args[0];
    console.log(`[SocketService] Event received: ${eventName}`, data);
    this.handleMessage(eventName, data);
  };

  private handleSocketConnectError = (error: Error) => {
    console.error("[SocketService] Socket.IO connection error:", error);
    // Don't reject immediately, let it retry
  };

  private handleSocketDisconnect = (reason: string) => {
    console.warn("[SocketService] Socket.IO disconnected:", reason);
    this.clientId = null; // Clear clientId on disconnect
    // userId persists
  };

  /**
   * Connect to Socket.IO server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Connect to Socket.IO (same port as HTTP server)
        this.socket = io(this.socketUrl, {
          transports: ["websocket", "polling"],
          autoConnect: true,
        });

        // Register all event handlers
        this.socket.on("connect", this.handleSocketConnect);

        this.socket.on("registered", (data) => {
          this.handleSocketRegistered(data);
          resolve();
        });

        this.socket.on("error", (error) => {
          this.handleSocketError(error);
          reject(new Error(error.message));
        });

        // Set up event listeners for all Socket.IO events
        this.socket.onAny(this.handleSocketAnyEvent);

        this.socket.on("connect_error", this.handleSocketConnectError);

        this.socket.on("disconnect", this.handleSocketDisconnect);
      } catch (error) {
        console.error(
          "[SocketService] Error creating Socket.IO connection:",
          error,
        );
        reject(error);
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      console.log("[SocketService] Reconnecting to Socket.IO...");
      this.connect().catch(console.error);
    }, this.reconnectInterval);
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(eventName: string, data: any) {
    console.log(
      `[SocketService] Dispatching event '${eventName}' to ${
        this.listeners.get(eventName)?.size || 0
      } listeners`,
    );

    const listeners = this.listeners.get(eventName);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }

    // Also notify wildcard listeners
    const wildcardListeners = this.listeners.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach((callback) => callback(data));
    }
  }

  /**
   * Emit event to server
   */
  emit(event: string, data: any) {
    if (this.socket) {
      console.log(`[SocketService] Emitting event '${event}'`, data);
      this.socket.emit(event, data);
    } else {
      console.warn(
        `[SocketService] Cannot emit '${event}': socket not connected`,
      );
    }
  }

  /**
   * Subscribe to specific agent updates
   */
  subscribeToAgent(agentRole: string) {
    this.emit("subscribe", { agentRole });
  }

  /**
   * Unsubscribe from agent updates
   */
  unsubscribeFromAgent(agentRole: string) {
    this.emit("unsubscribe", { agentRole });
  }

  /**
   * Send message to specific agent
   * @param taskId - Optional taskId for continuing conversations (returned from first message response)
   */
  sendMessageToAgent(
    agentRole: string,
    content: string,
    messageId: string,
    taskId?: string,
  ) {
    this.emit("agent:message", {
      agentRole,
      content,
      messageId,
      taskId, // If provided, server continues existing task; otherwise starts new
    });
  }

  /**
   * Register event listener
   */
  on(event: string, callback: Function) {
    console.log(`[SocketService] Registering listener for event '${event}'`);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off(event: string, callback: Function) {
    console.log(`[SocketService] Removing listener for event '${event}'`);
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Get the current client ID
   */
  getClientId(): string | null {
    return this.clientId;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  /**
   * Disconnect from Socket.IO
   */
  disconnect() {
    console.log("[SocketService] Disconnecting...");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      // Remove all event listeners
      this.socket.off("connect", this.handleSocketConnect);
      this.socket.off("registered", this.handleSocketRegistered);
      this.socket.off("error", this.handleSocketError);
      this.socket.off("connect_error", this.handleSocketConnectError);
      this.socket.off("disconnect", this.handleSocketDisconnect);
      this.socket.offAny(this.handleSocketAnyEvent);

      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// Singleton instance
export const socketService = new SocketService();
