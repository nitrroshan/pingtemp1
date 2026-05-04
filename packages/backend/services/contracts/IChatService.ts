import type { ChatMessage } from "../types/index.js";

export interface IChatService {
  addMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage>;
  getMessages(teamId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]>;
  getAgentMessages(teamId: string, agentId: string, options?: { limit?: number; userId?: string }): Promise<ChatMessage[]>;
  getGoalMessages(teamId: string, goalId: string, options?: { limit?: number; userId?: string }): Promise<ChatMessage[]>;
  /**
   * Get session messages for restore — returns messages grouped by agent layer.
   * Session agents (planner, chat-agent) get full conversation. Workers get recent only.
   * Optional userId filters user-sent messages for display scoping.
   */
  getSessionMessages(teamId: string, options?: {
    sessionLimit?: number;
    workerLimit?: number;
    userId?: string;
  }): Promise<{ session: ChatMessage[]; worker: ChatMessage[] }>;
}
