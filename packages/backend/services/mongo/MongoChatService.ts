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
      userId: msg.userId,
      goalId: msg.goalId ?? undefined,
      taskId: msg.taskId ?? undefined,
      role: msg.role,
      content: msg.content,
      streamParts: msg.streamParts ?? undefined,
      agentLayer: msg.agentLayer ?? undefined,
      contextMessages: msg.contextMessages ?? undefined,
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

  async getAgentMessages(teamId: string, agentId: string, options?: { limit?: number; userId?: string }): Promise<ChatMessage[]> {
    const ChatMessageModel = await this.getModel();
    const limit = Math.min(options?.limit ?? 50, 200);
    const query: any = { teamId, agentId };
    if (options?.userId) query.userId = options.userId;
    const docs = await ChatMessageModel.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return docs.reverse().map((d) => this.toMessage(d));
  }

  async getGoalMessages(teamId: string, goalId: string, options?: { limit?: number; userId?: string }): Promise<ChatMessage[]> {
    const ChatMessageModel = await this.getModel();
    const limit = Math.min(options?.limit ?? 50, 200);
    const query: any = { teamId, goalId };
    if (options?.userId) query.userId = options.userId;
    const docs = await ChatMessageModel.find(query)
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
      userId: doc.userId,
      goalId: doc.goalId,
      taskId: doc.taskId || undefined,
      role: doc.role,
      content: doc.content,
      streamParts: doc.streamParts ?? undefined,
      agentLayer: doc.agentLayer ?? undefined,
      contextMessages: doc.contextMessages ?? undefined,
      timestamp: doc.timestamp?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  async getSessionMessages(teamId: string, options?: {
    sessionLimit?: number;
    workerLimit?: number;
    userId?: string;
  }): Promise<{ session: ChatMessage[]; worker: ChatMessage[] }> {
    const ChatMessageModel = await this.getModel();
    const sessionLimit = Math.min(options?.sessionLimit ?? 100, 500);
    const workerLimit = Math.min(options?.workerLimit ?? 50, 200);

    // userId filter: when provided, only load messages from this user + assistant responses
    const userFilter = options?.userId
      ? { $or: [{ userId: options.userId }, { role: "assistant" }] }
      : {};

    const [sessionDocs, workerDocs] = await Promise.all([
      ChatMessageModel.find({ teamId, agentLayer: { $in: ["planner", "chat-agent"] }, ...userFilter })
        .sort({ timestamp: -1 })
        .limit(sessionLimit)
        .lean(),
      ChatMessageModel.find({ teamId, $or: [{ agentLayer: "worker" }, { agentLayer: null }, { agentLayer: { $exists: false } }], ...userFilter })
        .sort({ timestamp: -1 })
        .limit(workerLimit)
        .lean(),
    ]);

    return {
      session: sessionDocs.reverse().map(d => this.toMessage(d)),
      worker: workerDocs.reverse().map(d => this.toMessage(d)),
    };
  }
}
