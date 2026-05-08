/**
 * StreamPublisherVisitor unit tests.
 *
 * Covers Phase 1.2 review fixes:
 *   - Composite accumulator key prevents cross-goal mixing.
 *   - persistMessage retries once on failure (legacy parity).
 *   - Persistence skipped (with warn) when goalId missing.
 *   - Empty content does not produce a persist call.
 */

import { describe, it, expect } from "bun:test";
import {
  StreamPublisherVisitor,
  type PersistedAssistantMessage,
  type StreamPublishEvent,
} from "../agent/streaming/visitors/StreamPublisherVisitor.js";
import type { StreamingAgentContext } from "../agent/streaming/types.js";

function makeCtx(over: Partial<StreamingAgentContext>): StreamingAgentContext {
  return {
    teamId: over.teamId ?? "team-1",
    goalId: over.goalId ?? "goal-1",
    taskId: over.taskId,
    agentId: over.agentId ?? "worker",
    messageId: over.messageId,
    threadId: over.threadId,
    userId: over.userId,
  };
}

describe("StreamPublisherVisitor", () => {
  it("does not mix accumulators across goals for the same agentId", async () => {
    const persisted: PersistedAssistantMessage[] = [];
    const v = new StreamPublisherVisitor({
      publish: (_e: StreamPublishEvent) => {},
      persistMessage: async (m) => {
        persisted.push(m);
      },
    });

    const ctxA = makeCtx({ goalId: "goal-A", agentId: "planner" });
    const ctxB = makeCtx({ goalId: "goal-B", agentId: "planner" });

    await v.onChunk({ type: "text-delta", id: "t1", delta: "AAA" }, ctxA);
    await v.onChunk({ type: "text-delta", id: "t2", delta: "BBB" }, ctxB);
    await v.onChunk({ type: "finish", finishReason: "stop" }, ctxA);
    await v.onChunk({ type: "finish", finishReason: "stop" }, ctxB);

    expect(persisted).toHaveLength(2);
    const a = persisted.find((m) => m.goalId === "goal-A")!;
    const b = persisted.find((m) => m.goalId === "goal-B")!;
    expect(a.text).toBe("AAA");
    expect(b.text).toBe("BBB");
  });

  it("does not mix accumulators across taskIds for the same goal/agent", async () => {
    const persisted: PersistedAssistantMessage[] = [];
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async (m) => {
        persisted.push(m);
      },
    });

    const ctx1 = makeCtx({ taskId: "task-1", agentId: "dev" });
    const ctx2 = makeCtx({ taskId: "task-2", agentId: "dev" });

    await v.onChunk({ type: "text-delta", delta: "one" }, ctx1);
    await v.onChunk({ type: "text-delta", delta: "two" }, ctx2);
    await v.onChunk({ type: "finish" }, ctx1);
    await v.onChunk({ type: "finish" }, ctx2);

    const t1 = persisted.find((m) => m.taskId === "task-1")!;
    const t2 = persisted.find((m) => m.taskId === "task-2")!;
    expect(t1.text).toBe("one");
    expect(t2.text).toBe("two");
  });

  it("retries persistMessage once on rejection (legacy parity)", async () => {
    let attempts = 0;
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
      },
      persistRetryMs: 1, // fast retry for tests
    });

    const ctx = makeCtx({ taskId: "task-x", agentId: "dev" });
    await v.onChunk({ type: "text-delta", delta: "hello" }, ctx);
    await v.onChunk({ type: "finish" }, ctx);

    // Allow the retry timer to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(attempts).toBe(2);
  });

  it("swallows a second persist failure without breaking the loop", async () => {
    let attempts = 0;
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async () => {
        attempts += 1;
        throw new Error("always fails");
      },
      persistRetryMs: 1,
    });

    const ctx = makeCtx({ taskId: "task-y", agentId: "dev" });
    await v.onChunk({ type: "text-delta", delta: "hi" }, ctx);
    // Should not throw even though both attempts fail.
    await v.onChunk({ type: "finish" }, ctx);

    await new Promise((r) => setTimeout(r, 20));
    expect(attempts).toBe(2);
  });

  it("skips persistence and warns when goalId is missing", async () => {
    let persistedCalls = 0;
    let warnCalls = 0;
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async () => {
        persistedCalls += 1;
      },
      logger: { warn: () => { warnCalls += 1; } },
    });

    // Bypass the type system to simulate a JS misuse.
    const ctx = { teamId: "team-1", agentId: "dev", taskId: "t1" } as unknown as StreamingAgentContext;
    await v.onChunk({ type: "text-delta", delta: "x" }, ctx);
    await v.onChunk({ type: "finish" }, ctx);

    expect(persistedCalls).toBe(0);
    expect(warnCalls).toBeGreaterThan(0);
  });

  it("does not persist when no text and no parts accumulated", async () => {
    let persistedCalls = 0;
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async () => {
        persistedCalls += 1;
      },
    });

    const ctx = makeCtx({ taskId: "task-empty", agentId: "dev" });
    await v.onChunk({ type: "start", messageId: "m1" }, ctx);
    await v.onChunk({ type: "finish" }, ctx);

    expect(persistedCalls).toBe(0);
  });

  it("publishes every chunk to the wire", async () => {
    const events: StreamPublishEvent[] = [];
    const v = new StreamPublisherVisitor({
      publish: (e) => {
        events.push(e);
      },
      persistMessage: async () => {},
    });

    const ctx = makeCtx({ taskId: "t", agentId: "dev" });
    await v.onChunk({ type: "start", messageId: "m" }, ctx);
    await v.onChunk({ type: "text-delta", delta: "hi" }, ctx);
    await v.onChunk({ type: "finish" }, ctx);

    expect(events.map((e) => e.part.type)).toEqual(["start", "text-delta", "finish"]);
    expect(events.every((e) => e.goalId === "goal-1")).toBe(true);
  });

  it("tracks streamedTasks for the legacy onDone bridge", async () => {
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async () => {},
    });

    const ctx = makeCtx({ taskId: "task-z", agentId: "dev" });
    expect(v.hasStreamed("task-z")).toBe(false);
    await v.onChunk({ type: "text-delta", delta: "x" }, ctx);
    expect(v.hasStreamed("task-z")).toBe(true);
    v.clearStreamed("task-z");
    expect(v.hasStreamed("task-z")).toBe(false);
  });

  it("publishes the finish chunk BEFORE awaiting persistence (token UI must not block)", async () => {
    const order: string[] = [];
    const v = new StreamPublisherVisitor({
      publish: (e) => order.push(`publish:${e.part.type}`),
      persistMessage: async () => {
        order.push("persist:start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("persist:end");
      },
    });

    const ctx = makeCtx({ taskId: "task-order", agentId: "dev" });
    await v.onChunk({ type: "text-delta", delta: "hi" }, ctx);
    await v.onChunk({ type: "finish" }, ctx);

    // Wait long enough for the detached persist to settle.
    await new Promise((r) => setTimeout(r, 80));

    // Publish for `finish` MUST appear before the persist sequence completes.
    const publishFinishIdx = order.indexOf("publish:finish");
    const persistEndIdx = order.indexOf("persist:end");
    expect(publishFinishIdx).toBeGreaterThanOrEqual(0);
    expect(persistEndIdx).toBeGreaterThanOrEqual(0);
    expect(publishFinishIdx).toBeLessThan(persistEndIdx);
  });

  it("uses accumulatedParts on the persisted message (not legacy 'parts' field)", async () => {
    const persisted: PersistedAssistantMessage[] = [];
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async (m) => {
        persisted.push(m);
      },
    });

    const ctx = makeCtx({ taskId: "task-shape", agentId: "dev" });
    await v.onChunk(
      { type: "tool-input-available", toolCallId: "c1", toolName: "search", input: { q: "x" } },
      ctx,
    );
    await v.onChunk({ type: "finish" }, ctx);

    // Wait for detached persist.
    await new Promise((r) => setTimeout(r, 20));

    expect(persisted).toHaveLength(1);
    const m = persisted[0];
    expect(Array.isArray(m.accumulatedParts)).toBe(true);
    expect(m.accumulatedParts[0]).toMatchObject({
      type: "tool-input",
      toolCallId: "c1",
      toolName: "search",
    });
    // Legacy field name must be absent.
    expect((m as any).parts).toBeUndefined();
  });

  it("onFinish awaits the detached persist scheduled by the finish chunk", async () => {
    let persistResolved = false;
    const v = new StreamPublisherVisitor({
      publish: () => {},
      persistMessage: async () => {
        await new Promise((r) => setTimeout(r, 50));
        persistResolved = true;
      },
    });

    const ctx = makeCtx({ taskId: "task-await", agentId: "dev" });
    await v.onChunk({ type: "text-delta", delta: "x" }, ctx);
    // `finish` chunk schedules a 50ms detached persist.
    await v.onChunk({ type: "finish" }, ctx);
    // Without onFinish awaiting it, persistResolved would still be false here.
    expect(persistResolved).toBe(false);

    await v.onFinish({ text: "x" }, ctx);
    // After awaited onFinish, the detached persist must have completed.
    expect(persistResolved).toBe(true);
  });
});
