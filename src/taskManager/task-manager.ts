import { Redis } from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { decomposeTask } from "./llm";
import { Task, Subtask, TaskQueueItem } from "../../types/task";
import { Logger } from "tslog";

const logger = new Logger({ name: "TaskManager" });
/*
  * TaskManager handles task creation, decomposition, and subtask management.
  1) Creates a detailed task from user input.
  2) Decomposes the task into subtasks with dependencies.
  3) Validates dependencies and checks for cycles.
  * It uses Redis for task storage and queueing.
*/
export class TaskManager {
  private redis: Redis;

  constructor() {
    this.redis = new Redis();
  }
  // Validate dependencies and check for cycles
  private validateDependencies(subtasks: any[]): boolean {
    const validIds = new Set(subtasks.map((st) => st.id));
    for (const st of subtasks) {
      for (const depId of st.dependencies || []) {
        if (!validIds.has(depId)) {
          console.warn(`Invalid dependency: ${depId} in subtask ${st.id}`);
          return false;
        }
      }
    }
    return true;
  }

  private checkForCycles(subtasks: any[]): boolean {
    // Build graph (adjacency list)
    const graph = new Map<string, string[]>();
    const visited = new Map<string, boolean>();
    const recStack = new Map<string, boolean>();

    // Initialize graph nodes
    subtasks.forEach((st) => {
      graph.set(st.id, []);
      visited.set(st.id, false);
      recStack.set(st.id, false);
    });

    // Add edges (dependencies)
    subtasks.forEach((st) => {
      (st.dependencies || []).forEach((depId: string) => {
        graph.get(depId)?.push(st.id);
      });
    });

    // DFS cycle detection
    const hasCycle = (nodeId: string): boolean => {
      if (!visited.get(nodeId)) {
        visited.set(nodeId, true);
        recStack.set(nodeId, true);

        for (const neighbor of graph.get(nodeId) || []) {
          if (
            (!visited.get(neighbor) && hasCycle(neighbor)) ||
            recStack.get(neighbor)
          ) {
            return true;
          }
        }
      }
      recStack.set(nodeId, false);
      return false;
    };

    // Check all nodes
    for (const nodeId of graph.keys()) {
      if (hasCycle(nodeId)) {
        console.warn(
          `Task Manager: Dependency cycle detected involving: ${nodeId}`
        );
        return true;
      }
    }
    return false;
  }
  // Create a new task and decompose it
  async createTask(description: string): Promise<Task> {
    const taskId = `task_${uuidv4()}`;
    // Decompose the task into subtasks
    // Check subtasks for cycles and dependencies and ensure decompose again if needed
    let decomposition;
    let validDependencies = false;
    let hasCycles = true;

    do {
      decomposition = await decomposeTask(description);

      // Validate dependencies before cycle check
      validDependencies = this.validateDependencies(decomposition.subtasks);
      hasCycles =
        validDependencies && this.checkForCycles(decomposition.subtasks);
    } while (!validDependencies || hasCycles);

    // Map and create subtasks (with dependency validation)
    const idMap = new Map<string, string>();
    // Create unique IDs for subtasks and map dependencies
    decomposition.subtasks.forEach((st: any) => {
      const newId = `subtask_${uuidv4()}`;
      idMap.set(st.id, newId);
    });
    const subtasks: Subtask[] = decomposition.subtasks.map((st: any) => ({
      id: idMap.get(st.id),
      description: st.description,
      dependencies: (st.dependencies || [])
        .map((d: string) => idMap.get(d))
        .filter(Boolean) as string[], // Filter out invalid deps
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
    logger.info(
      `Task Manager: Task created for TaskId: ${task.id} Task: ${task.description} with ${subtasks.length} subtasks`
    );

    return task;
  }

  // Enqueue all initial subtasks
  private async enqueueSubtasks(task: Task): Promise<void> {
    // Only enqueue subtasks that have no dependencies
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

    logger.info(
      `Task Manager: Updating subtask ${subtaskId}: ${subtask.description} of task ${taskId}: ${task.description} to status ${status}`
    );

    subtask.status = status;
    subtask.updated_at = new Date();
    if (result) subtask.result = result;

    // Update task status based on subtasks
    if (status === "completed" || status === "failed") {
      const allCompleted = task.subtasks.every(
        (st) => st.status === "completed" || st.status === "failed"
      );
      logger.info(
        `Task Manager: Task ${task.id}: ${task.description} ${task.subtasks.length} subtasks completed: ${allCompleted}, task status will be updated`
      );
      if (allCompleted) {
        task.status = task.subtasks.some((st) => st.status === "failed")
          ? "failed"
          : "completed";
      } else {
        task.status = "in-progress";
        await this.enqueueDependentSubTasks(task, subtaskId);
        logger.info(
          `Task Manager: Enqueued dependent subtasks for ${subtaskId}: ${subtask.description}`
        );
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
      // Check if this subtask depends on the completed one
      if (subtask.dependencies.includes(subtaskId)) {
        logger.info(
          `Task Manager: subtask ${subtask.id}: ${subtask.description} depends on subtask ${subtaskId}: ${subtask.description} ?`
        );
        const allDependenciesCompleted = subtask.dependencies.every((depId) => {
          const dep = task.subtasks.find((st) => st.id === depId);
          return dep?.status === "completed";
        });
        if (allDependenciesCompleted && subtask.status === "pending") {
          logger.info(
            `Task Manager: subtask ${subtask.id}: ${subtask.description} enqueued for execution`
          );
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
