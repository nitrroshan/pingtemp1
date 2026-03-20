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

  constructor(baseUrl: string = "http://localhost:3002") {
    this.baseUrl = baseUrl;
    this.userId = `user-${Math.random().toString(36).substring(7)}`;
  }

  // ============================================================================
  // Connection
  // ============================================================================

  /**
   * Connect to V2 Socket.IO server
   */
  async connect(teamId: string): Promise<void> {
    this.teamId = teamId;

    return new Promise((resolve, reject) => {
      // Connect to V2 path
      this.socket = io(this.baseUrl, {
        path: "/socket.io/v2",
        transports: ["websocket", "polling"],
      });

      this.socket.on("connect", () => {
        console.log("[AgentServiceV2] Connected");
        this.socket!.emit("register", { userId: this.userId });
      });

      this.socket.on("registered", (data: { clientId: string }) => {
        this.clientId = data.clientId;
        console.log(`[AgentServiceV2] Registered: ${data.clientId}`);

        // Request current state after registration to restore UI on refresh
        setTimeout(() => {
          console.log("[AgentServiceV2] Requesting initial state...");
          this.getState();
        }, 100);

        resolve();
      });

      this.socket.on("connect_error", (error) => {
        console.error("[AgentServiceV2] Connection error:", error);
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
      console.log(
        `[AgentServiceV2] Message from ${data.agentId}:`,
        data.content.substring(0, 100),
      );
      this.messageCallbacks.forEach((cb) => cb(data));
    });

    // State event
    this.socket.on("state", (data: SessionState) => {
      console.log(
        `[AgentServiceV2] State update:`,
        data.sessionState || "tasks updated",
      );
      this.stateCallbacks.forEach((cb) => cb(data));
    });

    // Output event
    this.socket.on("output", (data: AgentOutput) => {
      console.log(
        `[AgentServiceV2] Output from ${data.agentId}:`,
        data.output.contentType,
      );
      this.outputCallbacks.forEach((cb) => cb(data));
    });

    // Progress event (real-time updates during task execution)
    this.socket.on("progress", (data: Progress) => {
      console.log(
        `[AgentServiceV2] Progress [${data.type}]:`,
        data.content.substring(0, 50),
      );
      this.progressCallbacks.forEach((cb) => cb(data));
    });

    // Error event
    this.socket.on("error", (data: ErrorInfo) => {
      console.error(`[AgentServiceV2] Error:`, data.error);
      this.errorCallbacks.forEach((cb) => cb(data));
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
  sendToManager(content: string): void {
    if (!this.socket || !this.teamId) {
      throw new Error("Not connected or no team selected");
    }

    this.socket.emit("message", {
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
    if (!this.socket || !this.teamId) {
      throw new Error("Not connected or no team selected");
    }

    console.log("[AgentServiceV2] sendToWorker:", {
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
    if (!this.socket || !this.teamId) {
      throw new Error("Not connected or no team selected");
    }

    this.socket.emit("action", {
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
   * Create a new team with role discovery
   */
  async createTeam(
    name: string,
    goal: string,
    description?: string,
  ): Promise<{ team: TeamResponse; agents: AgentInfo[] }> {
    const response = await fetch(`${this.baseUrl}/api/v2/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, goal, description }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create team");
    }

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
}

// Singleton instance
export const agentServiceV2 = new AgentServiceV2();
