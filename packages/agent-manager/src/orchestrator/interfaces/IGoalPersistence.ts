/**
 * IGoalPersistence — Goal lifecycle persistence (MongoDB).
 *
 * Thin interface for goal CRUD.
 * Production: MongoGoalPersistence (wraps existing MongoGoalService).
 */

export interface IGoalPersistence {
  saveGoal(goal: {
    goalId: string;
    teamId: string;
    userId: string;
    goal: string;
    repoUrl?: string;
    repoBranch?: string;
  }): Promise<void>;

  updateGoalStatus(goalId: string, status: string): Promise<void>;

  getGoal(goalId: string): Promise<{
    goalId: string;
    teamId: string;
    status: string;
    repoUrl?: string;
    repoBranch?: string;
  } | null>;
}
