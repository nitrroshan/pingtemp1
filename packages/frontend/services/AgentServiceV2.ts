/**
 * AgentServiceV2 - Simplified service for V2 API
 *
 * 5 events only:
 *   - message (bidirectional) - Chat with agents
 *   - action (client→server) - approve-plan, start-task, complete-task, cancel-task
 *   - state (server→client) - Session/task state changes
 *   - output (server→client) - Agent produced structured output
 *   - error (server→client) - Error occurred
 *
 * Uses registry pattern on backend (teamId required for all operations)
 */

import { io, Socket } from "socket.io-client";
import { logger } from "../utils/logger";
import { API_BASE_URL } from "../constants";

// ============================================================================
// Types
// ============================================================================

export interface AgentMessage {
  sessionId: string;
  agentId: string;
  taskId?: string;
  content: string;
  isStreaming?: boolean;
  timestamp: number;
}

export interface SessionState {
  sessionId: string;
  sessionState?:
    | "planning"
    | "ready"
    | "executing"
    | "completed"
    | "awaiting_approval";
  plan?: Task[];
  tasks?: TaskUpdate[];
  autoExecute?: boolean;
  timestamp: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  status: string;
  priority?: number;
  dependencies?: string[];
}

export interface TaskUpdate {
  id: string;
  status: string;
  role?: string;
}

export interface AgentOutput {
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

export interface Progress {
  sessionId: string;
  taskId: string;
  agentId: string;
  type: "thinking" | "tool_start" | "tool_result" | "step";
  content: string;
  tool?: string;
  timestamp: number;
}

export interface ErrorInfo {
  sessionId?: string;
  taskId?: string;
  error: string;
  timestamp: number;
}

// HTTP Response types
export interface TeamResponse {
  id: string;
  name: string;
  goal: string;
  description?: string;
  memberCount: number;
}

export interface AgentInfo {
  id: string;
  role: string;
  name: string;
  goal: string;
  teamId?: string;
}

export interface SessionInfo {
  teamId: string;
  active: boolean;
  state: string;
  hasPendingPlan?: boolean;
  planTaskCount?: number;
}

export interface TaskInfo {
  id: string;
  description: string;
  status: string;
  assignedRole: string;
  priority?: number;
}

// ============================================================================
// AgentServiceV2
// ============================================================================

export class AgentServiceV2 {
  private socket: Socket | null = null;
  private teamId: string | null = null;
  private sessionId: string = "default";
  private userId: string;
  private clientId: string | null = null;
  private baseUrl: string;

  // Event callbacks
  private messageCallbacks: Set<(msg: AgentMessage) => void> = new Set();
  private stateCallbacks: Set<(state: SessionState) => void> = new Set();
  private outputCallbacks: Set<(output: AgentOutput) => void> = new Set();
  private progressCallbacks: Set<(progress: Progress) => void> = new Set();
  private errorCallbacks: Set<(error: ErrorInfo) => void> = new Set();
  private streamCallbacks: Set<(payload: any) => void> = new Set();
  // Discussion notification callbacks (v2.0)
  private discussionActivityCallbacks: Set<(data: any) => void> = new Set();
  private discussionMentionCallbacks: Set<(data: any) => void> = new Set();
  private taskUpdateCallbacks: Set<(data: any) => void> = new Set();

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.userId = `user-${Math.random().toString(36).substring(7)}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ============================================================================
  // Connection
  // ============================================================================

  /**
   * Connect to V2 Socket.IO server
   */
  async connect(teamId: string): Promise<void> {
    // Already connected to this team — skip
    if (this.socket?.connected && this.teamId === teamId) {
      return;
    }

    // Disconnect existing socket before creating a new one
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.clientId = null;
    }

    this.teamId = teamId;

    return new Promise((resolve, reject) => {
      // Connect to V2 path
      this.socket = io(this.baseUrl, {
        path: "/socket.io/v2",
        transports: ["polling"],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        withCredentials: true,
      });

      this.socket.on("connect", () => {
        logger.info("[AgentServiceV2] Connected, registering...");
        this.socket!.emit("register", { userId: this.userId });
      });

      this.socket.on("disconnect", (reason) => {
        logger.warn("[AgentServiceV2] Disconnected:", reason);
        this.clientId = null;
      });

      this.socket.on("registered", (data: { clientId: string }) => {
        this.clientId = data.clientId;
        logger.info(`[AgentServiceV2] Registered: ${data.clientId}`);

        // Request current state after registration to restore UI on refresh
        setTimeout(() => {
          logger.info("[AgentServiceV2] Requesting initial state...");
          this.getState();
        }, 100);

        resolve();
      });

      this.socket.on("connect_error", (error) => {
        logger.error("[AgentServiceV2] Connection error:", error);
        reject(error);
      });

      // Setup V2 event handlers
      this.setupEventHandlers();

      // Timeout
      setTimeout(() => reject(new Error("Connection timeout")), 10000);
    });
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    // Message event (bidirectional - this is incoming from server)
    this.socket.on("message", (data: AgentMessage) => {
      logger.info(
        `[AgentServiceV2] Message from ${data.agentId}:`,
        data.content.substring(0, 100),
      );
      this.messageCallbacks.forEach((cb) => cb(data));
    });

    // State event
    this.socket.on("state", (data: SessionState) => {
      logger.info(
        `[AgentServiceV2] State update:`,
        data.sessionState || "tasks updated",
      );
      this.stateCallbacks.forEach((cb) => cb(data));
    });

    // Output event
    this.socket.on("output", (data: AgentOutput) => {
      logger.info(
        `[AgentServiceV2] Output from ${data.agentId}:`,
        data.output.contentType,
      );
      this.outputCallbacks.forEach((cb) => cb(data));
    });

    // Progress event (real-time updates during task execution)
    this.socket.on("progress", (data: Progress) => {
      logger.info(
        `[AgentServiceV2] Progress [${data.type}]:`,
        data.content.substring(0, 50),
      );
      this.progressCallbacks.forEach((cb) => cb(data));
    });

    // Error event
    this.socket.on("error", (data: ErrorInfo) => {
      logger.error(`[AgentServiceV2] Error:`, data.error);
      this.errorCallbacks.forEach((cb) => cb(data));
    });

    // Stream event (Phase 2 — AI SDK streaming)
    this.socket.on("stream", (data: any) => {
      this.streamCallbacks.forEach((cb) => cb(data));
    });

    // Discussion events (v2.0 — discussion UI)
    this.socket.on("discussion:activity", (data: any) => {
      this.discussionActivityCallbacks.forEach((cb) => cb(data));
    });
    this.socket.on("discussion:mention", (data: any) => {
      this.discussionMentionCallbacks.forEach((cb) => cb(data));
    });

    // Channel B: task_update events (task lifecycle updates for sidebar + logs)
    this.socket.on("task_update", (data: any) => {
      this.taskUpdateCallbacks.forEach((cb) => cb(data));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.clientId = null;
    this.teamId = null;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  // ============================================================================
  // Send Methods
  // ============================================================================

  /**
   * Send message to manager agent (for planning)
   * Manager handles task planning and coordination
   */
  private isReady(): boolean {
    return !!(this.socket && this.clientId && this.teamId);
  }

  sendToManager(content: string): void {
    if (!this.isReady()) {
      logger.error("[AgentServiceV2] Cannot send: socket =", !!this.socket, "clientId =", this.clientId, "teamId =", this.teamId);
      throw new Error("Not connected or no team selected");
    }

    logger.info("[AgentServiceV2] sendToManager:", content.substring(0, 50));
    this.socket!.emit("message", {
      teamId: this.teamId,
      agentId: "manager",
      sessionId: this.sessionId,
      content,
    });
  }

  /**
   * Send message to worker agent (for task execution)
   */
  sendToWorker(agentId: string, content: string, taskId?: string): void {
    if (!this.isReady()) {
      logger.error("[AgentServiceV2] Cannot send: socket =", !!this.socket, "clientId =", this.clientId, "teamId =", this.teamId);
      throw new Error("Not connected or no team selected");
    }

    logger.info("[AgentServiceV2] sendToWorker:", {
      teamId: this.teamId,
      agentId,
      taskId,
      contentPreview: content?.substring(0, 50),
    });

    this.socket.emit("message", {
      teamId: this.teamId,
      agentId,
      taskId,
      content,
    });
  }

  /**
   * Send message to a persistent ChatAgent (L2) for a role.
   * Uses "chat-{role}" agentId convention — backend routes to ChatAgent.
   */
  sendToChatAgent(role: string, content: string): void {
    if (!this.isReady()) {
      logger.error("[AgentServiceV2] Cannot send: socket =", !!this.socket, "clientId =", this.clientId, "teamId =", this.teamId);
      throw new Error("Not connected or no team selected");
    }

    const agentId = `chat-${role}`;
    logger.info("[AgentServiceV2] sendToChatAgent:", {
      teamId: this.teamId,
      agentId,
      contentPreview: content?.substring(0, 50),
    });

    this.socket!.emit("message", {
      teamId: this.teamId,
      agentId,
      sessionId: this.sessionId,
      content,
    });
  }

  // ============================================================================
  // Action Methods
  // ============================================================================

  /**
   * Approve the current plan
   */
  approvePlan(): void {
    this.emitAction("approve-plan");
  }

  /**
   * Start a task (enables user chat with worker)
   */
  startTask(taskId: string): void {
    this.emitAction("start-task", { taskId });
  }

  /**
   * Complete a task with optional output
   */
  completeTask(taskId: string, output?: any): void {
    this.emitAction("complete-task", { taskId, output });
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): void {
    this.emitAction("cancel-task", { taskId });
  }

  /**
   * Set or get auto-execute mode
   * @param enabled - true/false to set, omit to just query current state
   * Response comes via state event with autoExecute field
   */
  autoExecute(enabled?: boolean): void {
    this.emitAction(
      "auto-execute",
      enabled !== undefined ? { enabled } : undefined,
    );
  }

  /**
   * Request current state from server (tasks, plan, session state)
   * Called automatically on connect, can also be called to refresh
   */
  getState(): void {
    this.emitAction("get-state");
  }

  private emitAction(
    type:
      | "approve-plan"
      | "start-task"
      | "complete-task"
      | "cancel-task"
      | "auto-execute"
      | "get-state",
    data?: { taskId?: string; output?: any; enabled?: boolean },
  ): void {
    if (!this.isReady()) {
      logger.warn("[AgentServiceV2] emitAction skipped (not ready):", type);
      return;
    }

    this.socket!.emit("action", {
      teamId: this.teamId,
      type,
      sessionId: this.sessionId,
      ...data,
    });
  }

  // ============================================================================
  // Event Subscriptions
  // ============================================================================

  /**
   * Subscribe to agent messages
   * @returns Unsubscribe function
   */
  onMessage(callback: (msg: AgentMessage) => void): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  /**
   * Subscribe to state changes
   * @returns Unsubscribe function
   */
  onState(callback: (state: SessionState) => void): () => void {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  /**
   * Subscribe to agent outputs
   * @returns Unsubscribe function
   */
  onOutput(callback: (output: AgentOutput) => void): () => void {
    this.outputCallbacks.add(callback);
    return () => this.outputCallbacks.delete(callback);
  }

  /**
   * Subscribe to progress updates (thinking, tool calls) during execution
   * @returns Unsubscribe function
   */
  onProgress(callback: (progress: Progress) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  /**
   * Subscribe to errors
   * @returns Unsubscribe function
   */
  onError(callback: (error: ErrorInfo) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  /**
   * Subscribe to AI SDK stream events (Phase 2)
   * @returns Unsubscribe function
   */
  onStream(callback: (payload: any) => void): () => void {
    this.streamCallbacks.add(callback);
    return () => this.streamCallbacks.delete(callback);
  }

  /**
   * Subscribe to discussion activity events (v2.0)
   */
  onDiscussionActivity(callback: (data: any) => void): () => void {
    this.discussionActivityCallbacks.add(callback);
    return () => this.discussionActivityCallbacks.delete(callback);
  }

  /**
   * Subscribe to discussion @mention events (v2.0)
   */
  onDiscussionMention(callback: (data: any) => void): () => void {
    this.discussionMentionCallbacks.add(callback);
    return () => this.discussionMentionCallbacks.delete(callback);
  }

  /**
   * Subscribe to any custom socket event.
   * Returns an unsubscribe function.
   */
  on(event: string, callback: (data: any) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on(event, callback);
    return () => { this.socket?.off(event, callback); };
  }

  /**
   * Subscribe to Channel B task_update events.
   */
  onTaskUpdate(callback: (data: any) => void): () => void {
    this.taskUpdateCallbacks.add(callback);
    return () => this.taskUpdateCallbacks.delete(callback);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  getClientId(): string | null {
    return this.clientId;
  }

  getUserId(): string {
    return this.userId;
  }

  getTeamId(): string | null {
    return this.teamId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  // ============================================================================
  // HTTP Methods - Teams CRUD
  // ============================================================================

  /**
   * Create a new team — from plugin or via LLM role discovery
   */
  async createTeam(
    name: string,
    goal: string,
    description?: string,
    pluginName?: string,
  ): Promise<{ team: TeamResponse; agents: AgentInfo[] }> {
    const body: Record<string, string | undefined> = { name, goal, description };
    if (pluginName) body.pluginName = pluginName;

    const response = await fetch(`${this.baseUrl}/api/v2/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create team");
    }

    return response.json();
  }

  /**
   * List available plugins from the registry
   */
  async getPlugins(): Promise<{ plugins: Array<{ name: string; description: string; version: string; tags?: string[] }>; count: number }> {
    const response = await fetch(`${this.baseUrl}/api/registry/plugins`);
    if (!response.ok) return { plugins: [], count: 0 };
    return response.json();
  }

  /**
   * List all teams
   */
  async getTeams(): Promise<{ teams: TeamResponse[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/api/v2/teams`);

    if (!response.ok) {
      throw new Error("Failed to fetch teams");
    }

    return response.json();
  }

  /**
   * Get team by ID
   */
  async getTeam(teamId: string): Promise<{ team: TeamResponse }> {
    const response = await fetch(`${this.baseUrl}/api/v2/teams/${teamId}`);

    if (!response.ok) {
      throw new Error("Failed to fetch team");
    }

    return response.json();
  }

  /**
   * Delete a team
   */
  async deleteTeam(teamId: string): Promise<{ deleted: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/v2/teams/${teamId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete team");
    }

    return response.json();
  }

  /**
   * Get agents for a team
   */
  async getAgents(
    teamId: string,
  ): Promise<{ agents: AgentInfo[]; count: number }> {
    const response = await fetch(
      `${this.baseUrl}/api/v2/teams/${teamId}/agents`,
    );

    if (!response.ok) {
      throw new Error("Failed to fetch agents");
    }

    return response.json();
  }

  /**
   * Get available skills for a team (from registry plugin)
   */
  async getTeamSkills(
    teamId: string,
  ): Promise<{ skills: Array<{ id: string; name: string; description: string }>; count: number }> {
    const response = await fetch(
      `${this.baseUrl}/api/v2/teams/${teamId}/skills`,
    );

    if (!response.ok) {
      throw new Error("Failed to fetch team skills");
    }

    return response.json();
  }

  // ============================================================================
  // HTTP Methods - Sessions (runtime state)
  // ============================================================================

  /**
   * Get session state for a team
   */
  async getSession(teamId: string): Promise<{ session: SessionInfo }> {
    const response = await fetch(`${this.baseUrl}/api/v2/sessions/${teamId}`);

    if (!response.ok) {
      throw new Error("Failed to fetch session");
    }

    return response.json();
  }

  /**
   * Get tasks for a session
   */
  async getTasks(
    teamId: string,
  ): Promise<{ tasks: TaskInfo[]; count: number }> {
    const response = await fetch(
      `${this.baseUrl}/api/v2/sessions/${teamId}/tasks`,
    );

    if (!response.ok) {
      throw new Error("Failed to fetch tasks");
    }

    return response.json();
  }

  /**
   * Get chat message history for a team
   */
  async getMessages(
    teamId: string,
    options?: { limit?: number; before?: string },
  ): Promise<{ messages: AgentMessage[] }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.before) params.set("before", options.before);

    const response = await fetch(
      `${this.baseUrl}/api/v2/teams/${teamId}/messages?${params}`,
      { credentials: "include" },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch messages");
    }

    return response.json();
  }
}

// Singleton instance
export const agentServiceV2 = new AgentServiceV2();
