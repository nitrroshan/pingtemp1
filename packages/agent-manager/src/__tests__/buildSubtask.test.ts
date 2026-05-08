/**
 * buildSubtask — unit tests.
 *
 * Focus: rollback invariants. The helper is the SHARED implementation
 * behind both the legacy `request_task` tool branch and the new
 * `GoalManagerOrchestratorAdapter.createSubtask`. Two ways the helper can
 * fail AFTER persisting the new task:
 *   1. blocks-me cycle detected → rollback existing in original code
 *   2. DAG rebuild throws → rollback added May 9 2026 (review fix #2)
 * Both paths must leave the store EMPTY of the new task.
 */

import { describe, it, expect } from "bun:test";
import { buildSubtask } from "../orchestrator/buildSubtask.js";

interface FakeTask {
  id: string;
  status: string;
  prerequisites: Map<string, boolean>;
  goalId?: string;
}

function makeFakeTaskStore(initial: FakeTask[] = []) {
  const map = new Map<string, FakeTask>(initial.map((t) => [t.id, t]));
  return {
    map,
    get: (id: string) => map.get(id),
    getByGoal: (gid: string) => Array.from(map.values()).filter((t) => t.goalId === gid),
    getAll: () => Array.from(map.values()),
    create: async (t: any) => { map.set(t.id, t); },
    remove: (id: string) => map.delete(id),
    updateStatus: async (id: string, s: string) => {
      const t = map.get(id);
      if (t) t.status = s;
    },
    addPrerequisite: async (parentId: string, prereqId: string) => {
      const p = map.get(parentId);
      if (p) p.prerequisites.set(prereqId, false);
    },
  };
}

describe("buildSubtask", () => {
  it("happy path: persists new task + rebuilds DAG + returns accepted", async () => {
    const taskStore = makeFakeTaskStore([
      { id: "g-task-1", status: "in_progress", prerequisites: new Map(), goalId: "g" },
    ]);
    let rebuilds = 0;
    const dagResolver = { rebuild: () => { rebuilds++; } };

    const result = await buildSubtask(
      {
        createdBy: "agent:dev",
        parentTaskId: "g-task-1",
        goalId: "g",
        description: "do thing",
        assignedRole: "qa",
        priority: 3,
        relationship: "independent",
      },
      { taskStore, dagResolver },
    );

    expect(result).toEqual({ accepted: true, newTaskId: "g-task-2" });
    expect(taskStore.map.has("g-task-2")).toBe(true);
    expect(rebuilds).toBe(1);
  });

  it("rolls back the new task when blocks-me would create a cycle", async () => {
    const parent = { id: "g-task-1", status: "in_progress", prerequisites: new Map(), goalId: "g" };
    const taskStore = makeFakeTaskStore([parent]);
    const dagResolver = {
      rebuild: () => {},
      validateDependencies: () => "cycle: g-task-2 → g-task-1 → g-task-2",
    };

    const result = await buildSubtask(
      {
        createdBy: "agent:dev",
        parentTaskId: "g-task-1",
        goalId: "g",
        description: "circular",
        assignedRole: "qa",
        priority: 3,
        relationship: "blocks-me",
      },
      { taskStore, dagResolver },
    );

    expect(result.accepted).toBe(false);
    if (result.accepted === false) {
      expect(result.reason).toMatch(/cycle/);
    }
    // Rollback invariant: store must NOT retain the new task.
    expect(taskStore.map.has("g-task-2")).toBe(false);
  });

  it("rolls back the new task when DAG rebuild throws (May 9 2026 review fix #2)", async () => {
    const taskStore = makeFakeTaskStore([
      { id: "g-task-1", status: "in_progress", prerequisites: new Map(), goalId: "g" },
    ]);
    const dagResolver = {
      rebuild: () => { throw new Error("dag corrupt"); },
    };

    const result = await buildSubtask(
      {
        createdBy: "agent:dev",
        parentTaskId: "g-task-1",
        goalId: "g",
        description: "x",
        assignedRole: "qa",
        priority: 3,
        relationship: "independent",
      },
      { taskStore, dagResolver },
    );

    expect(result.accepted).toBe(false);
    if (result.accepted === false) {
      expect(result.reason).toBe("dag corrupt");
    }
    // The whole point of the fix: NO orphaned task left behind.
    expect(taskStore.map.has("g-task-2")).toBe(false);
  });

  it("rolls back the new task when per-goal DAG rebuild throws", async () => {
    const taskStore = makeFakeTaskStore([
      { id: "g-task-1", status: "in_progress", prerequisites: new Map(), goalId: "g" },
    ]);
    const dagResolver = {
      rebuild: () => {},
      rebuildForGoal: () => { throw new Error("goal dag corrupt"); },
    };

    const result = await buildSubtask(
      {
        createdBy: "agent:dev",
        parentTaskId: "g-task-1",
        goalId: "g",
        description: "x",
        assignedRole: "qa",
        priority: 3,
        relationship: "independent",
      },
      { taskStore, dagResolver },
    );

    expect(result.accepted).toBe(false);
    expect(taskStore.map.has("g-task-2")).toBe(false);
  });
});
