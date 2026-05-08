/**
 * CrdtStatusVisitor unit tests.
 */

import { describe, it, expect } from "bun:test";
import { CrdtStatusVisitor, type ICrdtTaskSync } from "../agent/streaming/visitors/CrdtStatusVisitor.js";
import type { StreamingAgentContext } from "../agent/streaming/types.js";

class FakeCrdtSync implements ICrdtTaskSync {
  calls: Array<{ role: string; status: "busy" | "idle"; taskId?: string }> = [];
  async updateAgentStatus(role: string, status: "busy" | "idle", taskId?: string): Promise<void> {
    this.calls.push({ role, status, taskId });
  }
}

const ctx: StreamingAgentContext = {
  teamId: "team",
  goalId: "goal",
  taskId: "task-1",
  agentId: "dev",
};

describe("CrdtStatusVisitor", () => {
  it("marks busy on onStart, idle on onFinish (onFinish awaits the CRDT write)", async () => {
    const sync = new FakeCrdtSync();
    const v = new CrdtStatusVisitor({ crdtTaskSync: sync });
    v.onStart(ctx);
    await v.onFinish({ text: "x" }, ctx);
    // onStart is detached; allow it to settle.
    await new Promise((r) => setTimeout(r, 5));
    expect(sync.calls).toEqual([
      { role: "dev", status: "busy", taskId: "task-1" },
      { role: "dev", status: "idle", taskId: "task-1" },
    ]);
  });

  it("onFinish actually awaits the CRDT write (idle visible synchronously after await)", async () => {
    let idleResolved = false;
    const v = new CrdtStatusVisitor({
      crdtTaskSync: {
        async updateAgentStatus(_role, status) {
          await new Promise((r) => setTimeout(r, 30));
          if (status === "idle") idleResolved = true;
        },
      },
    });
    v.onStart(ctx);
    await v.onFinish({ text: "x" }, ctx);
    expect(idleResolved).toBe(true);
  });

  it("marks idle on onError (awaited)", async () => {
    const sync = new FakeCrdtSync();
    const v = new CrdtStatusVisitor({ crdtTaskSync: sync });
    v.onStart(ctx);
    await v.onError(new Error("boom"), ctx);
    await new Promise((r) => setTimeout(r, 5));
    expect(sync.calls.map((c) => c.status)).toEqual(["busy", "idle"]);
  });

  it("does not throw when CRDT sync rejects", async () => {
    const v = new CrdtStatusVisitor({
      crdtTaskSync: {
        async updateAgentStatus() {
          throw new Error("crdt down");
        },
      },
    });
    // onStart is detached — must not throw synchronously, and the rejected
    // promise must be swallowed (no unhandled rejection).
    expect(() => v.onStart(ctx)).not.toThrow();
    // onFinish/onError are awaited — must not throw via async path either.
    await expect(v.onFinish({ text: "x" }, ctx)).resolves.toBeUndefined();
    await expect(v.onError(new Error("e"), ctx)).resolves.toBeUndefined();
  });

  it("ignores ctx with no agentId", async () => {
    const sync = new FakeCrdtSync();
    const v = new CrdtStatusVisitor({ crdtTaskSync: sync });
    const noRole = { ...ctx, agentId: "" };
    v.onStart(noRole);
    await v.onFinish({ text: "x" }, noRole);
    await new Promise((r) => setTimeout(r, 5));
    expect(sync.calls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // busy→idle ordering (May 8 2026 review fix)
  //
  // The detached `busy` write at onStart could resolve AFTER the awaited
  // `idle` write at onFinish under latency, leaving CRDT wedged as busy.
  // setAwaited must drain the pending busy promise before issuing idle.
  // ---------------------------------------------------------------------------
  it("preserves busy → idle ordering even when the detached busy write is slow", async () => {
    const log: string[] = [];
    const v = new CrdtStatusVisitor({
      crdtTaskSync: {
        async updateAgentStatus(_role, status) {
          if (status === "busy") {
            // Slow busy: takes longer than the time between onStart and onFinish.
            await new Promise((r) => setTimeout(r, 30));
            log.push("busy");
          } else {
            // Fast idle.
            await new Promise((r) => setTimeout(r, 5));
            log.push("idle");
          }
        },
      },
    });

    v.onStart(ctx);              // detached, slow (30ms)
    await new Promise((r) => setTimeout(r, 5)); // simulate quick task
    await v.onFinish({ text: "x" }, ctx); // awaited; must drain pending busy first

    expect(log).toEqual(["busy", "idle"]);
  });
});
