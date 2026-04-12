/**
 * SqliteGoalService — Goal persistence via bun:sqlite.
 *
 * Shares the same SQLite database as SqliteChatService.
 * Replaces FileGoalService (lowdb) for local mode.
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { IGoalService } from "../contracts/index.js";
import type { Goal } from "../types/index.js";

export class SqliteGoalService implements IGoalService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        teamId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        planId TEXT,
        result TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_team ON goals(teamId, createdAt);
    `);
  }

  async addGoal(goal: Omit<Goal, "id" | "createdAt" | "updatedAt">): Promise<Goal> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO goals (id, teamId, sessionId, goal, status, planId, result, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, goal.teamId, goal.sessionId, goal.goal, goal.status ?? "pending",
       goal.planId ?? null, goal.result ?? null, now, now],
    );
    return { ...goal, id, createdAt: now, updatedAt: now };
  }

  async getGoals(teamId: string, options?: { limit?: number }): Promise<Goal[]> {
    const limit = Math.min(options?.limit ?? 20, 100);
    return this.db.query(
      `SELECT * FROM goals WHERE teamId = ? ORDER BY createdAt DESC LIMIT ?`,
    ).all(teamId, limit) as Goal[];
  }

  async updateGoal(goalId: string, updates: Partial<Goal>): Promise<Goal | null> {
    const existing = this.db.query(`SELECT * FROM goals WHERE id = ?`).get(goalId) as Goal | null;
    if (!existing) return null;

    const now = new Date().toISOString();
    const fields: string[] = ["updatedAt = ?"];
    const values: any[] = [now];

    if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
    if (updates.result !== undefined) { fields.push("result = ?"); values.push(updates.result); }
    if (updates.planId !== undefined) { fields.push("planId = ?"); values.push(updates.planId); }

    values.push(goalId);
    this.db.run(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`, values);

    return this.db.query(`SELECT * FROM goals WHERE id = ?`).get(goalId) as Goal;
  }
}
