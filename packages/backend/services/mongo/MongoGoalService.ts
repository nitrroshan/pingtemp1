/**
 * MongoGoalService — Wraps the existing Goal Mongoose model
 * behind the IGoalService interface.
 */

import type { IGoalService } from "../contracts/index.js";
import type { Goal } from "../types/index.js";

export class MongoGoalService implements IGoalService {
  private getModel() {
    return import("./schemas/GoalSchema.js").then((m) => m.GoalModel);
  }

  async addGoal(goal: Omit<Goal, "id" | "createdAt" | "updatedAt">): Promise<Goal> {
    const GoalModel = await this.getModel();
    const doc = await GoalModel.create({
      teamId: goal.teamId,
      sessionId: goal.sessionId,
      goal: goal.goal,
      status: goal.status ?? "pending",
      planId: goal.planId ?? null,
      result: goal.result ?? null,
    });
    return this.toGoal(doc);
  }

  async getGoals(teamId: string, options?: { limit?: number }): Promise<Goal[]> {
    const GoalModel = await this.getModel();
    const limit = Math.min(options?.limit ?? 20, 100);
    const docs = await GoalModel.find({ teamId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => this.toGoal(d));
  }

  async updateGoal(goalId: string, updates: Partial<Goal>): Promise<Goal | null> {
    const GoalModel = await this.getModel();
    const doc = await GoalModel.findByIdAndUpdate(goalId, updates, { new: true }).lean();
    return doc ? this.toGoal(doc) : null;
  }

  private toGoal(doc: any): Goal {
    return {
      id: doc._id.toString(),
      teamId: doc.teamId,
      sessionId: doc.sessionId,
      goal: doc.goal,
      status: doc.status,
      planId: doc.planId ?? undefined,
      result: doc.result ?? undefined,
      createdAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
