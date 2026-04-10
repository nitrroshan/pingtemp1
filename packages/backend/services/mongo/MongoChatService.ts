/**
 * MongoChatService — Wraps the existing ChatMessage Mongoose model
 * behind the IChatService interface.
 */

import type { IChatService } from "../contracts/index.js";
import type { ChatMessage } from "../types/index.js";

export class MongoChatService implements IChatService {
  private getModel() {
    return import("./schemas/ChatMessageSchema.js").then((m) => m.ChatMessageModel);
  }

  // TODO: add pagination and filtering options to getMessages
  // do we have a good model for messages
  async addMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage> {
    const ChatMessageModel = await this.getModel();
    const doc = await ChatMessageModel.create({
      teamId: msg.teamId,
      sessionId: msg.sessionId,
      role: msg.role,
      agentId: msg.agentId,
      taskId: msg.taskId ?? undefined,
      content: msg.content,
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

  private toMessage(doc: any): ChatMessage {
    return {
      id: doc._id.toString(),
      teamId: doc.teamId,
      sessionId: doc.sessionId,
      role: doc.role,
      agentId: doc.agentId,
      taskId: doc.taskId ?? undefined,
      content: doc.content,
      timestamp: doc.timestamp?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
