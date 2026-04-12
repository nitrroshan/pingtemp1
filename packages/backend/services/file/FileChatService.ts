/**
 * FileChatService -- JSONL-based chat storage (like Claude Code).
 *
 * Each team gets a .jsonl file: one JSON object per line, append-only.
 * No full-file rewrites on every message. Fast writes, streamable reads.
 *
 * File: data/chats/{teamId}.jsonl
 */

import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import readline from "readline";
import type { IChatService } from "../contracts/index.js";
import type { ChatMessage } from "../types/index.js";

export class FileChatService implements IChatService {
  constructor(private baseDir: string) {
    // Ensure directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private filePath(teamId: string): string {
    return path.join(this.baseDir, `${teamId}.jsonl`);
  }

  async addMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage> {
    const message: ChatMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: msg.timestamp || new Date().toISOString(),
    };
    const line = JSON.stringify(message) + "\n";
    fs.appendFileSync(this.filePath(msg.teamId), line, "utf-8");
    return message;
  }

  async getMessages(teamId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    const msgs = await this.readAll(teamId);
    let filtered = msgs;
    if (options?.before) {
      filtered = filtered.filter(m => m.timestamp < options.before!);
    }
    const limit = options?.limit ?? 200;
    return filtered.slice(-limit);
  }

  async getAgentMessages(teamId: string, agentId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
    const msgs = await this.readAll(teamId);
    const filtered = msgs.filter(m => m.agentId === agentId);
    const limit = options?.limit ?? 50;
    return filtered.slice(-limit);
  }

  async getGoalMessages(teamId: string, goalId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
    const msgs = await this.readAll(teamId);
    const filtered = msgs.filter(m => m.goalId === goalId);
    const limit = options?.limit ?? 50;
    return filtered.slice(-limit);
  }

  /** Read all messages from a team's JSONL file */
  private async readAll(teamId: string): Promise<ChatMessage[]> {
    const fp = this.filePath(teamId);
    if (!fs.existsSync(fp)) return [];

    const messages: ChatMessage[] = [];
    const stream = fs.createReadStream(fp, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    return messages;
  }
}
