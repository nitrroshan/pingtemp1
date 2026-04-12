/**
 * MongoChatService -- MongoDB-backed chat history.
 *
 * Stores per-agent conversation history with indexes for:
 * - Team-wide queries (all messages for a team)
 * - Per-agent queries (conversation with a specific agent)
 * - Per-goal queries (all messages related to a goal)
 */

import type { IChatService } from "../contracts/index.js";
import type { ChatMessage } from "../types/index.js";

export class MongoChatService implements IChatService {
  private getModel() {
    return import("./schemas/ChatMessageSchema.js").then((m) => m.ChatMessageModel);
  }

  async addMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage> {
    const ChatMessageModel = await this.getModel();
    const doc = await ChatMessageModel.create({
      teamId: msg.teamId,
      agentId: msg.agentId,
      sessionId: msg.sessionId,
      goalId: msg.goalId ?? undefined,
      taskId: msg.taskId ?? undefined,
      role: msg.role,
      content: msg.content,
      streamParts: msg.streamParts ?? undefined,
    });
    return this.toMessage(doc);
  }

  async getMessages(teamId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    const ChatMessageModel = await this.getModel();
    const limit = Math.min(options?.limit ?? 50, 200);
    const query: Record<string, unknown> = { teamId };
    if (options?.before) {
      query.timestamp = { $lt: new Date(options.before) };
    }
    const docs = await ChatMessageModel.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return docs.reverse().map((d) => this.toMessage(d));
  }

  async getAgentMessages(teamId: string, agentId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
    const ChatMessageModel = await this.getModel();
    const limit = Math.min(options?.limit ?? 50, 200);
    const docs = await ChatMessageModel.find({ teamId, agentId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return docs.reverse().map((d) => this.toMessage(d));
  }

  async getGoalMessages(teamId: string, goalId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
    const ChatMessageModel = await this.getModel();
    const limit = Math.min(options?.limit ?? 50, 200);
    const docs = await ChatMessageModel.find({ teamId, goalId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return docs.reverse().map((d) => this.toMessage(d));
  }

  private toMessage(doc: any): ChatMessage {
    return {
      id: doc._id.toString(),
      teamId: doc.teamId,
      agentId: doc.agentId,
      sessionId: doc.sessionId,
      goalId: doc.goalId ?? undefined,
      taskId: doc.taskId ?? undefined,
      role: doc.role,
      content: doc.content,
      streamParts: doc.streamParts ?? undefined,
      timestamp: doc.timestamp?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
