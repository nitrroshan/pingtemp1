/**
 * Lifecycle tools — hooks-mode integration tests.
 *
 * Replaces `lifecycleHooks.test.ts` + `parity/lifecycleTools.parity.test.ts`
 * (deleted May 9 2026) which tested the legacy / hooks dual-mode contract
 * via `executionMode` flag. After Patch #5 there is only ONE mode (hooks):
 * the orchestrator owns ALL state mutations via `lifecycleHooks.*`. The
 * tests here verify:
 *
 *   - Each tool delegates to its hook with the correct payload shape.
 *   - The `agentState.lastStatus` invariant (set by `report_status`,
 *     read by `complete_task`'s blocked-guard) still works.
 *   - The `complete_task` report-doc precondition still gates.
 *   - `onTerminated('complete' | 'bounce')` fires only when the hook
 *     accepts the call.
 *   - Tool-level error / warning strings stable for the LLM.
 */

import { describe, it, expect } from "bun:test";
import { assembleLifecycleTools } from "../services/tools/assembleLifecycleTools.js";
import type { AgentContext, TaskLifecycleHooks } from "../agent/streaming/types.js";

interface HookRecord {
  statusChanges: any[];
  completes: any[];
  bounces: any[];
  subtaskRequests: any[];
  onCompleteAck: { accepted: boolean; reason?: string };
  onSubtaskRequestAck: { accepted: boolean; newTaskId?: string; reason?: string };
}

function makeHooks(): { record: HookRecord; hooks: TaskLifecycleHooks } {
  const record: HookRecord = {
    statusChanges: [],
    completes: [],
    bounces: [],
    subtaskRequests: [],
    onCompleteAck: { accepted: true },
    onSubtaskRequestAck: { accepted: true, newTaskId: "g-task-99" },
  };
  const hooks: TaskLifecycleHooks = {
    onStatusChange: async (p) => { record.statusChanges.push(p); },
    onComplete: async (p) => { record.completes.push(p); return record.onCompleteAck; },
    onBounce: async (p) => { record.bounces.push(p); },
    onSubtaskRequest: async (p) => { record.subtaskRequests.push(p); return record.onSubtaskRequestAck; },
  };
  return { record, hooks };
}

function assemble(taskId: string, goalId: string, role = "dev") {
  const ctx: AgentContext = { teamId: "team-1", goalId, taskId, agentId: role };
  const { record, hooks } = makeHooks();
  const terminations: Array<"complete" | "bounce"> = [];
  const result = assembleLifecycleTools({
    taskId,
    roleKey: role,
    callbacks: {}, // hooks-only; typed callbacks no longer forwarded
    taskServices: {
      taskStore: {
        get: () => ({ id: taskId, status: "in_progress", goalId, prerequisites: new Map(), context: {} }),
        getAll: () => [],
        getByGoal: () => [],
        create: async () => {},
        remove: () => true,
        updateStatus: async () => {},
      } as any,
      dagResolver: { rebuild: () => {}, validateDependencies: () => null } as any,
      teamRoles: ["dev", "qa"],
      crdtTaskSync: null,
      planId: "plan-1",
      goalId,
      teamId: "team-1",
    },
    lifecycleHooks: hooks,
    lifecycleCtx: ctx,
    onTerminated: (kind) => terminations.push(kind),
  });
  return { tools: result.tools, agentState: result.agentState, record, terminations };
}

function findTool(tools: any[], name: string): any {
  return tools.find((t) => t?.name === name || t?.lc_kwargs?.name === name);
}
async function invokeTool(tools: any[], name: string, input: any): Promise<string> {
  const t = findTool(tools, name);
  if (!t) throw new Error(`tool '${name}' not found`);
  return await t.invoke(input);
}

// ---------------------------------------------------------------------------
// assembleLifecycleTools — type-level invariants
// ---------------------------------------------------------------------------

describe("assembleLifecycleTools — hooks is the only mode", () => {
  it("throws if lifecycleHooks is missing (hooks is required)", () => {
    expect(() =>
      assembleLifecycleTools({
        taskId: "t-1",
        roleKey: "dev",
        callbacks: {},
        taskServices: {
          taskStore: { get: () => undefined, getAll: () => [], create: () => {}, remove: () => true, updateStatus: () => {} },
          dagResolver: { rebuild: () => {} },
          teamRoles: [],
          crdtTaskSync: null,
          planId: null,
          goalId: null,
        },
        // no lifecycleHooks / lifecycleCtx
      }),
    ).toThrow(/lifecycleHooks and lifecycleCtx are required/);
  });
});

// ---------------------------------------------------------------------------
// report_status
// ---------------------------------------------------------------------------

describe("report_status (hooks mode)", () => {
  it("delegates to onStatusChange and updates agentState.lastStatus", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "report_status", {
      status: "in_progress", summary: "stepping", progress: 50,
    });
    expect(ret).toBe("Status reported: in_progress - stepping");
    expect(a.record.statusChanges).toEqual([{ status: "in_progress", detail: "stepping" }]);
    expect(a.agentState.lastStatus).toBe("in_progress");
  });

  it("blocked status flows into agentState (used by complete_task guard)", async () => {
    const a = assemble("t-1", "g-1");
    await invokeTool(a.tools, "report_status", { status: "blocked", summary: "need API key" });
    expect(a.agentState.lastStatus).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// complete_task
// ---------------------------------------------------------------------------

describe("complete_task (hooks mode)", () => {
  const goodInput = {
    summary: "implemented login flow",
    deliverables: ["auth/login.ts"],
    nextSteps: ["wire to UI"],
    producedDocs: [{ uri: "crdt:t-1/report", name: "completion-report" }],
    decisions: [{ decision: "JWT", rationale: "stateless" }],
  };

  it("rejects when producedDocs lacks the report-doc precondition", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "complete_task", {
      summary: "x", deliverables: [], nextSteps: [], producedDocs: [],
    });
    expect(ret).toMatch(/Completion protocol not followed/);
    expect(a.record.completes).toEqual([]);
    expect(a.terminations).toEqual([]);
  });

  it("rejects when agent reported blocked (must bounce or unblock first)", async () => {
    const a = assemble("t-1", "g-1");
    await invokeTool(a.tools, "report_status", { status: "blocked", summary: "x" });
    const ret = await invokeTool(a.tools, "complete_task", goodInput);
    expect(ret).toMatch(/Cannot complete task/);
    expect(a.record.completes).toEqual([]);
    expect(a.terminations).toEqual([]);
  });

  it("delegates full payload to onComplete + fires onTerminated('complete') on accept", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "complete_task", goodInput);
    expect(ret).toBe(`Task marked complete. Summary: ${goodInput.summary}`);
    expect(a.record.completes).toHaveLength(1);
    expect(a.record.completes[0]).toMatchObject({
      summary: goodInput.summary,
      deliverables: goodInput.deliverables,
      nextSteps: goodInput.nextSteps,
      producedDocs: goodInput.producedDocs,
      decisions: goodInput.decisions,
    });
    expect(a.terminations).toEqual(["complete"]);
  });

  it("does NOT terminate when onComplete returns accepted=false (LLM gets reason)", async () => {
    const a = assemble("t-1", "g-1");
    a.record.onCompleteAck = { accepted: false, reason: "missing report doc" };
    const ret = await invokeTool(a.tools, "complete_task", goodInput);
    expect(ret).toMatch(/Orchestrator rejected complete_task: missing report doc/);
    expect(a.terminations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bounce_task
// ---------------------------------------------------------------------------

describe("bounce_task (hooks mode)", () => {
  it("delegates to onBounce + fires onTerminated('bounce')", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "bounce_task", {
      reason: "wrong role for this work", suggestedRole: "qa",
    });
    expect(ret).toMatch(/bounced/);
    expect(ret).toMatch(/Suggested reassignment to: qa/);
    expect(a.record.bounces).toEqual([{ reason: "wrong role for this work", suggestedRole: "qa" }]);
    expect(a.terminations).toEqual(["bounce"]);
  });

  it("warns + still bounces when suggested role is unknown", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "bounce_task", { reason: "x", suggestedRole: "nonexistent" });
    expect(ret).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// request_task
// ---------------------------------------------------------------------------

describe("request_task (hooks mode)", () => {
  const input = {
    title: "Add login tests",
    description: "Write integration tests for the new login flow",
    priority: 3,
    type: "work",
    relationship: "independent" as const,
    targetRole: "qa",
  };

  it("delegates to onSubtaskRequest with the full payload + returns orchestrator's task id", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "request_task", input);
    expect(ret).toMatch(/Task created: g-task-99/);
    expect(ret).toMatch(/assigned to qa/);
    expect(a.record.subtaskRequests).toHaveLength(1);
    expect(a.record.subtaskRequests[0]).toMatchObject({
      assignedRole: "qa",
      relationship: "independent",
      parentTaskId: "t-1",
      goalId: "g-1",
      planId: "plan-1",
    });
  });

  it("surfaces the orchestrator's reason when onSubtaskRequest rejects", async () => {
    const a = assemble("t-1", "g-1");
    a.record.onSubtaskRequestAck = { accepted: false, reason: "duplicate task" };
    const ret = await invokeTool(a.tools, "request_task", input);
    expect(ret).toMatch(/Orchestrator rejected new task: duplicate task/);
  });

  it("rejects unknown target role", async () => {
    const a = assemble("t-1", "g-1");
    const ret = await invokeTool(a.tools, "request_task", { ...input, targetRole: "ghost" });
    expect(ret).toMatch(/Role 'ghost' not found/);
  });
});
