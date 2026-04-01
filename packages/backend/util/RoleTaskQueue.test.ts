/**
 * RoleTaskQueue Unit Tests
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { RoleTaskQueue } from "./RoleTaskQueue.js";
import type { TaskWithContext } from "./RoleTaskQueue.types.js";

describe("RoleTaskQueue", () => {
  let queue: RoleTaskQueue;

  const createTask = (
    id: string,
    role: string,
    priority: number = 0,
  ): TaskWithContext => ({
    id,
    description: `Task ${id}`,
    assigned_role: role,
    priority,
    context: {
      previousOutputs: [],
      artifacts: [],
    },
    createdAt: Date.now(),
    status: "queued",
  });

  beforeEach(() => {
    queue = new RoleTaskQueue();
  });

  describe("queueTask", () => {
    it("should add task to the queue", () => {
      const task = createTask("task-1", "writer");
      queue.queueTask(task);

      expect(queue.getQueueSize("writer")).toBe(1);
      expect(queue.getTask("task-1")).toBeDefined();
    });

    it("should throw if task ID already exists", () => {
      const task = createTask("task-1", "writer");
      queue.queueTask(task);

      expect(() => queue.queueTask(task)).toThrow("already exists");
    });

    it("should normalize role to lowercase", () => {
      const task = createTask("task-1", "WRITER");
      queue.queueTask(task);

      expect(queue.getQueueSize("writer")).toBe(1);
      expect(queue.hasTasksFor("writer")).toBe(true);
    });

    it("should set status to queued", () => {
      const task = createTask("task-1", "writer");
      task.status = "in_progress"; // should be overwritten
      queue.queueTask(task);

      expect(queue.getTask("task-1")!.status).toBe("queued");
    });
  });

  describe("poll", () => {
    it("should return and remove highest priority task", () => {
      queue.queueTask(createTask("low", "writer", 10));
      queue.queueTask(createTask("high", "writer", 1));

      const task = queue.poll("writer");

      expect(task!.id).toBe("high");
      expect(queue.getQueueSize("writer")).toBe(1);
    });

    it("should return undefined for empty role queue", () => {
      expect(queue.poll("writer")).toBeUndefined();
    });

    it("should return undefined for unknown role", () => {
      queue.queueTask(createTask("task-1", "writer"));

      expect(queue.poll("editor")).toBeUndefined();
    });

    it("should set task status to in_progress", () => {
      queue.queueTask(createTask("task-1", "writer"));

      const task = queue.poll("writer");

      expect(task!.status).toBe("in_progress");
    });

    it("should normalize role to lowercase", () => {
      queue.queueTask(createTask("task-1", "writer"));

      const task = queue.poll("WRITER");

      expect(task!.id).toBe("task-1");
    });
  });

  describe("peek", () => {
    it("should return task without removing", () => {
      queue.queueTask(createTask("task-1", "writer"));

      const task1 = queue.peek("writer");
      const task2 = queue.peek("writer");

      expect(task1!.id).toBe("task-1");
      expect(task2!.id).toBe("task-1");
      expect(queue.getQueueSize("writer")).toBe(1);
    });

    it("should return undefined for empty queue", () => {
      expect(queue.peek("writer")).toBeUndefined();
    });
  });

  describe("completeTask", () => {
    it("should mark task as completed", () => {
      queue.queueTask(createTask("task-1", "writer"));
      queue.poll("writer");

      queue.completeTask("task-1", { result: "done" });

      expect(queue.getTask("task-1")!.status).toBe("completed");
    });

    it("should throw for unknown task", () => {
      expect(() => queue.completeTask("unknown", {})).toThrow("not found");
    });

    it("should update metrics", () => {
      queue.queueTask(createTask("task-1", "writer"));
      queue.poll("writer");
      queue.completeTask("task-1", {});

      const metrics = queue.getMetrics();
      expect(metrics.tasksCompleted).toBe(1);
    });
  });

  describe("failTask", () => {
    it("should mark task as failed", () => {
      queue.queueTask(createTask("task-1", "writer"));
      queue.poll("writer");

      queue.failTask("task-1", "Something went wrong");

      expect(queue.getTask("task-1")!.status).toBe("failed");
    });

    it("should throw for unknown task", () => {
      expect(() => queue.failTask("unknown", "error")).toThrow("not found");
    });

    it("should update metrics", () => {
      queue.queueTask(createTask("task-1", "writer"));
      queue.poll("writer");
      queue.failTask("task-1", "error");

      const metrics = queue.getMetrics();
      expect(metrics.tasksFailed).toBe(1);
    });
  });

  describe("events", () => {
    it("should emit task:available when task is queued", () => {
      const handler = mock();
      queue.on("task:available", handler);

      queue.queueTask(createTask("task-1", "writer"));

      expect(handler).toHaveBeenCalledWith({
        role: "writer",
        taskId: "task-1",
      });
    });

    it("should emit task:complete when task completes", () => {
      const handler = mock();
      queue.on("task:complete", handler);

      queue.queueTask(createTask("task-1", "writer"));
      queue.poll("writer");
      queue.completeTask("task-1", { data: "result" });

      expect(handler).toHaveBeenCalledWith({
        taskId: "task-1",
        output: { data: "result" },
      });
    });

    it("should emit task:failed when task fails", () => {
      const handler = mock();
      queue.on("task:failed", handler);

      queue.queueTask(createTask("task-1", "writer"));
      queue.poll("writer");
      queue.failTask("task-1", "Something broke");

      expect(handler).toHaveBeenCalledWith({
        taskId: "task-1",
        error: "Something broke",
      });
    });

    it("should allow unsubscribing from events", () => {
      const handler = mock();
      queue.on("task:available", handler);
      queue.off("task:available", handler);

      queue.queueTask(createTask("task-1", "writer"));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("role isolation", () => {
    it("should maintain separate queues per role", () => {
      queue.queueTask(createTask("w1", "writer"));
      queue.queueTask(createTask("w2", "writer"));
      queue.queueTask(createTask("e1", "editor"));

      expect(queue.getQueueSize("writer")).toBe(2);
      expect(queue.getQueueSize("editor")).toBe(1);

      const writerTask = queue.poll("writer");
      expect(writerTask!.id).toBe("w1");
      expect(queue.getQueueSize("writer")).toBe(1);
      expect(queue.getQueueSize("editor")).toBe(1);
    });
  });

  describe("getRoles", () => {
    it("should return all roles with queues", () => {
      queue.queueTask(createTask("w1", "writer"));
      queue.queueTask(createTask("e1", "editor"));
      queue.queueTask(createTask("r1", "researcher"));

      const roles = queue.getRoles();

      expect(roles).toContain("writer");
      expect(roles).toContain("editor");
      expect(roles).toContain("researcher");
      expect(roles.length).toBe(3);
    });
  });

  describe("metrics", () => {
    it("should track queue sizes", () => {
      queue.queueTask(createTask("w1", "writer"));
      queue.queueTask(createTask("w2", "writer"));
      queue.queueTask(createTask("e1", "editor"));

      const metrics = queue.getMetrics();

      expect(metrics.queueSizes["writer"]).toBe(2);
      expect(metrics.queueSizes["editor"]).toBe(1);
      expect(metrics.tasksQueued).toBe(3);
    });

    it("should track completion count", () => {
      queue.queueTask(createTask("t1", "writer"));
      queue.queueTask(createTask("t2", "writer"));
      queue.poll("writer");
      queue.poll("writer");
      queue.completeTask("t1", {});
      queue.completeTask("t2", {});

      expect(queue.getMetrics().tasksCompleted).toBe(2);
    });
  });

  describe("clear", () => {
    it("should remove all tasks and reset metrics", () => {
      queue.queueTask(createTask("t1", "writer"));
      queue.queueTask(createTask("t2", "editor"));

      queue.clear();

      expect(queue.getQueueSize("writer")).toBe(0);
      expect(queue.getQueueSize("editor")).toBe(0);
      expect(queue.getRoles().length).toBe(0);
      expect(queue.getMetrics().tasksQueued).toBe(0);
    });
  });

  describe("updatePriority", () => {
    it("should update priority of a queued task", () => {
      queue.queueTask(createTask("t1", "writer", 10));
      queue.queueTask(createTask("t2", "writer", 5));

      const updated = queue.updatePriority("t1", 1);

      expect(updated).toBe(true);
      // t1 should now be polled first (priority 1 < 5)
      const polled = queue.poll("writer");
      expect(polled!.id).toBe("t1");
    });

    it("should return false for non-existent task", () => {
      const updated = queue.updatePriority("nonexistent", 5);

      expect(updated).toBe(false);
    });

    it("should return false for in_progress task", () => {
      queue.queueTask(createTask("t1", "writer"));
      queue.poll("writer"); // status becomes in_progress

      const updated = queue.updatePriority("t1", 1);

      expect(updated).toBe(false);
    });

    it("should return false for completed task", () => {
      queue.queueTask(createTask("t1", "writer"));
      queue.poll("writer");
      queue.completeTask("t1", {});

      const updated = queue.updatePriority("t1", 1);

      expect(updated).toBe(false);
    });

    it("should return false for failed task", () => {
      queue.queueTask(createTask("t1", "writer"));
      queue.poll("writer");
      queue.failTask("t1", "error");

      const updated = queue.updatePriority("t1", 1);

      expect(updated).toBe(false);
    });

    it("should affect subsequent poll order", () => {
      queue.queueTask(createTask("low", "writer", 10));
      queue.queueTask(createTask("medium", "writer", 5));
      queue.queueTask(createTask("high", "writer", 1));

      // Promote "low" to highest priority
      queue.updatePriority("low", 0);

      expect(queue.poll("writer")!.id).toBe("low");
      expect(queue.poll("writer")!.id).toBe("high");
      expect(queue.poll("writer")!.id).toBe("medium");
    });

    it("should update the task priority property", () => {
      queue.queueTask(createTask("t1", "writer", 10));

      queue.updatePriority("t1", 3);

      const task = queue.getTask("t1");
      expect(task!.priority).toBe(3);
    });
  });
});
