/**
 * AgentRuntimeFactory tests — Phase 1.7 of the agent-stream-bus refactor.
 *
 * Verifies:
 *   - Wires composite onStreaming hooks (default + extras) onto the agent.
 *   - Wires onTaskLifecycle that delegates to the orchestrator.
 *   - Builds lifecycle tools (hooks-only since Patch #5; the
 *     `executionMode` flag was removed May 9 2026).
 *   - Composite hooks fan-out: every visitor sees every event.
 *   - Awaited finish/error: composite Promise.all over visitors.
 *   - onCompletePolicy can short-circuit before the orchestrator runs.
 *   - Throws when goalId is missing.
 */

import { describe, it, expect } from "bun:test";
import { AgentRuntimeFactory, type AgentRuntimeOrchestrator, type AgentRuntimeTaskServices } from "../agent/runtime/AgentRuntimeFactory.js";
import type {
  IStreamingAgent,
  StreamingAgentContext,
  StreamingHooks,
  TaskLifecycleHooks,
  TaskCompletePayload,
  AgentRunInput,
  AgentRunResult,
} from "../agent/streaming/types.js";

// =============================================================================
// Test doubles
// =============================================================================

class FakeAgent implements IStreamingAgent {
  readonly id = "fake-agent";
  readonly name = "Fake Agent";
  readonly role = "tester";
  onStreaming?: StreamingHooks;
  onTaskLifecycle?: TaskLifecycleHooks;
  async runWithHooks(_input: AgentRunInput): Promise<AgentRunResult> {
    return { text: "" };
  }
}

function makeOrchestrator(): AgentRuntimeOrchestrator & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async onWorkerDone(data) { calls.push({ kind: "done", data }); },
    async handleTaskFailure(taskId, reason) { calls.push({ kind: "fail", taskId, reason }); },
    async createSubtask(payload) {
      calls.push({ kind: "subtask", payload });
      return { accepted: true, newTaskId: "orchestrator-id" };
    },
    updateLastReportedStatus(taskId, status) { calls.push({ kind: "status", taskId, status }); },
    async notifyTaskCreated(data) { calls.push({ kind: "notify", data }); },
  };
}

function makeTaskServices(): AgentRuntimeTaskServices {
  const tasks = new Map<string, any>([
    ["task-1", { id: "task-1", status: "in_progress" }],
  ]);
  return {
    taskStore: {
      get: (id: string) => tasks.get(id),
      getByGoal: () => Array.from(tasks.values()),
      getAll: () => Array.from(tasks.values()),
      create: async (t: any) => { tasks.set(t.id, t); },
      remove: (id: string) => tasks.delete(id),
      updateStatus: async (id: string, s: string) => {
        const t = tasks.get(id);
        if (t) t.status = s;
      },
      addPrerequisite: async () => {},
    },
    dagResolver: { rebuild: () => {}, validateDependencies: () => null },
    teamRoles: ["tester", "qa"],
    crdtTaskSync: null,
    teamId: "team-1",
  };
}

const ctx: StreamingAgentContext = {
  teamId: "team-1",
  goalId: "goal-1",
  taskId: "task-1",
  agentId: "tester",
};

// =============================================================================
// Tests
// =============================================================================

describe("AgentRuntimeFactory.wire", () => {
  it("wires onStreaming as composite over default + extra hooks", async () => {
    const seen: string[] = [];
    const defaultHook: StreamingHooks = {
      onChunk: () => { seen.push("default:chunk"); },
      onFinish: async () => { seen.push("default:finish"); },
    };
    const extraHook: StreamingHooks = {
      onChunk: () => { seen.push("extra:chunk"); },
      onFinish: async () => { seen.push("extra:finish"); },
    };

    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [defaultHook],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });

    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx, extraStreamingHooks: [extraHook] });

    expect(agent.onStreaming).toBeDefined();
    agent.onStreaming!.onChunk!({ type: "text-delta", delta: "hi" }, ctx);
    await agent.onStreaming!.onFinish!({ text: "hi" }, ctx);

    expect(seen).toEqual(["default:chunk", "extra:chunk", "default:finish", "extra:finish"]);
  });

  it("composite onFinish awaits ALL visitors via Promise.all (slow visitor doesn't serialize)", async () => {
    const slow: StreamingHooks = {
      onFinish: async () => new Promise((r) => setTimeout(r, 30)),
    };
    const fast: StreamingHooks = {
      onFinish: async () => new Promise((r) => setTimeout(r, 30)),
    };

    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [slow, fast],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    const start = Date.now();
    await agent.onStreaming!.onFinish!({ text: "" }, ctx);
    const elapsed = Date.now() - start;
    // Two 30ms visitors in parallel ≈ 30ms, not 60ms.
    expect(elapsed).toBeLessThan(55);
  });

  it("wires onTaskLifecycle that delegates to the orchestrator", async () => {
    const orchestrator = makeOrchestrator();
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    // onComplete → onWorkerDone
    const ack = await agent.onTaskLifecycle!.onComplete!(
      { summary: "done", producedDocs: [{ uri: "x", name: "y" }] },
      ctx,
    );
    expect(ack).toEqual({ accepted: true });
    expect(orchestrator.calls[0]).toMatchObject({ kind: "done", data: { taskId: "task-1", role: "tester", summary: "done" } });

    // onStatusChange → updateLastReportedStatus
    await agent.onTaskLifecycle!.onStatusChange!({ status: "blocked" }, ctx);
    expect(orchestrator.calls.find((c) => c.kind === "status")).toEqual({ kind: "status", taskId: "task-1", status: "blocked" });

    // onBounce → handleTaskFailure with appended suggestedRole
    await agent.onTaskLifecycle!.onBounce!({ reason: "no expertise", suggestedRole: "qa" }, ctx);
    const failCall = orchestrator.calls.find((c) => c.kind === "fail");
    expect(failCall.taskId).toBe("task-1");
    expect(failCall.reason).toMatch(/no expertise.*qa/);

    // onSubtaskRequest → createSubtask, returns ack
    const subAck = await agent.onTaskLifecycle!.onSubtaskRequest!(
      { description: "x", assignedRole: "qa" },
      ctx,
    );
    expect(subAck).toEqual({ accepted: true, newTaskId: "orchestrator-id" });
  });

  it("builds lifecycle tools in hooks mode (no taskStore mutations on bounce/request)", async () => {
    const taskServices = makeTaskServices();
    let storeCreateCalls = 0;
    let storeUpdateStatusCalls = 0;
    const wrappedTaskServices: AgentRuntimeTaskServices = {
      ...taskServices,
      taskStore: {
        ...taskServices.taskStore,
        create: async (t: any) => { storeCreateCalls += 1; await taskServices.taskStore.create(t); },
        updateStatus: async (id: string, s: string) => { storeUpdateStatusCalls += 1; await taskServices.taskStore.updateStatus(id, s); },
      },
    };

    const orchestrator = makeOrchestrator();
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: wrappedTaskServices,
    });
    const agent = new FakeAgent();
    const { lifecycleTools } = factory.wire({ agent, context: ctx });

    expect(lifecycleTools).toHaveLength(4);
    const byName = Object.fromEntries(lifecycleTools.map((t: any) => [t.name, t]));

    // request_task in hooks mode → orchestrator.createSubtask, NO taskStore.create.
    await byName.request_task.invoke({
      title: "x", description: "y", targetRole: "qa",
      type: "work", priority: 3, relationship: "independent",
    });
    expect(storeCreateCalls).toBe(0);
    expect(orchestrator.calls.some((c) => c.kind === "subtask")).toBe(true);

    // bounce_task in hooks mode → orchestrator.handleTaskFailure, NO taskStore.updateStatus.
    await byName.bounce_task.invoke({ reason: "stale" });
    expect(storeUpdateStatusCalls).toBe(0);
    expect(orchestrator.calls.some((c) => c.kind === "fail")).toBe(true);
  });

  it("onCompletePolicy can reject before orchestrator runs", async () => {
    const orchestrator = makeOrchestrator();
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({
      agent,
      context: ctx,
      onCompletePolicy: async (payload: TaskCompletePayload) => {
        if (payload.summary === "bad") return { accepted: false, reason: "policy" };
        return undefined;
      },
    });

    const reject = await agent.onTaskLifecycle!.onComplete!({ summary: "bad" }, ctx);
    expect(reject).toEqual({ accepted: false, reason: "policy" });
    // Orchestrator NOT called.
    expect(orchestrator.calls.find((c) => c.kind === "done")).toBeUndefined();

    const accept = await agent.onTaskLifecycle!.onComplete!({ summary: "good" }, ctx);
    expect(accept).toEqual({ accepted: true });
    // Orchestrator now called.
    expect(orchestrator.calls.find((c) => c.kind === "done")).toBeTruthy();
  });

  it("returns accepted:false with the error reason when orchestrator.onWorkerDone throws", async () => {
    const orchestrator: AgentRuntimeOrchestrator = {
      async onWorkerDone() { throw new Error("merge failed"); },
      async handleTaskFailure() {},
      async createSubtask() { return { accepted: true }; },
      updateLastReportedStatus() {},
      async notifyTaskCreated() {},
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    const ack = await agent.onTaskLifecycle!.onComplete!({ summary: "x" }, ctx);
    expect(ack).toEqual({ accepted: false, reason: "merge failed" });
  });

  it("throws when goalId is missing", () => {
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const looseCtx = { teamId: "t", agentId: "a", taskId: "task-1" } as unknown as StreamingAgentContext;
    expect(() => factory.wire({ agent: new FakeAgent(), context: looseCtx })).toThrow(/goalId is required/);
  });

  it("wire() in stream-only mode (no taskId) returns empty lifecycleTools and undefined agentState", () => {
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const noTaskCtx = { teamId: "t", goalId: "g", agentId: "a" } as StreamingAgentContext;
    const wired = factory.wire({ agent: new FakeAgent(), context: noTaskCtx });
    expect(wired.lifecycleTools).toEqual([]);
    expect(wired.agentState).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Stream-only mode — Phase 1.9/1.10 path (planner + ChatAgent)
  //
  // Stream-only is now `wire()` without `context.taskId`. The legacy alias
  // `wireStreamingOnly()` is kept as a 1-line delegate and is still
  // exercised below so callers written against the old API don't break.
  // ---------------------------------------------------------------------------

  it("wire() without taskId works and does NOT touch onTaskLifecycle", async () => {
    const seen: string[] = [];
    const visitor: StreamingHooks = {
      onChunk: () => { seen.push("chunk"); },
      onFinish: async () => { seen.push("finish"); },
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [visitor],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    const noTaskCtx: StreamingAgentContext = { teamId: "t", goalId: "g", agentId: "planner" };

    const sentinel: TaskLifecycleHooks = { onComplete: async () => ({ accepted: false }) };
    agent.onTaskLifecycle = sentinel;

    factory.wire({ agent, context: noTaskCtx });

    // Streaming wired.
    agent.onStreaming!.onChunk!({ type: "text-delta", delta: "x" }, noTaskCtx);
    await agent.onStreaming!.onFinish!({ text: "x" }, noTaskCtx);
    expect(seen).toEqual(["chunk", "finish"]);

    // Lifecycle untouched.
    expect(agent.onTaskLifecycle).toBe(sentinel);
  });

  it("wireStreamingOnly() (deprecated alias) still works for back-compat callers", async () => {
    const seen: string[] = [];
    const visitor: StreamingHooks = { onChunk: () => { seen.push("chunk"); } };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [visitor],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    const noTaskCtx: StreamingAgentContext = { teamId: "t", goalId: "g", agentId: "planner" };
    const sentinel: TaskLifecycleHooks = { onComplete: async () => ({ accepted: false }) };
    agent.onTaskLifecycle = sentinel;

    factory.wireStreamingOnly({ agent, context: noTaskCtx });

    agent.onStreaming!.onChunk!({ type: "text-delta", delta: "x" }, noTaskCtx);
    expect(seen).toEqual(["chunk"]);
    expect(agent.onTaskLifecycle).toBe(sentinel);
  });

  it("wireStreamingOnly() throws when goalId is missing", () => {
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const looseCtx = { teamId: "t", agentId: "planner" } as unknown as StreamingAgentContext;
    expect(() =>
      factory.wireStreamingOnly({ agent: new FakeAgent(), context: looseCtx }),
    ).toThrow(/goalId is required/);
  });

  // ---------------------------------------------------------------------------
  // Per-visitor isolation (May 8 2026 review fix)
  // ---------------------------------------------------------------------------

  it("isolates visitors: a throwing visitor does NOT prevent later visitors from receiving onChunk", () => {
    const seen: string[] = [];
    const bad: StreamingHooks = {
      onChunk: () => { throw new Error("first visitor explodes"); },
    };
    const good: StreamingHooks = {
      onChunk: () => { seen.push("good:chunk"); },
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [bad, good],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    expect(() =>
      agent.onStreaming!.onChunk!({ type: "text-delta", delta: "x" }, ctx),
    ).not.toThrow();
    expect(seen).toEqual(["good:chunk"]);
  });

  it("isolates visitors: a rejecting visitor does NOT prevent later visitors from completing onFinish", async () => {
    const seen: string[] = [];
    const bad: StreamingHooks = {
      onFinish: async () => { throw new Error("publisher down"); },
    };
    const good: StreamingHooks = {
      onFinish: async () => { seen.push("good:finish"); },
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [bad, good],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    await expect(agent.onStreaming!.onFinish!({ text: "x" }, ctx)).resolves.toBeUndefined();
    expect(seen).toEqual(["good:finish"]);
  });

  it("isolates visitors: throwing onError does not prevent later onError visitors", async () => {
    const seen: string[] = [];
    const bad: StreamingHooks = {
      onError: async () => { throw new Error("crdt down"); },
    };
    const good: StreamingHooks = {
      onError: async () => { seen.push("good:error"); },
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [bad, good],
      orchestrator: makeOrchestrator(),
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    await expect(agent.onStreaming!.onError!(new Error("agent error"), ctx)).resolves.toBeUndefined();
    expect(seen).toEqual(["good:error"]);
  });

  // ---------------------------------------------------------------------------
  // Async-rejection isolation for fire-and-forget hooks (May 9 2026 review fix)
  //
  // `onStart`/`onChunk`/`onStepFinish` are typed `void | Promise<void>`. The
  // composer is fire-and-forget (returns void) but MUST attach `.catch()` to
  // any returned promise so a rejecting async visitor:
  //   1. doesn't become an unhandled rejection (which would crash Node in
  //      strict modes), and
  //   2. doesn't prevent later visitors from receiving the same event.
  // ---------------------------------------------------------------------------

  it("isolates async-rejecting onChunk: later visitors still receive the event AND no unhandled rejection", async () => {
    const seen: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const bad: StreamingHooks = {
        onChunk: async () => { throw new Error("publisher async down"); },
      };
      const good: StreamingHooks = {
        onChunk: async () => { seen.push("good:chunk-async"); },
      };
      const factory = new AgentRuntimeFactory({
        defaultStreamingHooks: [bad, good],
        orchestrator: makeOrchestrator(),
        taskServices: makeTaskServices(),
      });
      const agent = new FakeAgent();
      factory.wire({ agent, context: ctx });

      // Fire-and-forget — composite returns void synchronously.
      const ret = agent.onStreaming!.onChunk!({ type: "text-delta", delta: "x" }, ctx);
      expect(ret).toBeUndefined();

      // Later visitor's async work still ran.
      // (The good visitor pushes synchronously inside its async body, so
      //  it's already queued in the microtask queue at this point.)
      await new Promise((r) => setTimeout(r, 10));
      expect(seen).toEqual(["good:chunk-async"]);

      // No unhandled rejection from the bad visitor.
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("isolates async-rejecting onStart and onStepFinish the same way", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const seen: string[] = [];
      const bad: StreamingHooks = {
        onStart: async () => { throw new Error("start async down"); },
        onStepFinish: async () => { throw new Error("step async down"); },
      };
      const good: StreamingHooks = {
        onStart: async () => { seen.push("good:start"); },
        onStepFinish: async () => { seen.push("good:step"); },
      };
      const factory = new AgentRuntimeFactory({
        defaultStreamingHooks: [bad, good],
        orchestrator: makeOrchestrator(),
        taskServices: makeTaskServices(),
      });
      const agent = new FakeAgent();
      factory.wire({ agent, context: ctx });

      agent.onStreaming!.onStart!(ctx);
      agent.onStreaming!.onStepFinish!(
        { stepNumber: 0, finishReason: "stop", text: "" } as any,
        ctx,
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(seen.sort()).toEqual(["good:start", "good:step"]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // ---------------------------------------------------------------------------
  // notifyTaskCreated parity (Phase 1.8a review fix)
  //
  // After a successful onSubtaskRequest, the factory must invoke the
  // orchestrator's notifyTaskCreated hook so the planner is notified +
  // task-state is broadcast + dispatchReadyTasks is triggered. This restores
  // parity with the legacy `OrchestratorCallbacks.onTaskCreated` flow.
  // ---------------------------------------------------------------------------

  it("notifies the orchestrator after a successful subtask creation", async () => {
    const orchestrator = makeOrchestrator();
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    await agent.onTaskLifecycle!.onSubtaskRequest!(
      { description: "x", assignedRole: "qa", relationship: "blocks-me" },
      ctx,
    );

    const notify = orchestrator.calls.find((c) => c.kind === "notify");
    expect(notify).toBeTruthy();
    expect(notify.data).toEqual({
      taskId: "orchestrator-id",
      createdBy: "agent:tester",
      targetRole: "qa",
      relationship: "blocks-me",
      parentTaskId: "task-1",
    });
  });

  it("does NOT notify when subtask creation was rejected", async () => {
    const orchestrator: AgentRuntimeOrchestrator & { calls: any[] } = {
      calls: [],
      async onWorkerDone() {},
      async handleTaskFailure() {},
      async createSubtask() { return { accepted: false, reason: "budget exceeded" }; },
      updateLastReportedStatus() {},
      notifyTaskCreated: async function (data) { (this as any).calls.push({ kind: "notify", data }); },
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    const ack = await agent.onTaskLifecycle!.onSubtaskRequest!(
      { description: "x", assignedRole: "qa" },
      ctx,
    );
    expect(ack).toEqual({ accepted: false, reason: "budget exceeded" });
    expect(orchestrator.calls.find((c) => c.kind === "notify")).toBeUndefined();
  });

  it("does NOT roll back the ack when notifyTaskCreated throws (fire-and-forget)", async () => {
    const orchestrator: AgentRuntimeOrchestrator = {
      async onWorkerDone() {},
      async handleTaskFailure() {},
      async createSubtask() { return { accepted: true, newTaskId: "new-1" }; },
      updateLastReportedStatus() {},
      async notifyTaskCreated() { throw new Error("planner queue down"); },
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    const ack = await agent.onTaskLifecycle!.onSubtaskRequest!(
      { description: "x", assignedRole: "qa" },
      ctx,
    );
    expect(ack).toEqual({ accepted: true, newTaskId: "new-1" });
  });

  it("works when the orchestrator passes an explicit no-op notifyTaskCreated (minimal callers)", async () => {
    const orchestrator: AgentRuntimeOrchestrator = {
      async onWorkerDone() {},
      async handleTaskFailure() {},
      async createSubtask() { return { accepted: true, newTaskId: "new-1" }; },
      updateLastReportedStatus() {},
      async notifyTaskCreated() {},
    };
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [],
      orchestrator,
      taskServices: makeTaskServices(),
    });
    const agent = new FakeAgent();
    factory.wire({ agent, context: ctx });

    const ack = await agent.onTaskLifecycle!.onSubtaskRequest!(
      { description: "x", assignedRole: "qa" },
      ctx,
    );
    expect(ack).toEqual({ accepted: true, newTaskId: "new-1" });
  });
});
