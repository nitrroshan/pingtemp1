import { Request, Response, Router } from "express";
import { TaskManager } from "./task-manager";
import { Task } from "./types";

const router = Router();
const taskManager = new TaskManager();

// Create new task
router.post("/tasks", async (req: Request, res: Response) => {
  try {
    const { description } = req.body;
    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }
    const task = await taskManager.createTask(description);
    res.json(task);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Get task status
router.get("/tasks/:id", async (req, res) => {
  try {
    const taskId = req.params.id;
    const taskJson = await taskManager.redis.get(`task:${taskId}`);

    if (!taskJson) {
      return res.status(404).json({ error: "Task not found" });
    }

    const task: Task = JSON.parse(taskJson);
    res.json(task);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// List all tasks
router.get("/tasks", async (req, res) => {
  try {
    const keys = await taskManager.redis.keys("task:*");
    const tasks = await Promise.all(
      keys.map((key) => taskManager.redis.get(key).then(JSON.parse))
    );
    res.json(tasks);
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
