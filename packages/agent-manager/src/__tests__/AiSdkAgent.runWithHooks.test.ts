/**
 * AiSdkAgent.runWithHooks integration test.
 *
 * Phase 1.5 of the agent-stream-bus refactor.
 *
 * Strategy: override `execute()` on a subclass to yield a canned event
 * stream, then assert that `runWithHooks` translates those events into the
 * correct hook calls. This proves the StreamingHooks contract without
 * spinning up a real model.
 */

import { describe, it, expect } from "bun:test";
import { AiSdkAgent } from "../agent/internal/AiSdkAgent.js";
import { AgentRuntimeFactory } from "../agent/runtime/AgentRuntimeFactory.js";
import type {
  AgentStepInfo,
  StreamPart,
  StreamingAgentContext,
  StreamingHooks,
} from "../agent/streaming/types.js";
import type {
  AgentDefinition,
  AgentEvent,
  AgentInput,
  InternalConfig,
} from "../agent/types.js";

const FAKE_DEFINITION: AgentDefinition = {
  id: "test-agent",
  name: "Test Agent",
  role: "tester",
  type: "internal",
  goal: "test",
  config: {
    model: { provider: "openai", model: "gpt-4o-mini" },
  } satisfies InternalConfig,
};

class FakeAiSdkAgent extends AiSdkAgent {
  /** Events to yield from `execute()`. */
  scriptedEvents: AgentEvent[] = [];

  /** Throw on iteration to simulate runtime errors. */
  scriptedError: Error | null = null;

  override async *execute(_input: AgentInput): AsyncGenerator<AgentEvent> {
    for (const ev of this.scriptedEvents) {
      yield ev;
    }
    if (this.scriptedError) throw this.scriptedError;
  }
}

const ctx: StreamingAgentContext = {
  teamId: "team-1",
  goalId: "goal-1",
  taskId: "task-1",
  agentId: "tester",
  threadId: "thr-1",
};

interface RecordedHooks {
  starts: number;
  chunks: StreamPart[];
  steps: AgentStepInfo[];
  finishes: { text: string; finishReason?: string }[];
  errors: string[];
}

function recordHooks(): { hooks: StreamingHooks; record: RecordedHooks } {
  const record: RecordedHooks = {
    starts: 0,
    chunks: [],
    steps: [],
    finishes: [],
    errors: [],
  };
  const hooks: StreamingHooks = {
    onStart: () => { record.starts += 1; },
    onChunk: (p) => { record.chunks.push(p); },
    onStepFinish: (s) => { record.steps.push(s); },
    onFinish: (r) => { record.finishes.push({ text: r.text, finishReason: r.finishReason }); },
    onError: (e) => { record.errors.push(e.message); },
  };
  return { hooks, record };
}

describe("AiSdkAgent.runWithHooks", () => {
  it("invokes onStart, onChunk for every part, onFinish once", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "start", messageId: "m1" } },
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "Hello " } },
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "World" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
    ];
    const { hooks, record } = recordHooks();
    agent.onStreaming = hooks;

    const result = await agent.runWithHooks({ message: "hi", context: ctx });

    expect(record.starts).toBe(1);
    expect(record.chunks.length).toBe(4);
    expect(record.finishes).toHaveLength(1);
    expect(record.finishes[0].text).toBe("Hello World");
    expect(record.finishes[0].finishReason).toBe("stop");
    expect(record.errors).toHaveLength(0);
    expect(result.text).toBe("Hello World");
    expect(result.finishReason).toBe("stop");
  });

  it("synthesises onStepFinish from finish-step chunks with usage and tool calls", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "start", messageId: "m1" } },
      { type: "stream_part", part: { type: "start-step", stepIndex: 0 } },
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "thinking..." } },
      { type: "stream_part", part: { type: "tool-input-available", toolCallId: "c1", toolName: "search", input: { q: "x" } } },
      { type: "stream_part", part: { type: "tool-output-available", toolCallId: "c1", toolName: "search", output: "result" } },
      { type: "stream_part", part: { type: "finish-step", stepIndex: 0, usage: { totalTokens: 42 }, finishReason: "tool-calls" } },
      { type: "stream_part", part: { type: "start-step", stepIndex: 1 } },
      { type: "stream_part", part: { type: "text-delta", id: "t2", delta: "answer" } },
      { type: "stream_part", part: { type: "finish-step", stepIndex: 1, usage: { totalTokens: 17 }, finishReason: "stop" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
    ];
    const { hooks, record } = recordHooks();
    agent.onStreaming = hooks;

    const result = await agent.runWithHooks({ message: "go", context: ctx });

    expect(record.steps).toHaveLength(2);
    expect(record.steps[0].stepIndex).toBe(0);
    expect(record.steps[0].usage?.totalTokens).toBe(42);
    expect(record.steps[0].finishReason).toBe("tool-calls");
    expect(record.steps[0].toolCalls).toHaveLength(1);
    expect(record.steps[0].toolCalls?.[0].toolName).toBe("search");
    expect(record.steps[0].toolResults).toHaveLength(1);
    expect(record.steps[0].toolResults?.[0].result).toBe("result");
    // Per-step accumulators reset between steps:
    expect(record.steps[1].toolCalls).toBeUndefined();
    expect(record.steps[1].text).toBe("answer");
    // Final result aggregates all tool calls with their results.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].result).toBe("result");
  });

  it("invokes onError and rethrows when execute() throws", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "start", messageId: "m1" } },
    ];
    agent.scriptedError = new Error("boom");
    const { hooks, record } = recordHooks();
    agent.onStreaming = hooks;

    await expect(agent.runWithHooks({ message: "x", context: ctx })).rejects.toThrow("boom");

    expect(record.errors).toEqual(["boom"]);
    expect(record.finishes).toHaveLength(0);
  });

  it("invokes onError when an error AgentEvent is yielded", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "error", error: "model rejected", recoverable: false },
    ];
    const { hooks, record } = recordHooks();
    agent.onStreaming = hooks;

    await expect(agent.runWithHooks({ message: "x", context: ctx })).rejects.toThrow("model rejected");
    expect(record.errors).toEqual(["model rejected"]);
  });

  it("does not break the loop when a visitor throws (composer isolates per-visitor)", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "start", messageId: "m1" } },
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "hi" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
    ];
    let chunkSeen = 0;
    // Wrap raw hooks through the production composer (May 9 2026 — debt
    // patch #8: AiSdkAgent no longer has agent-side safeHook wrappers; the
    // composer is the SOLE isolation layer). Production callers always go
    // through `AgentRuntimeFactory.composeStreamingHooks` so this matches
    // the real shape.
    const factory = new AgentRuntimeFactory({
      defaultStreamingHooks: [
        {
          onStart: () => { throw new Error("start visitor failed"); },
          onChunk: () => { chunkSeen += 1; throw new Error("chunk visitor failed"); },
          onFinish: () => { throw new Error("finish visitor failed"); },
        },
      ],
      orchestrator: {
        async onWorkerDone() {},
        async handleTaskFailure() {},
        async createSubtask() { return { accepted: true, newTaskId: "stub" }; },
        updateLastReportedStatus() {},
        async notifyTaskCreated() {},
      },
      taskServices: {
        taskStore: {} as any,
        dagResolver: {} as any,
        teamRoles: ["tester"],
        crdtTaskSync: undefined,
        teamId: "team-1",
      },
    });
    factory.wire({ agent, context: ctx });

    const result = await agent.runWithHooks({ message: "go", context: ctx });
    expect(result.text).toBe("hi");
    // Each chunk is still delivered even though the visitor throws.
    expect(chunkSeen).toBe(3);
  });

  it("does nothing extra when no hooks are wired", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "ok" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
    ];
    // No hooks set — should not throw.
    const result = await agent.runWithHooks({ message: "go", context: ctx });
    expect(result.text).toBe("ok");
  });

  // ---------------------------------------------------------------------------
  // Review-fix behaviours (May 8 2026):
  //   - Reject structured mode in runWithHooks.
  //   - Fold `done.output` into AgentRunResult.output.
  //   - Fall back to message/done.output.response when no text-delta yielded.
  //   - Fire-and-forget contract: onChunk/onStepFinish do not stall the loop.
  // ---------------------------------------------------------------------------

  it("rejects structured mode with an actionable error", async () => {
    const STRUCTURED_DEF: AgentDefinition = {
      ...FAKE_DEFINITION,
      config: {
        model: { provider: "openai", model: "gpt-4o-mini" },
        responseFormat: "AgentRoleSchema",
      } satisfies InternalConfig,
    };
    const agent = new FakeAiSdkAgent(STRUCTURED_DEF);
    await expect(agent.runWithHooks({ message: "x", context: ctx })).rejects.toThrow(
      /structured-output mode/i,
    );
  });

  it("forwards done.output into AgentRunResult.output", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "hi" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
      { type: "done", output: { response: "hi", extra: 42 }, summary: "ok" },
    ];
    const result = await agent.runWithHooks({ message: "x", context: ctx });
    expect(result.text).toBe("hi");
    expect((result.output as any).response).toBe("hi");
    expect((result.output as any).extra).toBe(42);
  });

  it("falls back to done.output.response when no text-delta was emitted", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      // No text-delta chunks, just a final done payload.
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
      { type: "done", output: { response: "fallback text" }, summary: "ok" },
    ];
    const result = await agent.runWithHooks({ message: "x", context: ctx });
    expect(result.text).toBe("fallback text");
  });

  it("falls back to message event content when no deltas were emitted", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
      { type: "message", content: "msg fallback" },
    ];
    const result = await agent.runWithHooks({ message: "x", context: ctx });
    expect(result.text).toBe("msg fallback");
  });

  it("does not stall the agent loop on a slow onChunk visitor (fire-and-forget)", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "a" } },
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "b" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
    ];
    let chunksDelivered = 0;
    agent.onStreaming = {
      onChunk: () => {
        chunksDelivered += 1;
        // Slow visitor — would stall if awaited.
        return new Promise((resolve) => setTimeout(resolve, 100));
      },
    };

    const start = Date.now();
    const result = await agent.runWithHooks({ message: "x", context: ctx });
    const elapsed = Date.now() - start;

    // Three chunks at 100ms each would be 300ms+ if awaited.
    expect(elapsed).toBeLessThan(80);
    expect(chunksDelivered).toBe(3);
    expect(result.text).toBe("ab");
  });

  it("awaits onFinish so persistence completes before returning", async () => {
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", id: "t1", delta: "x" } },
      { type: "stream_part", part: { type: "finish", finishReason: "stop" } },
    ];
    let finishResolved = false;
    agent.onStreaming = {
      onFinish: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finishResolved = true;
            resolve();
          }, 30),
        ),
    };

    await agent.runWithHooks({ message: "x", context: ctx });
    expect(finishResolved).toBe(true);
  });
});
