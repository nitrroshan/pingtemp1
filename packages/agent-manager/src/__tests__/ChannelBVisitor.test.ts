/**
 * ChannelBVisitor unit tests.
 *
 * Covers Phase 1.4 review fixes:
 *   - Native onStepFinish hook is the primary path for progress updates.
 *   - Synthetic finish-step chunks no longer drive progress (no double-count
 *     when both AI SDK callbacks and chunk events fire).
 *   - Tool milestone events emitted only for MILESTONE_TOOLS.
 *   - onFinish + onError emit completed/failed task updates.
 */

import { describe, it, expect } from "bun:test";
import { ChannelBVisitor } from "../agent/streaming/visitors/ChannelBVisitor.js";
import type { StreamingAgentContext, AgentStepInfo } from "../agent/streaming/types.js";
import type { TaskUpdate } from "../types/TaskUpdate.js";

function makeCtx(over: Partial<StreamingAgentContext> = {}): StreamingAgentContext {
  return {
    teamId: over.teamId ?? "team-1",
    goalId: over.goalId ?? "goal-1",
    taskId: over.taskId ?? "task-1",
    agentId: over.agentId ?? "dev",
  };
}

function makeStep(over: Partial<AgentStepInfo> = {}): AgentStepInfo {
  return {
    stepIndex: over.stepIndex ?? 0,
    finishReason: over.finishReason,
    text: over.text,
    toolCalls: over.toolCalls,
    toolResults: over.toolResults,
    usage: over.usage ?? { totalTokens: 100 },
  };
}

describe("ChannelBVisitor", () => {
  it("emits 'started' on onStart with correct taskId/role", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({ publish: (u) => updates.push(u) });

    v.onStart(makeCtx({ taskId: "t1", agentId: "dev" }));

    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe("started");
    expect(updates[0].taskId).toBe("t1");
    expect(updates[0].role).toBe("dev");
  });

  it("uses native onStepFinish for progress every N steps", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({
      publish: (u) => updates.push(u),
      progressInterval: 2,
    });

    const ctx = makeCtx({ taskId: "t1" });
    v.onStart(ctx);
    v.onStepFinish(makeStep({ stepIndex: 0 }), ctx); // count=1, no emit
    v.onStepFinish(makeStep({ stepIndex: 1 }), ctx); // count=2, emit
    v.onStepFinish(makeStep({ stepIndex: 2 }), ctx); // count=3, no emit
    v.onStepFinish(makeStep({ stepIndex: 3 }), ctx); // count=4, emit

    const progress = updates.filter((u) => u.type === "progress");
    expect(progress).toHaveLength(2);
    expect((progress[0] as any).stepIdx).toBe(2);
    expect((progress[1] as any).stepIdx).toBe(4);
    // Token total accumulates: 100 + 100 = 200, then 200 + 100 + 100 = 400
    expect((progress[0] as any).tokensSoFar).toBe(200);
    expect((progress[1] as any).tokensSoFar).toBe(400);
  });

  it("does NOT double-count when both onStepFinish and 'finish-step' chunk fire", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({
      publish: (u) => updates.push(u),
      progressInterval: 1,
    });

    const ctx = makeCtx({ taskId: "t1" });
    v.onStart(ctx);
    v.onStepFinish(makeStep({ stepIndex: 0 }), ctx); // emit (count=1)
    // Synthetic chunk should be ignored (the AiSdkAgent emits both):
    v.onChunk({ type: "finish-step", stepIndex: 0, usage: { totalTokens: 999 } } as any, ctx);
    v.onStepFinish(makeStep({ stepIndex: 1 }), ctx); // emit (count=2)

    const progress = updates.filter((u) => u.type === "progress");
    expect(progress).toHaveLength(2);
    // Tokens reflect ONLY the onStepFinish path (no 999 leak).
    expect((progress[1] as any).tokensSoFar).toBe(200);
  });

  it("emits tool_milestone only for MILESTONE_TOOLS", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({ publish: (u) => updates.push(u) });

    const ctx = makeCtx({ taskId: "t1" });
    v.onStart(ctx);

    // Not a milestone — should be ignored.
    v.onChunk(
      { type: "tool-output-available", toolCallId: "c1", toolName: "search_web", output: "x" } as any,
      ctx,
    );

    // Milestone tool — should emit.
    v.onChunk(
      {
        type: "tool-output-available",
        toolCallId: "c2",
        toolName: "complete_task",
        output: "All done",
      } as any,
      ctx,
    );

    const milestones = updates.filter((u) => u.type === "tool_milestone");
    expect(milestones).toHaveLength(1);
    expect((milestones[0] as any).tool).toBe("complete_task");
    expect((milestones[0] as any).summary).toBe("All done");
  });

  it("emits 'completed' on onFinish with truncated summary", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({ publish: (u) => updates.push(u) });

    const ctx = makeCtx({ taskId: "t1" });
    v.onStart(ctx);
    v.onFinish({ text: "x".repeat(800) }, ctx);

    const completed = updates.find((u) => u.type === "completed")!;
    expect(completed).toBeDefined();
    expect((completed as any).summary.length).toBe(500);
  });

  it("emits 'failed' on onError", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({ publish: (u) => updates.push(u) });

    const ctx = makeCtx({ taskId: "t1" });
    v.onStart(ctx);
    v.onError(new Error("boom"), ctx);

    const failed = updates.find((u) => u.type === "failed")!;
    expect(failed).toBeDefined();
    expect((failed as any).error).toBe("boom");
  });

  it("does not emit anything when ctx.taskId is missing", () => {
    const updates: TaskUpdate[] = [];
    const v = new ChannelBVisitor({ publish: (u) => updates.push(u) });

    const ctx = { teamId: "t", goalId: "g", agentId: "a" } as StreamingAgentContext;
    v.onStart(ctx);
    v.onStepFinish(makeStep(), ctx);
    v.onFinish({ text: "x" }, ctx);
    v.onError(new Error("e"), ctx);

    expect(updates).toHaveLength(0);
  });

  it("does not throw when publish callback throws", () => {
    const v = new ChannelBVisitor({
      publish: () => {
        throw new Error("publish failure");
      },
    });

    const ctx = makeCtx({ taskId: "t1" });
    // None of these should propagate the error.
    expect(() => v.onStart(ctx)).not.toThrow();
    expect(() => v.onStepFinish(makeStep(), ctx)).not.toThrow();
    expect(() => v.onFinish({ text: "x" }, ctx)).not.toThrow();
    expect(() => v.onError(new Error("e"), ctx)).not.toThrow();
  });
});
