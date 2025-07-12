import { Redis } from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { decomposeTask } from "./llm";
import { Task, Subtask, TaskQueueItem } from "../../types/task";

export class TaskManager {
  private redis: Redis;

  constructor() {
    this.redis = new Redis();
  }

  // Create a new task and decompose it
  async createTask(description: string): Promise<Task> {
    const taskId = `task_${uuidv4()}`;
    const decomposition = await decomposeTask(description);

    const subtasks: Subtask[] = decomposition.subtasks.map((st: any) => ({
      id: `subtask_${uuidv4()}`,
      description: st.description,
      dependencies: st.dependencies || [],
      requiredCapabilities: st.requiredCapabilities || [],
      agent_type: st.agent_type,
      status: "pending",
      created_at: new Date(),
      updated_at: new Date(),
    }));

    const task: Task = {
      id: taskId,
      description,
      subtasks,
      status: "pending",
      created_at: new Date(),
      updated_at: new Date(),
    };

    await this.redis.set(`task:${taskId}`, JSON.stringify(task));
    await this.enqueueSubtasks(task);

    return task;
  }

  // Enqueue all initial subtasks
  private async enqueueSubtasks(task: Task): Promise<void> {
    for (const subtask of task.subtasks) {
      if (subtask.dependencies.length === 0) {
        await this.enqueueSubtask(task.id, subtask.id);
      }
    }
  }

  // Add subtask to queue
  async enqueueSubtask(taskId: string, subtaskId: string): Promise<void> {
    const queueItem: TaskQueueItem = {
      subtask_id: subtaskId,
      task_id: taskId,
      enqueued_at: new Date(),
    };

    await this.redis.lpush("task_queue", JSON.stringify(queueItem));
  }

  // Check if subtask queue is empty
  async isSubtaskQueueEmpty(): Promise<boolean> {
    const length = await this.redis.llen("task_queue");
    return length === 0;
  }

  // Get next subtask from queue
  async getNextSubtask(): Promise<TaskQueueItem | null> {
    const item = await this.redis.rpop("task_queue");
    return item ? JSON.parse(item) : null;
  }

  // Update subtask status
  async updateSubtaskStatus(
    taskId: string,
    subtaskId: string,
    status: Subtask["status"],
    result?: any
  ): Promise<void> {
    const taskKey = `task:${taskId}`;
    const taskJson = await this.redis.get(taskKey);

    if (!taskJson) throw new Error("Task not found");

    const task: Task = JSON.parse(taskJson);
    const subtask = task.subtasks.find((st) => st.id === subtaskId);

    if (!subtask) throw new Error("Subtask not found");

    subtask.status = status;
    subtask.updated_at = new Date();
    if (result) subtask.result = result;

    // Update task status based on subtasks
    if (status === "completed" || status === "failed") {
      const allCompleted = task.subtasks.every(
        (st) => st.status === "completed" || st.status === "failed"
      );

      if (allCompleted) {
        task.status = task.subtasks.some((st) => st.status === "failed")
          ? "failed"
          : "completed";
      } else {
        task.status = "in-progress";
        await this.enqueueDependentSubTasks(task, subtaskId);
      }
    }

    await this.redis.set(taskKey, JSON.stringify(task));

    // Todo: If completed, enqueue dependent subtasks
  }

  // Enqueue subtasks that depend on this subtask
  private async enqueueDependentSubTasks(
    task: Task,
    subtaskId: string
  ): Promise<void> {
    for (const subtask of task.subtasks) {
      if (subtask.dependencies.includes(subtaskId)) {
        const allDependenciesCompleted = subtask.dependencies.every((depId) => {
          const dep = task.subtasks.find((st) => st.id === depId);
          return dep?.status === "completed";
        });

        if (allDependenciesCompleted && subtask.status === "pending") {
          await this.enqueueSubtask(task.id, subtask.id);
        }
      }
    }
  }

  // Get Subtask by ID
  public async getSubtaskById(
    taskId: string,
    subtaskId: string
  ): Promise<Subtask | null> {
    const task = await this.getTaskFromKey(`task:${taskId}`);
    if (!task) return null;
    return task.subtasks.find((st) => st.id === subtaskId) || null;
  }

  // Get a task by its Redis key
  public async getTaskFromKey(taskKey: string): Promise<Task | null> {
    const taskJson = await this.redis.get(taskKey);
    if (!taskJson) return null;
    return JSON.parse(taskJson);
  }
}
