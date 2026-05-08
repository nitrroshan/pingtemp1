/**
 * GoalManagerOrchestratorAdapter tests — Phase 1.8a of the agent-stream-bus
 * refactor.
 *
 * Verifies the adapter satisfies AgentRuntimeOrchestrator by delegating to
 * the existing GoalManager + TaskStore + DependencyResolver. Uses small
 * fakes for the delegates so tests exercise the adapter in isolation.
 */

import { describe, it, expect } from "bun:test";
import { GoalManagerOrchestratorAdapter, type IGoalManagerLite, type ITaskStoreLite, type IDependencyResolverLite } from "../orchestrator/GoalManagerOrchestratorAdapter.js";
import type { StreamingAgentContext } from "../agent/streaming/types.js";

// =============================================================================
// Fakes
// =============================================================================

function makeGoalManager(): IGoalManagerLite & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async onWorkerDone(data) { calls.push({ kind: "done", data }); },
    async handleTaskFailure(taskId, reason) { calls.push({ kind: "fail", taskId, reason }); },
  };
}

function makeTaskStore(seed: any[] = []): ITaskStoreLite & { tasks: Map<string, any> } {
  const tasks = new Map<string, any>(seed.map((t) => [t.id, t]));
  return {
    tasks,
    get: (id) => tasks.get(id),
    getByGoal: (goalId) => Array.from(tasks.values()).filter((t) => t.goalId === goalId),
    create: async (t) => { tasks.set(t.id, t); },
    remove: (id) => tasks.delete(id),
    updateStatus: async (id, status) => {
      const t = tasks.get(id);
      if (t) t.status = status;
    },
    addPrerequisite: async (taskId, prereqId) => {
      const t = tasks.get(taskId);
      if (!t) return;
      if (!(t.prerequisites instanceof Map)) t.prerequisites = new Map();
      t.prerequisites.set(prereqId, false);
    },
  };
}

function makeDagResolver(opts: { cycleErr?: string } = {}): IDependencyResolverLite & { rebuilds: number; rebuildsForGoal: number } {
  return {
    rebuilds: 0,
    rebuildsForGoal: 0,
    rebuild() { this.rebuilds += 1; },
    rebuildForGoal() { this.rebuildsForGoal += 1; },
    validateDependencies: () => opts.cycleErr ?? null,
  };
}

const ctx: StreamingAgentContext = {
  teamId: "team-1",
  goalId: "goal-1",
  taskId: "task-parent",
  agentId: "dev",
};

// =============================================================================
// Tests
// =============================================================================

describe("GoalManagerOrchestratorAdapter", () => {
  // ---------- onWorkerDone ----------------------------------------------------

  it("onWorkerDone marks completionSource='tool' BEFORE delegating to GoalManager", async () => {
    const goalManager = makeGoalManager();
    const taskStore = makeTaskStore([{ id: "task-1", status: "in_progress", goalId: "g" }]);
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager,
      taskStore,
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });

    await adapter.onWorkerDone({
      taskId: "task-1",
      role: "dev",
      summary: "done",
      timestamp: Date.now(),
    });

    // Field set before delegate observed it.
    expect(taskStore.get("task-1").completionSource).toBe("tool");
    expect(goalManager.calls[0]).toMatchObject({ kind: "done", data: { taskId: "task-1", role: "dev" } });
  });

  it("onWorkerDone forwards full payload (producedDocs + decisions + nextSteps)", async () => {
    const goalManager = makeGoalManager();
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager,
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });

    await adapter.onWorkerDone({
      taskId: "task-1",
      role: "dev",
      summary: "done",
      deliverables: ["src/x.ts"],
      nextSteps: ["review"],
      producedDocs: [{ uri: "crdt:task-1/report", name: "r" }],
      decisions: [{ decision: "use postgres", rationale: "ACID" }],
      timestamp: 12345,
    });

    expect(goalManager.calls[0].data).toEqual({
      taskId: "task-1",
      role: "dev",
      summary: "done",
      deliverables: ["src/x.ts"],
      nextSteps: ["review"],
      producedDocs: [{ uri: "crdt:task-1/report", name: "r" }],
      decisions: [{ decision: "use postgres", rationale: "ACID" }],
      timestamp: 12345,
    });
  });

  // ---------- handleTaskFailure ----------------------------------------------

  it("handleTaskFailure forwards taskId + reason verbatim", async () => {
    const goalManager = makeGoalManager();
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager,
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });
    await adapter.handleTaskFailure("task-1", "no expertise");
    expect(goalManager.calls[0]).toEqual({ kind: "fail", taskId: "task-1", reason: "no expertise" });
  });

  // ---------- updateLastReportedStatus ---------------------------------------

  it("updateLastReportedStatus mutates the task field in-place", () => {
    const taskStore = makeTaskStore([{ id: "task-1", status: "in_progress" }]);
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore,
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });

    adapter.updateLastReportedStatus("task-1", "blocked");
    expect(taskStore.get("task-1").lastReportedStatus).toBe("blocked");
  });

  it("updateLastReportedStatus is a no-op when task missing", () => {
    const taskStore = makeTaskStore();
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore,
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });
    expect(() => adapter.updateLastReportedStatus("ghost", "blocked")).not.toThrow();
  });

  // ---------- createSubtask --------------------------------------------------

  it("createSubtask creates a goal-scoped sequential task, rebuilds DAG, returns newTaskId", async () => {
    const taskStore = makeTaskStore([
      { id: "task-parent", status: "in_progress", goalId: "goal-1", prerequisites: new Map() },
      { id: "abcdef12-task-3", status: "completed", goalId: "goal-1", prerequisites: new Map() },
    ]);
    const dag = makeDagResolver();
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore,
      dagResolver: dag,
      notifyTaskCreated: async () => {},
    });

    const ack = await adapter.createSubtask(
      {
        description: "Write tests",
        title: "Tests",
        assignedRole: "qa",
        priority: 3,
        type: "work",
        relationship: "independent",
        goalId: "goal-1",
        planId: "plan-1",
      },
      ctx,
    );

    expect(ack.accepted).toBe(true);
    expect(ack.newTaskId).toMatch(/^goal-1-task-\d+$/); // 8-char prefix of "goal-1"
    const created = taskStore.get(ack.newTaskId!);
    expect(created).toBeDefined();
    expect(created.assigned_role).toBe("qa");
    expect(created.priority).toBe(3);
    expect(created.context.title).toBe("Tests");
    expect(created.context.createdBy).toBe("agent:dev");
    expect(dag.rebuildsForGoal).toBe(1);
  });

  it("createSubtask sets dependants[parent] for blocks-me and adds parent prerequisite", async () => {
    const parent = { id: "task-parent", status: "in_progress", goalId: "goal-1", prerequisites: new Map() };
    const taskStore = makeTaskStore([parent]);
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore,
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });

    const ack = await adapter.createSubtask(
      {
        description: "Block on infra",
        assignedRole: "infra",
        relationship: "blocks-me",
        goalId: "goal-1",
      },
      ctx,
    );

    expect(ack.accepted).toBe(true);
    const created = taskStore.get(ack.newTaskId!);
    expect(created.dependants).toEqual(["task-parent"]);
    // Parent gained the new task as a prerequisite.
    expect(parent.prerequisites.has(ack.newTaskId!)).toBe(true);
  });

  it("createSubtask rolls back the new task and rejects when blocks-me would create a cycle", async () => {
    const parent = { id: "task-parent", status: "in_progress", goalId: "goal-1", prerequisites: new Map() };
    const taskStore = makeTaskStore([parent]);
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore,
      dagResolver: makeDagResolver({ cycleErr: "would cycle through task-x" }),
      notifyTaskCreated: async () => {},
    });

    const ack = await adapter.createSubtask(
      {
        description: "Cycle attempt",
        assignedRole: "qa",
        relationship: "blocks-me",
        goalId: "goal-1",
      },
      ctx,
    );

    expect(ack.accepted).toBe(false);
    expect(ack.reason).toMatch(/cycle/);
    // Newly-created task removed from store.
    expect(Array.from(taskStore.tasks.values()).filter((t) => t.id !== "task-parent")).toHaveLength(0);
    // Parent untouched.
    expect(parent.prerequisites.size).toBe(0);
  });

  it("createSubtask returns accepted:false when assignedRole missing", async () => {
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });
    const ack = await adapter.createSubtask({ description: "no role" }, ctx);
    expect(ack.accepted).toBe(false);
    expect(ack.reason).toMatch(/assignedRole is required/);
  });

  it("createSubtask returns accepted:false when ctx.taskId missing", async () => {
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });
    const noTaskCtx = { ...ctx, taskId: undefined } as StreamingAgentContext;
    const ack = await adapter.createSubtask(
      { description: "x", assignedRole: "qa" },
      noTaskCtx,
    );
    expect(ack.accepted).toBe(false);
    expect(ack.reason).toMatch(/parent ctx\.taskId is required/);
  });

  it("createSubtask uses dagResolver.rebuild as a fallback when rebuildForGoal is absent", async () => {
    const taskStore = makeTaskStore([
      { id: "task-parent", status: "in_progress", goalId: "goal-1", prerequisites: new Map() },
    ]);
    const dag: IDependencyResolverLite & { rebuilds: number } = {
      rebuilds: 0,
      rebuild() { this.rebuilds += 1; },
      validateDependencies: () => null,
      // rebuildForGoal intentionally omitted
    };
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore,
      dagResolver: dag,
      notifyTaskCreated: async () => {},
    });

    const ack = await adapter.createSubtask(
      { description: "x", assignedRole: "qa", goalId: "goal-1", relationship: "independent" },
      ctx,
    );
    expect(ack.accepted).toBe(true);
    expect(dag.rebuilds).toBe(1);
  });

  // ---------- notifyTaskCreated ----------------------------------------------

  it("notifyTaskCreated forwards to the injected delegate", async () => {
    const calls: any[] = [];
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async (data) => { calls.push(data); },
    });
    await adapter.notifyTaskCreated({
      taskId: "new-1",
      createdBy: "agent:dev",
      targetRole: "qa",
      relationship: "independent",
      parentTaskId: "task-parent",
    });
    expect(calls).toEqual([{
      taskId: "new-1",
      createdBy: "agent:dev",
      targetRole: "qa",
      relationship: "independent",
      parentTaskId: "task-parent",
    }]);
  });

  it("notifyTaskCreated with explicit no-op delegate resolves cleanly (test-friendly contract)", async () => {
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => {},
    });
    await expect(adapter.notifyTaskCreated({
      taskId: "n", createdBy: "a", targetRole: "b", relationship: "independent", parentTaskId: "p",
    })).resolves.toBeUndefined();
  });

  it("notifyTaskCreated swallows delegate errors (fire-and-forget; subtask must NOT roll back)", async () => {
    const adapter = new GoalManagerOrchestratorAdapter({
      goalManager: makeGoalManager(),
      taskStore: makeTaskStore(),
      dagResolver: makeDagResolver(),
      notifyTaskCreated: async () => { throw new Error("planner queue down"); },
    });
    await expect(adapter.notifyTaskCreated({
      taskId: "n", createdBy: "a", targetRole: "b", relationship: "independent", parentTaskId: "p",
    })).resolves.toBeUndefined();
  });
});
