/**
 * Phase 1.11 parity tests — REAL AgentRuntimeFactory wiring.
 *
 * The `streamPart.parity.test.ts` fixtures inject a fake factory and
 * pre-assign `agent.onStreaming` directly. That's good as a smoke test
 * but does NOT exercise:
 *   - `AgentRuntimeFactory.wire()` itself (the production wiring point)
 *   - The composite hook isolation in `composeStreamingHooks`
 *   - The actual production visitors (StreamPublisher, ChannelB,
 *     CrdtStatus, ErrorChannel) running together
 *
 * This file fills that gap (May 9 2026 review fix #3). It builds a real
 * `AgentRuntimeFactory` with the production visitor stack, drives a
 * scripted event stream through the SAME `FakeAiSdkAgent.runWithHooks()`
 * the harness uses, and asserts the visitor delegates fire as expected.
 *
 * Goals:
 *   1. Prove the real factory wiring still receives every stream part.
 *   2. Prove the ErrorChannelVisitor bridges hooks-mode failures to the
 *      legacy `onError` callback shape.
 *   3. Prove a throwing visitor doesn't take out the others (composer
 *      isolation in the actual production stack).
 *
 * What this still does NOT cover (separate fixtures):
 *   - Lifecycle tools (`complete_task` / `bounce_task` / `request_task`)
 *   - CRDT projection deep tests (CrdtStatusVisitor has its own)
 *   - End-to-end through WorkerPool.runTask hooks branch (the existing
 *     parity harness covers that with a fake factory; full real-factory
 *     E2E would need a model fake at the AiSdkAgent level)
 */

import { describe, it, expect } from "bun:test";
import { AgentRuntimeFactory } from "../../agent/runtime/AgentRuntimeFactory.js";
import { StreamPublisherVisitor } from "../../agent/streaming/visitors/StreamPublisherVisitor.js";
import { ChannelBVisitor } from "../../agent/streaming/visitors/ChannelBVisitor.js";
import { CrdtStatusVisitor } from "../../agent/streaming/visitors/CrdtStatusVisitor.js";
import { ErrorChannelVisitor } from "../../agent/streaming/visitors/ErrorChannelVisitor.js";
import { FakeAiSdkAgent } from "./harness.js";
import type {
  AgentDefinition,
  AgentEvent,
  InternalConfig,
} from "../../agent/types.js";
import type {
  AgentRuntimeOrchestrator,
  AgentRuntimeTaskServices,
} from "../../agent/runtime/AgentRuntimeFactory.js";
import type { StreamingAgentContext } from "../../agent/streaming/types.js";

// ---------------------------------------------------------------------------
// Production visitor stack — minimal real wiring
// ---------------------------------------------------------------------------

interface CapturedFactory {
  factory: AgentRuntimeFactory;
  streamCalls: any[];
  channelBCalls: any[];
  crdtCalls: any[];
  errorCalls: any[];
}

function makeProductionFactory(): CapturedFactory {
  const streamCalls: any[] = [];
  const channelBCalls: any[] = [];
  const crdtCalls: any[] = [];
  const errorCalls: any[] = [];

  const streamPublisher = new StreamPublisherVisitor({
    publish: (event) => streamCalls.push(event),
    persistMessage: async () => { /* no-op like production */ },
  });
  const channelB = new ChannelBVisitor({
    publish: (update) => channelBCalls.push(update),
  });
  const crdtStatus = new CrdtStatusVisitor({
    crdtTaskSync: {
      updateAgentStatus: async (role, status, taskId) => {
        crdtCalls.push({ role, status, taskId });
      },
    } as any,
  });
  const errorChannel = new ErrorChannelVisitor({
    publishError: (data) => errorCalls.push(data),
  });

  // Minimal orchestrator + taskServices (not exercised by these stream-only fixtures)
  const orchestrator: AgentRuntimeOrchestrator = {
    async onWorkerDone() {},
    async handleTaskFailure() {},
    async createSubtask() { return { accepted: true, newTaskId: "stub" }; },
    updateLastReportedStatus() {},
    async notifyTaskCreated() {},
  };
  const taskServices: AgentRuntimeTaskServices = {
    taskStore: {} as any,
    dagResolver: {} as any,
    teamRoles: ["tester"],
    crdtTaskSync: undefined,
    teamId: "team-real",
  };

  const factory = new AgentRuntimeFactory({
    defaultStreamingHooks: [streamPublisher, channelB, crdtStatus, errorChannel],
    orchestrator,
    taskServices,
  });

  return { factory, streamCalls, channelBCalls, crdtCalls, errorCalls };
}

const FAKE_DEFINITION: AgentDefinition = {
  id: "parity-agent",
  name: "Parity Agent",
  role: "tester",
  type: "internal",
  goal: "test parity",
  config: {
    model: { provider: "openai", model: "gpt-4o-mini" },
  } satisfies InternalConfig,
};

const ctx: StreamingAgentContext = {
  teamId: "team-real",
  goalId: "goal-real",
  taskId: "task-real",
  agentId: "tester",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Parity (real factory) — Phase 1.11 fix #3", () => {
  it("text-delta stream parts flow through StreamPublisherVisitor.publish", async () => {
    const { factory, streamCalls } = makeProductionFactory();
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", delta: "Hi" } as any },
      { type: "stream_part", part: { type: "text-delta", delta: " there" } as any },
      {
        type: "stream_part",
        part: { type: "finish-step", finishReason: "stop", usage: { totalTokens: 5 } } as any,
      },
    ];

    factory.wire({ agent, context: ctx });
    await agent.runWithHooks({ message: "x", context: ctx });

    // StreamPublisher publishes one event per stream part it accepts.
    // We're not asserting the exact accumulator shape — just that the
    // production visitor was invoked (2 text-delta + 1 finish-step at minimum).
    expect(streamCalls.length).toBeGreaterThanOrEqual(2);
    const types = streamCalls.map((e) => e.part?.type).filter(Boolean);
    expect(types).toContain("text-delta");
  });

  it("ChannelBVisitor synthesizes started + completed transitions through real factory wiring", async () => {
    const { factory, channelBCalls } = makeProductionFactory();
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", delta: "ok" } as any },
      {
        type: "stream_part",
        part: { type: "finish-step", finishReason: "stop", usage: { totalTokens: 1 } } as any,
      },
    ];

    factory.wire({ agent, context: ctx });
    await agent.runWithHooks({ message: "x", context: ctx });

    const types = channelBCalls.map((u) => u.type);
    expect(types).toContain("started");
    expect(types).toContain("completed");
  });

  it("ErrorChannelVisitor bridges hooks-mode failures to the legacy onError shape (review fix #1 wired through real factory)", async () => {
    const { factory, errorCalls } = makeProductionFactory();
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", delta: "partial" } as any },
      { type: "error", error: "model exploded" } as any,
    ];

    factory.wire({ agent, context: ctx });
    await expect(agent.runWithHooks({ message: "x", context: ctx })).rejects.toThrow();

    expect(errorCalls).toEqual([{ taskId: "task-real", error: "model exploded" }]);
  });

  it("composer isolation: a throwing extra visitor does NOT block production visitors from publishing", async () => {
    const { factory, streamCalls, channelBCalls } = makeProductionFactory();
    const agent = new FakeAiSdkAgent(FAKE_DEFINITION);
    agent.scriptedEvents = [
      { type: "stream_part", part: { type: "text-delta", delta: "x" } as any },
      {
        type: "stream_part",
        part: { type: "finish-step", finishReason: "stop", usage: { totalTokens: 1 } } as any,
      },
    ];

    // Inject a misbehaving extra visitor that throws on every hook.
    factory.wire({
      agent,
      context: ctx,
      extraStreamingHooks: [
        {
          onStart: () => { throw new Error("bad start"); },
          onChunk: () => { throw new Error("bad chunk"); },
          onStepFinish: () => { throw new Error("bad step"); },
        },
      ],
    });

    await agent.runWithHooks({ message: "x", context: ctx });

    // Production visitors STILL fired despite the throwing extra.
    expect(streamCalls.length).toBeGreaterThan(0);
    expect(channelBCalls.map((u) => u.type)).toContain("started");
  });
});
