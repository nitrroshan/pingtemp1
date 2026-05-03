import { Database } from "bun:sqlite";
import type { ITaskPersistence, TaskData } from "@ping/agent-manager/src/orchestrator/contracts/index.js";

export class SqliteTaskService implements ITaskPersistence {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        taskId TEXT NOT NULL,
        goalId TEXT NOT NULL,
        teamId TEXT NOT NULL,
        title TEXT,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        assignedRole TEXT NOT NULL,
        priority INTEGER,
        output TEXT,
        planId TEXT,
        dependencies TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (teamId, goalId, taskId)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goalId, updatedAt);
      CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(teamId, updatedAt);
    `);
  }

  async saveTasks(goalId: string, teamId: string, tasks: TaskData[]): Promise<void> {
    const now = new Date().toISOString();
    const upsert = this.db.query(`
      INSERT INTO tasks (
        taskId, goalId, teamId, title, description, status, assignedRole,
        priority, output, planId, dependencies, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(teamId, goalId, taskId) DO UPDATE SET
        goalId = excluded.goalId,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        assignedRole = excluded.assignedRole,
        priority = excluded.priority,
        output = excluded.output,
        planId = excluded.planId,
        dependencies = excluded.dependencies,
        updatedAt = excluded.updatedAt
    `);

    const transaction = this.db.transaction((entries: TaskData[]) => {
      for (const task of entries) {
        upsert.run(
          task.taskId,
          goalId,
          teamId,
          task.title ?? task.description.slice(0, 80),
          task.description,
          task.status,
          task.assignedRole,
          task.priority ?? 3,
          task.output !== undefined ? JSON.stringify(task.output) : null,
          task.planId ?? null,
          JSON.stringify(task.dependencies ?? []),
          task.createdAt ?? now,
          now,
        );
      }
    });

    transaction(tasks);
  }

  async updateTaskStatus(taskId: string, goalId: string, status: string, output?: unknown): Promise<void> {
    const row = this.db.query(`SELECT output FROM tasks WHERE taskId = ? AND goalId = ?`).get(taskId, goalId) as { output: string | null } | null;
    const nextOutput = output !== undefined ? JSON.stringify(output) : row?.output ?? null;
    this.db.run(
      `UPDATE tasks SET status = ?, output = ?, updatedAt = ? WHERE taskId = ? AND goalId = ?`,
      [status, nextOutput, new Date().toISOString(), taskId, goalId],
    );
  }

  async getTasksByGoal(goalId: string): Promise<TaskData[]> {
    const rows = this.db.query(`SELECT * FROM tasks WHERE goalId = ? ORDER BY updatedAt ASC`).all(goalId) as any[];
    return rows.map((row) => this.toTaskData(row));
  }

  async getTasksByTeam(teamId: string): Promise<TaskData[]> {
    const rows = this.db.query(`SELECT * FROM tasks WHERE teamId = ? ORDER BY updatedAt ASC`).all(teamId) as any[];
    return rows.map((row) => this.toTaskData(row));
  }

  async clearTasksByGoal(goalId: string): Promise<void> {
    this.db.run(`DELETE FROM tasks WHERE goalId = ?`, [goalId]);
  }

  private toTaskData(row: any): TaskData {
    return {
      taskId: row.taskId,
      goalId: row.goalId,
      teamId: row.teamId,
      title: row.title ?? undefined,
      description: row.description,
      status: row.status,
      assignedRole: row.assignedRole,
      priority: row.priority ?? undefined,
      output: this.parseJson(row.output),
      planId: row.planId ?? undefined,
      dependencies: this.parseJson(row.dependencies) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private parseJson(value: string | null): any {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}