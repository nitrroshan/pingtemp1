/**
 * MemoryManager RoleTaskQueue Integration Tests
 * Tests event emission, auto-queuing dependents, and priority ordering
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { MemoryManager } from "../MemoryManager.js";
import type { Task } from "../types/index.js";

describe("MemoryManager with RoleTaskQueue Integration", () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    memoryManager = new MemoryManager();
  });

  describe("Event Emission", () => {
    it("should emit task:available when ready task is added", async () => {
      const task: Task = {
        id: "task-1",
        description: "Test task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      const eventPromise = new Promise<void>((resolve) => {
        memoryManager.taskQueue.on(
          "task:available",
          ({ role, taskId }: { role: string; taskId: string }) => {
            expect(role).toBe("backend");
            expect(taskId).toBe("task-1");
            resolve();
          },
        );
      });

      memoryManager.addTask(task);
      await eventPromise;
    });

    it("should emit task:complete when task is completed", async () => {
      const task: Task = {
        id: "task-1",
        description: "Test task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      memoryManager.addTask(task);

      const eventPromise = new Promise<void>((resolve) => {
        memoryManager.taskQueue.on(
          "task:complete",
          ({ taskId, output }: { taskId: string; output: any }) => {
            expect(taskId).toBe("task-1");
            expect(output).toEqual({ result: "success" });
            resolve();
          },
        );
      });

      memoryManager.completeTask("task-1", { result: "success" });
      await eventPromise;
    });

    it("should NOT emit task:available for tasks with pending prerequisites", () => {
      const eventSpy = mock();

      const task: Task = {
        id: "task-2",
        description: "Dependent task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map([["task-1", false]]), // Not completed
        dependants: [],
      };

      memoryManager.taskQueue.on("task:available", eventSpy);
      memoryManager.addTask(task);

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe("Auto-queue Dependents", () => {
    it("should auto-queue dependent task when prerequisite completes (0ms latency)", async () => {
      const task1: Task = {
        id: "task-1",
        description: "Parent task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: ["task-2"],
      };

      const task2: Task = {
        id: "task-2",
        description: "Dependent task",
        assigned_role: "frontend",
        status: "pending",
        prerequisites: new Map([["task-1", false]]),
        dependants: [],
      };

      const events: Array<{ taskId: string; role: string }> = [];
      const eventPromise = new Promise<void>((resolve) => {
        memoryManager.taskQueue.on(
          "task:available",
          ({ taskId, role }: { taskId: string; role: string }) => {
            events.push({ taskId, role });

            // Resolve after second event
            if (events.length === 2) {
              resolve();
            }
          },
        );
      });

      // Add tasks AND complete task-1 AFTER listener is registered
      memoryManager.addTask(task1);
      memoryManager.addTask(task2);

      // Wait for first event (task-1)
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Complete task-1, which should trigger task-2
      memoryManager.completeTask("task-1", { data: "result" });

      await eventPromise;

      // Verify events
      expect(events).toHaveLength(2);
      expect(events[0]?.taskId).toBe("task-1");
      expect(events[0]?.role).toBe("backend");
      expect(events[1]?.taskId).toBe("task-2");
      expect(events[1]?.role).toBe("frontend");
    });

    it("should auto-queue multiple dependents when prerequisites complete", async () => {
      const task1: Task = {
        id: "task-1",
        description: "Parent task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: ["task-2", "task-3"],
      };

      const task2: Task = {
        id: "task-2",
        description: "Dependent 1",
        assigned_role: "frontend",
        status: "pending",
        prerequisites: new Map([["task-1", false]]),
        dependants: [],
      };

      const task3: Task = {
        id: "task-3",
        description: "Dependent 2",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map([["task-1", false]]),
        dependants: [],
      };

      const queuedTasks = new Set<string>();
      const eventPromise = new Promise<void>((resolve) => {
        memoryManager.taskQueue.on(
          "task:available",
          ({ taskId }: { taskId: string }) => {
            queuedTasks.add(taskId);

            // Both dependents should be queued
            if (queuedTasks.has("task-2") && queuedTasks.has("task-3")) {
              resolve();
            }
          },
        );
      });

      // Add tasks AFTER listener is registered
      memoryManager.addTask(task1);
      memoryManager.addTask(task2);
      memoryManager.addTask(task3);

      // Wait for task-1 to be queued
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Complete task-1 AFTER all tasks are added
      memoryManager.completeTask("task-1", { data: "result" });

      await eventPromise;

      expect(queuedTasks.size).toBe(3); // task-1, task-2, task-3
    });
  });

  describe("Priority Ordering", () => {
    it("should respect priority field when queuing tasks", () => {
      const highPriorityTask: Task = {
        id: "high",
        description: "High priority",
        assigned_role: "backend",
        priority: -10, // Higher priority
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      const normalTask: Task = {
        id: "normal",
        description: "Normal priority",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      const lowPriorityTask: Task = {
        id: "low",
        description: "Low priority",
        assigned_role: "backend",
        priority: 10, // Lower priority
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      // Add in reverse priority order
      memoryManager.addTask(lowPriorityTask);
      memoryManager.addTask(normalTask);
      memoryManager.addTask(highPriorityTask);

      const metrics = memoryManager.getMetrics();
      expect(metrics.tasksQueued).toBe(3);
      expect(metrics.queueSizes["backend"]).toBe(3);
    });
  });

  describe("Helper Methods (v1.1)", () => {
    it("should get single task by ID", () => {
      const task: Task = {
        id: "task-1",
        description: "Test task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      memoryManager.addTask(task);
      const retrieved = memoryManager.getTask("task-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("task-1");
    });

    it("should get all tasks", () => {
      memoryManager.addTask({
        id: "task-1",
        description: "Task 1",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      });

      memoryManager.addTask({
        id: "task-2",
        description: "Task 2",
        assigned_role: "frontend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      });

      const allTasks = memoryManager.getAllTasks();
      expect(allTasks.length).toBe(2);
    });

    it("should bulk add tasks via storeTasks", () => {
      const tasks: Task[] = [
        {
          id: "task-1",
          description: "Task 1",
          assigned_role: "backend",
          status: "pending",
          prerequisites: new Map(),
          dependants: [],
        },
        {
          id: "task-2",
          description: "Task 2",
          assigned_role: "frontend",
          status: "pending",
          prerequisites: new Map(),
          dependants: [],
        },
      ];

      memoryManager.storeTasks(tasks);
      expect(memoryManager.getAllTasks().length).toBe(2);
    });

    it("should get task context with dependency outputs", () => {
      const task1: Task = {
        id: "task-1",
        description: "Parent task",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: ["task-2"],
      };

      const task2: Task = {
        id: "task-2",
        description: "Dependent task",
        assigned_role: "frontend",
        status: "pending",
        prerequisites: new Map([["task-1", false]]),
        dependants: [],
      };

      memoryManager.addTask(task1);
      memoryManager.addTask(task2);
      memoryManager.completeTask("task-1", { data: "result" });

      const context = memoryManager.getTaskContext("task-2");
      expect(context).toBeDefined();
      expect(context?.dependencyOutputs.length).toBe(1);
      expect(context?.dependencyOutputs[0].output).toEqual({ data: "result" });
    });

    it("should get queue metrics", () => {
      memoryManager.addTask({
        id: "task-1",
        description: "Task 1",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      });

      const metrics = memoryManager.getMetrics();
      expect(metrics.tasksQueued).toBe(1);
      expect(metrics.queueSizes["backend"]).toBe(1);
    });
  });

  describe("Backward Compatibility", () => {
    it("should still work with existing getTasks API", () => {
      memoryManager.addTask({
        id: "task-1",
        description: "Task 1",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      });

      const backendTasks = memoryManager.getTasks("backend");
      expect(backendTasks.length).toBe(1);
      expect(backendTasks[0]?.id).toBe("task-1");
    });

    it("should handle tasks without priority field", () => {
      const taskWithoutPriority: Task = {
        id: "task-1",
        description: "No priority",
        assigned_role: "backend",
        status: "pending",
        prerequisites: new Map(),
        dependants: [],
      };

      expect(() => memoryManager.addTask(taskWithoutPriority)).not.toThrow();
    });
  });
});
