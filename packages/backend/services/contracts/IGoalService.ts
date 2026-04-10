import type { Goal } from "../types/index.js";

export interface IGoalService {
  addGoal(goal: Omit<Goal, "id" | "createdAt" | "updatedAt">): Promise<Goal>;
  getGoals(teamId: string, options?: { limit?: number }): Promise<Goal[]>;
  updateGoal(goalId: string, updates: Partial<Goal>): Promise<Goal | null>;
}
