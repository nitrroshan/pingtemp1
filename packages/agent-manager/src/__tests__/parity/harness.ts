/**
 * Test harness — `FakeAiSdkAgent` for visitor / hooks-mode tests.
 *
 * Replaces the original "two-mode parity" harness (deleted May 9 2026
 * when Patch #2 removed the legacy `WorkerPool.runTask()` branch — there
 * is now only ONE mode, so a comparison harness is meaningless).
 *
 * The remaining piece is a `FakeAiSdkAgent` whose `runWithHooks()` drives
 * a scripted `AgentEvent[]` through any wired `StreamingHooks`. Used by
 * `realFactory.parity.test.ts` to exercise the production visitor stack
 * (StreamPublisher / ChannelB / Crdt / ErrorChannel) under a real
 * `AgentRuntimeFactory.wire()` call without spinning up a real model.
 */

import { AiSdkAgent } from "../../agent/internal/AiSdkAgent.js";
import type {
  AgentDefinition,
  AgentEvent,
  AgentInput,
} from "../../agent/types.js";
import type {
  AgentRunResult,
  AgentStepInfo,
  StreamingAgentContext,
  StreamPart,
} from "../../agent/streaming/types.js";

export class FakeAiSdkAgent extends AiSdkAgent {
  scriptedEvents: AgentEvent[] = [];
  scriptedError: Error | null = null;

  override async *execute(_input: AgentInput): AsyncGenerator<AgentEvent> {
    for (const ev of this.scriptedEvents) yield ev;
    if (this.scriptedError) throw this.scriptedError;
  }

  /**
   * Drive scripted `AgentEvent`s through the wired `StreamingHooks`
   * directly — lets visitor tests verify `onChunk`/`onStepFinish`/
   * `onFinish`/`onError` semantics without involving the real
   * `streamText()` driver.
   */
  override async runWithHooks(opts: {
    message: string;
    context: StreamingAgentContext;
  }): Promise<AgentRunResult> {
    const hooks = this.onStreaming;
    let text = "";
    const stepToolCalls: { toolName: string; input?: unknown }[] = [];
    const stepToolResults: { toolName: string; output?: unknown }[] = [];

    if (hooks?.onStart) await hooks.onStart(opts.context);

    try {
      for (const ev of this.scriptedEvents) {
        if (ev.type === "error") {
          throw new Error((ev as any).error || "scripted error");
        }
        if (ev.type === "stream_part") {
          const part = ev.part as StreamPart;
          if (hooks?.onChunk) await hooks.onChunk(part, opts.context);

          if (part.type === "text-delta" && typeof (part as any).delta === "string") {
            text += (part as any).delta;
          } else if (part.type === "tool-call") {
            stepToolCalls.push({
              toolName: (part as any).toolName,
              input: (part as any).input,
            });
          } else if (part.type === "tool-result") {
            stepToolResults.push({
              toolName: (part as any).toolName,
              output: (part as any).output,
            });
          } else if (part.type === "finish-step") {
            const step: AgentStepInfo = {
              stepIndex: 0,
              text,
              finishReason: (part as any).finishReason,
              usage: (part as any).usage,
              toolCalls: stepToolCalls.length
                ? stepToolCalls.map((c) => ({
                    toolCallId: "fake",
                    toolName: c.toolName,
                    args: c.input,
                  }))
                : undefined,
              toolResults: stepToolResults.length
                ? stepToolResults.map((r) => ({
                    toolCallId: "fake",
                    toolName: r.toolName,
                    result: r.output,
                  }))
                : undefined,
            };
            if (hooks?.onStepFinish) await hooks.onStepFinish(step, opts.context);
            stepToolCalls.length = 0;
            stepToolResults.length = 0;
          }
        }
      }
      if (this.scriptedError) throw this.scriptedError;

      const result: AgentRunResult = { text };
      if (hooks?.onFinish) await hooks.onFinish(result, opts.context);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (hooks?.onError) await hooks.onError(error, opts.context);
      throw error;
    }
  }
}

export const FAKE_DEFINITION: AgentDefinition = {
  id: "fake-agent",
  name: "Fake Agent",
  role: "tester",
  type: "internal",
  goal: "test",
  config: {
    model: { provider: "openai", model: "gpt-4o-mini" },
  },
};
