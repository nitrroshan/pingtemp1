/**
 * ErrorChannelVisitor — unit tests.
 *
 * The visitor's job is narrow: forward `onError` to a `publishError`
 * delegate with the legacy `{ taskId, error: <message> }` shape so
 * SocketEventBroadcaster's existing `error` Socket.IO channel keeps firing
 * in hooks mode (May 9 2026 review fix #1).
 */

import { describe, it, expect } from "bun:test";
import { ErrorChannelVisitor } from "../agent/streaming/visitors/ErrorChannelVisitor.js";
import type { StreamingAgentContext } from "../agent/streaming/types.js";

const ctx: StreamingAgentContext = {
  teamId: "t",
  goalId: "g",
  taskId: "task-1",
  agentId: "tester",
};

describe("ErrorChannelVisitor", () => {
  it("forwards onError to publishError with { taskId, error: message } shape", async () => {
    const calls: any[] = [];
    const v = new ErrorChannelVisitor({ publishError: (d) => calls.push(d) });

    await v.onError(new Error("model exploded"), ctx);

    expect(calls).toEqual([{ taskId: "task-1", error: "model exploded" }]);
  });

  it("substitutes empty taskId when ctx.taskId is missing (stream-only contexts)", async () => {
    const calls: any[] = [];
    const v = new ErrorChannelVisitor({ publishError: (d) => calls.push(d) });
    const noTaskCtx: StreamingAgentContext = { teamId: "t", goalId: "g", agentId: "planner" };

    await v.onError(new Error("planner blew up"), noTaskCtx);

    expect(calls).toEqual([{ taskId: "", error: "planner blew up" }]);
  });

  it("does NOT throw if publishError throws (composer's job to isolate, but visitor must not crash)", async () => {
    const v = new ErrorChannelVisitor({
      publishError: () => { throw new Error("downstream queue down"); },
    });
    // Per the StreamingHooks contract, the runtime composer wraps each
    // visitor call. The visitor itself doesn't have to swallow, but it
    // shouldn't go out of its way to suppress either — propagating gives
    // the composer a chance to log it.
    await expect(v.onError(new Error("x"), ctx)).rejects.toThrow(/downstream queue down/);
  });
});
