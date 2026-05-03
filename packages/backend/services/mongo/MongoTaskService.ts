import type { ITaskPersistence, TaskData } from "@ping/agent-manager/src/orchestrator/contracts/index.js";
import { rootLogger } from "../../logging/index.js";

const logger = rootLogger.child({ module: "MongoTaskService" });

export class MongoTaskService implements ITaskPersistence {
  private async getModel() {
    return import("./schemas/TaskSchema.js").then((m) => m.TaskModel);
  }

  async saveTasks(goalId: string, teamId: string, tasks: TaskData[]): Promise<void> {
    const TaskModel = await this.getModel();
    const docs = tasks.map((t) => ({
      taskId: t.taskId,
      goalId,
      teamId,
      title: t.title || t.description?.slice(0, 80),
      description: t.description,
      status: t.status || "pending",
      assignedRole: t.assignedRole,
      priority: t.priority ?? 3,
      output: t.output,
      planId: t.planId,
      dependencies: t.dependencies || [],
    }));

    try {
      await TaskModel.bulkWrite(
        docs.map((doc) => ({
          updateOne: {
            filter: { teamId: doc.teamId, taskId: doc.taskId },
            update: { $set: doc },
            upsert: true,
          },
        })),
      );
      logger.info(`Saved ${tasks.length} tasks for goal ${goalId}`);
    } catch (err) {
      logger.error({ err, goalId }, "Failed to save tasks");
    }
  }

  async updateTaskStatus(taskId: string, goalId: string, status: string, output?: unknown): Promise<void> {
    const TaskModel = await this.getModel();
    try {
      const update: Record<string, any> = { status };
      if (output !== undefined) update.output = output;
      const result = await TaskModel.findOneAndUpdate({ taskId, goalId }, { $set: update });
      if (!result) {
        logger.warn({ taskId, goalId, status }, "updateTaskStatus: no matching task in DB");
      }
    } catch (err) {
      logger.error({ err, taskId, goalId, status }, "Failed to update task status");
    }
  }

  async getTasksByGoal(goalId: string): Promise<TaskData[]> {
    const TaskModel = await this.getModel();
    const docs = await TaskModel.find({ goalId }).lean();
    return docs.map(this.toTaskData);
  }

  async getTasksByTeam(teamId: string): Promise<TaskData[]> {
    const TaskModel = await this.getModel();
    const docs = await TaskModel.find({ teamId }).lean();
    return docs.map(this.toTaskData);
  }

  async clearTasksByGoal(goalId: string): Promise<void> {
    const TaskModel = await this.getModel();
    try {
      const result = await TaskModel.deleteMany({ goalId });
      logger.info(`Cleared ${result.deletedCount} tasks for goal ${goalId}`);
    } catch (err) {
      logger.error({ err, goalId }, "Failed to clear tasks");
    }
  }

  private toTaskData(doc: any): TaskData {
    return {
      taskId: doc.taskId,
      goalId: doc.goalId,
      teamId: doc.teamId,
      title: doc.title,
      description: doc.description,
      status: doc.status,
      assignedRole: doc.assignedRole,
      priority: doc.priority,
      output: doc.output,
      planId: doc.planId,
      dependencies: doc.dependencies || [],
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}
