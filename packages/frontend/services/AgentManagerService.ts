/**
 * AgentManagerService - Unified service combining Socket.IO and HTTP communication
 */

import { socketService, SocketService } from "./SocketService";
import { httpService, HttpService } from "./HttpService";

interface AgentResponse {
  agentRole: string;
  taskId?: string; // Returned from server for conversation continuity
  messageId: string;
  result: {
    type: "result" | "delegate" | "question" | "error" | "request_info";
    content: string;
    meta?: any;
  };
  timestamp: number;
}

export class AgentManagerService {
  private socketService: SocketService;
  private httpService: HttpService;
  /**
   * Track taskId per agent role for conversation continuity
   * Key: agentRole (lowercase), Value: taskId
   */
  private taskIds: Map<string, string> = new Map();
  constructor(baseUrl: string = "http://localhost:3002") {
    this.socketService = socketService;
    this.httpService = httpService;
  }

  // ============================================================================
  // SOCKET METHODS - Delegated to SocketService
  // ============================================================================

  /**
   * Connect to Socket.IO server
   */
  connect(): Promise<void> {
    return this.socketService.connect();
  }

  /**
   * Subscribe to specific agent updates
   */
  subscribeToAgent(agentRole: string) {
    this.socketService.subscribeToAgent(agentRole);
  }

  /**
   * Unsubscribe from agent updates
   */
  unsubscribeFromAgent(agentRole: string) {
    this.socketService.unsubscribeFromAgent(agentRole);
  }

  /**
   * Send message to specific agent
   * Automatically manages taskId for conversation continuity:
   * - First message: no taskId → server creates new task → returns taskId
   * - Subsequent messages: includes taskId → server continues existing conversation
   */
  async sendMessageToAgent(
    agentRole: string,
    content: string,
  ): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      const messageId = Math.random().toString(36).substring(7);
      const roleKey = agentRole.toLowerCase();
      const existingTaskId = this.taskIds.get(roleKey);

      // Listen for response
      const responseHandler = (data: AgentResponse) => {
        if (data.agentRole?.toLowerCase() === roleKey) {
          this.off("agent:message", responseHandler);

          // Store taskId for subsequent messages
          if (data.taskId) {
            this.taskIds.set(roleKey, data.taskId);
            console.log(
              `[AgentManagerService] Stored taskId for ${roleKey}: ${data.taskId}`,
            );
          }

          resolve(data);
        }
      };

      this.on("agent:message", responseHandler);

      // Send message via Socket.IO (include taskId if we have one)
      console.log(
        `[AgentManagerService] Sending message to ${agentRole} (taskId: ${existingTaskId || "new"})`,
      );
      this.socketService.sendMessageToAgent(
        agentRole,
        content,
        messageId,
        existingTaskId,
      );

      // Timeout after 300 seconds
      setTimeout(() => {
        this.off("agent:message", responseHandler);
        reject(new Error("Agent response timeout"));
      }, 300000);
    });
  }

  /**
   * Register event listener
   */
  on(event: string, callback: Function) {
    this.socketService.on(event, callback);
  }

  /**
   * Remove event listener
   */
  off(event: string, callback: Function) {
    this.socketService.off(event, callback);
  }

  /**
   * Get the current client ID
   */
  getClientId(): string | null {
    return this.socketService.getClientId();
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.socketService.getUserId();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socketService.isConnected();
  }

  /**
   * Disconnect from Socket.IO
   */
  disconnect() {
    this.socketService.disconnect();
  }

  // ============================================================================
  // HTTP METHODS - Delegated to HttpService
  // ============================================================================

  /**
   * Create a new team via HTTP API
   */
  async createTeam(teamParams: {
    teamName: string;
    goal: string;
    description?: string;
  }): Promise<any> {
    return this.httpService.createTeam(teamParams);
  }

  /**
   * Get all teams
   */
  async getTeams(): Promise<any[]> {
    return this.httpService.getTeams();
  }

  /**
   * Get all tasks
   */
  async getTasks(): Promise<any[]> {
    return this.httpService.getTasks();
  }

  /**
   * Get roles from database by team ID
   */
  async getRolesByTeam(teamId: string): Promise<any[]> {
    return this.httpService.getRolesByTeam(teamId);
  }

  /**
   * Discover roles dynamically by task description
   */
  async getRolesByTask(taskDescription?: string): Promise<any[]> {
    return this.httpService.getRolesByTask(taskDescription);
  }

  /**
   * Clear taskId for an agent (call when starting new conversation)
   */
  clearTaskId(agentRole: string): void {
    const roleKey = agentRole.toLowerCase();
    this.taskIds.delete(roleKey);
    console.log(`[AgentManagerService] Cleared taskId for ${roleKey}`);
  }

  /**
   * Get current taskId for an agent (for debugging)
   */
  getTaskId(agentRole: string): string | undefined {
    return this.taskIds.get(agentRole.toLowerCase());
  }
}

// Singleton instance
export const agentManagerService = new AgentManagerService();
