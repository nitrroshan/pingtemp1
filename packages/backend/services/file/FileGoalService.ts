import { Low } from "lowdb";
import { randomUUID } from "crypto";
import path from "path";
import type { IGoalService } from "../contracts/index.js";
import type { Goal } from "../types/index.js";
import { createDb, now } from "./lowdb-helpers.js";

interface GoalsData { goals: Goal[] }

export class FileGoalService implements IGoalService {
  private dbs = new Map<string, Low<GoalsData>>();
  constructor(private baseDir: string) {}

  private async getDb(teamId: string): Promise<Low<GoalsData>> {
    if (this.dbs.has(teamId)) return this.dbs.get(teamId)!;
    const db = await createDb<GoalsData>(path.join(this.baseDir, `${teamId}.json`), { goals: [] });
    this.dbs.set(teamId, db);
    return db;
  }

  async addGoal(goal: Omit<Goal, "id" | "createdAt" | "updatedAt">): Promise<Goal> {
    const db = await this.getDb(goal.teamId);
    const g: Goal = { ...goal, id: randomUUID(), createdAt: now(), updatedAt: now() };
    db.data.goals.push(g);
    await db.write();
    return g;
  }

  async getGoals(teamId: string, options?: { limit?: number }): Promise<Goal[]> {
    const db = await this.getDb(teamId);
    const goals = db.data.goals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return goals.slice(0, options?.limit ?? 100);
  }

  async updateGoal(goalId: string, updates: Partial<Goal>): Promise<Goal | null> {
    for (const db of this.dbs.values()) {
      const idx = db.data.goals.findIndex(g => g.id === goalId);
      if (idx !== -1) {
        const goal = { ...db.data.goals[idx], ...updates, updatedAt: now() };
        db.data.goals[idx] = goal;
        await db.write();
        return goal;
      }
    }
    return null;
  }
}
