/**
 * SqliteChatService — Chat persistence via bun:sqlite.
 *
 * All messages stored in a single SQLite database with indexes.
 * Replaces FileChatService (JSONL) for local mode.
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { IChatService } from "../contracts/index.js";
import type { ChatMessage } from "../types/index.js";

export class SqliteChatService implements IChatService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        teamId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        userId TEXT NOT NULL,
        goalId TEXT,
        taskId TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        streamParts TEXT,
        agentLayer TEXT,
        contextMessages TEXT,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_team ON messages(teamId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(teamId, agentId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_goal ON messages(teamId, goalId, timestamp);
    `);
    // Migration: add agentLayer column if missing (existing databases)
    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN agentLayer TEXT`);
    } catch {
      // Column already exists — ignore
    }
    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN contextMessages TEXT`);
    } catch {
      // Column already exists — ignore
    }
    // Migration: rename sessionId → userId (existing databases)
    try {
      this.db.exec(`ALTER TABLE messages RENAME COLUMN sessionId TO userId`);
    } catch {
      // Column already renamed or doesn't exist — ignore
    }
  }

  async addMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage> {
    const id = randomUUID();
    const timestamp = msg.timestamp || new Date().toISOString();
    this.db.run(
      `INSERT INTO messages (id, teamId, agentId, userId, goalId, taskId, role, content, streamParts, agentLayer, contextMessages, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, msg.teamId, msg.agentId, msg.userId, msg.goalId ?? null, msg.taskId ?? null,
       msg.role, msg.content, msg.streamParts ?? null, msg.agentLayer ?? null, msg.contextMessages ?? null, timestamp],
    );
    return { ...msg, id, timestamp };
  }

  async getMessages(teamId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    const limit = options?.limit ?? 200;
    if (options?.before) {
      return this.db.query(
        `SELECT * FROM messages WHERE teamId = ? AND timestamp < ? ORDER BY timestamp ASC LIMIT ?`,
      ).all(teamId, options.before, limit) as ChatMessage[];
    }
    // Return last N messages in chronological order
    const rows = this.db.query(
      `SELECT * FROM messages WHERE teamId = ? ORDER BY timestamp DESC LIMIT ?`,
    ).all(teamId, limit) as ChatMessage[];
    return rows.reverse();
  }

  async getAgentMessages(teamId: string, agentId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
    const limit = options?.limit ?? 50;
    const rows = this.db.query(
      `SELECT * FROM messages WHERE teamId = ? AND agentId = ? ORDER BY timestamp DESC LIMIT ?`,
    ).all(teamId, agentId, limit) as ChatMessage[];
    return rows.reverse();
  }

  async getGoalMessages(teamId: string, goalId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
    const limit = options?.limit ?? 50;
    const rows = this.db.query(
      `SELECT * FROM messages WHERE teamId = ? AND goalId = ? ORDER BY timestamp DESC LIMIT ?`,
    ).all(teamId, goalId, limit) as ChatMessage[];
    return rows.reverse();
  }

  async getSessionMessages(teamId: string, options?: {
    sessionLimit?: number;
    workerLimit?: number;
    userId?: string;
  }): Promise<{ session: ChatMessage[]; worker: ChatMessage[] }> {
    const sessionLimit = options?.sessionLimit ?? 100;
    const workerLimit = options?.workerLimit ?? 50;

    // userId filter: when provided, only load messages from this user + assistant responses
    if (options?.userId) {
      const sessionRows = this.db.query(
        `SELECT * FROM messages WHERE teamId = ? AND (agentLayer = 'planner' OR agentLayer = 'chat-agent')
         AND (userId = ? OR role = 'assistant')
         ORDER BY timestamp DESC LIMIT ?`,
      ).all(teamId, options.userId, sessionLimit) as ChatMessage[];

      const workerRows = this.db.query(
        `SELECT * FROM messages WHERE teamId = ? AND (agentLayer = 'worker' OR agentLayer IS NULL)
         AND (userId = ? OR role = 'assistant')
         ORDER BY timestamp DESC LIMIT ?`,
      ).all(teamId, options.userId, workerLimit) as ChatMessage[];

      return {
        session: sessionRows.reverse(),
        worker: workerRows.reverse(),
      };
    }

    // No userId filter — return all messages
    const sessionRows = this.db.query(
      `SELECT * FROM messages WHERE teamId = ? AND (agentLayer = 'planner' OR agentLayer = 'chat-agent')
       ORDER BY timestamp DESC LIMIT ?`,
    ).all(teamId, sessionLimit) as ChatMessage[];

    const workerRows = this.db.query(
      `SELECT * FROM messages WHERE teamId = ? AND (agentLayer = 'worker' OR agentLayer IS NULL)
       ORDER BY timestamp DESC LIMIT ?`,
    ).all(teamId, workerLimit) as ChatMessage[];

    return {
      session: sessionRows.reverse(),
      worker: workerRows.reverse(),
    };
  }
}
