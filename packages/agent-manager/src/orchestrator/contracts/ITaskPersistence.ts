/**
 * ITaskPersistence — database persistence contract for tasks.
 * Defined in agent-manager (DIP: no Mongo/SQLite dependency).
 * Implemented by MongoTaskService / SqliteTaskService in backend.
 */

export interface TaskData {
  taskId: string;
  goalId: string;
  teamId: string;
  title?: string;
  description: string;
  status: string;
  assignedRole: string;
  priority?: number;
  output?: unknown;
  planId?: string;
  dependencies?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ITaskPersistence {
  /** Bulk-insert tasks (plan approval, add_tasks tool) */
  saveTasks(goalId: string, teamId: string, tasks: TaskData[]): Promise<void>;
  /** Update a single task's status + optional output (scoped by goalId for safety) */
  updateTaskStatus(taskId: string, goalId: string, status: string, output?: unknown): Promise<void>;
  /** Get all tasks for a goal */
  getTasksByGoal(goalId: string): Promise<TaskData[]>;
  /** Get all tasks for a team */
  getTasksByTeam(teamId: string): Promise<TaskData[]>;
  /** Delete all tasks for a goal (replan) */
  clearTasksByGoal(goalId: string): Promise<void>;
  /** Delete tasks from previous plans, keeping only current planId (atomic approval) */
  clearStaleTasks(goalId: string, currentPlanId: string): Promise<void>;
}
