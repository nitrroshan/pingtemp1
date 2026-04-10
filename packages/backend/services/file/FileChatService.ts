import { Low } from "lowdb";
import { randomUUID } from "crypto";
import path from "path";
import type { IChatService } from "../contracts/index.js";
import type { ChatMessage } from "../types/index.js";
import { createDb } from "./lowdb-helpers.js";

interface ChatsData { messages: ChatMessage[] }

export class FileChatService implements IChatService {
  private dbs = new Map<string, Low<ChatsData>>();
  constructor(private baseDir: string) {}

  private async getDb(teamId: string): Promise<Low<ChatsData>> {
    if (this.dbs.has(teamId)) return this.dbs.get(teamId)!;
    const db = await createDb<ChatsData>(path.join(this.baseDir, `${teamId}.json`), { messages: [] });
    this.dbs.set(teamId, db);
    return db;
  }

  async addMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage> {
    const db = await this.getDb(msg.teamId);
    const message: ChatMessage = { ...msg, id: randomUUID() };
    db.data.messages.push(message);
    await db.write();
    return message;
  }

  async getMessages(teamId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    const db = await this.getDb(teamId);
    let msgs = db.data.messages;
    if (options?.before) msgs = msgs.filter(m => m.timestamp < options.before!);
    msgs = msgs.sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
    return msgs.slice(-(options?.limit ?? 200));
  }
}
