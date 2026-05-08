/**
 * WorkerPool — runtime wiring tests (post hot-toggle removal).
 *
 * Patch #6 (May 9 2026) removed the `PING_AGENT_RUNTIME_HOOKS` env flag
 * and the `setRuntimeHooksEnabled` toggle. Workers now ALWAYS go through
 * `factory.wire()` + `agent.runWithHooks()`. The remaining wiring
 * surface is just:
 *
 *   - `setRuntimeFactory(factory)` — required at construction; can be
 *     swapped at runtime (bumps `runtimeGeneration` so cached workers
 *     are recreated against the new visitors / orchestrator).
 *   - `getRuntimeGeneration()` — diagnostic seam.
 *   - `runTask(...)` — throws if no factory was injected.
 *
 * The previous file `WorkerPool.runtimeHooks.test.ts` covered features
 * that no longer exist (mode toggle, env var, `getWorkerMode`, factory-
 * present-but-flag-off paths). It was replaced wholesale by this file.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WorkerPool } from "../services/WorkerPool.js";
import type { AgentRuntimeFactory } from "../agent/runtime/AgentRuntimeFactory.js";

function makeFactory(): AgentRuntimeFactory {
  return {} as unknown as AgentRuntimeFactory;
}

describe("WorkerPool — runtime wiring", () => {
  const originalEnv = process.env.PING_AGENT_RUNTIME_HOOKS;

  beforeEach(() => { delete process.env.PING_AGENT_RUNTIME_HOOKS; });
  afterEach(() => {
    if (originalEnv !== undefined) process.env.PING_AGENT_RUNTIME_HOOKS = originalEnv;
    else delete process.env.PING_AGENT_RUNTIME_HOOKS;
  });

  // ---------------------------------------------------------------------------
  // Factory injection contract
  // ---------------------------------------------------------------------------

  it("starts with no factory and runtimeGeneration = 0", () => {
    const pool = new WorkerPool();
    expect(pool.getRuntimeGeneration()).toBe(0);
  });

  it("setRuntimeFactory bumps generation when a different factory is set", () => {
    const pool = new WorkerPool();
    pool.setRuntimeFactory(makeFactory());
    expect(pool.getRuntimeGeneration()).toBe(1);
    pool.setRuntimeFactory(makeFactory()); // different instance
    expect(pool.getRuntimeGeneration()).toBe(2);
  });

  it("setRuntimeFactory with the SAME factory does NOT bump generation", () => {
    const pool = new WorkerPool();
    const factory = makeFactory();
    pool.setRuntimeFactory(factory);
    const gen = pool.getRuntimeGeneration();
    pool.setRuntimeFactory(factory);
    expect(pool.getRuntimeGeneration()).toBe(gen);
  });

  it("setRuntimeFactory(null) bumps generation (clearing is a swap)", () => {
    const pool = new WorkerPool();
    pool.setRuntimeFactory(makeFactory());
    const gen = pool.getRuntimeGeneration();
    pool.setRuntimeFactory(null);
    expect(pool.getRuntimeGeneration()).toBe(gen + 1);
  });

  // ---------------------------------------------------------------------------
  // Factory-swap cache invalidation (the only invariant `runtimeGeneration`
  // exists to support — Patch #6 collapsed mode tracking into this)
  // ---------------------------------------------------------------------------

  it("factory swap renders cached worker generation stale (runTask will recreate)", () => {
    const pool = new WorkerPool();
    pool.setRuntimeFactory(makeFactory());

    // Simulate a worker created under the current factory.
    const fakeAgent = { stop: async () => {} } as any;
    (pool as any).workers.set("task-1", fakeAgent);
    (pool as any).workerRoles.set("task-1", "dev");
    (pool as any).workerGenerations.set("task-1", pool.getRuntimeGeneration());

    const cachedGen = (pool as any).workerGenerations.get("task-1");
    expect(cachedGen).toBe(pool.getRuntimeGeneration());

    // Swap factory — cached gen is now stale.
    pool.setRuntimeFactory(makeFactory());
    expect(cachedGen).not.toBe(pool.getRuntimeGeneration());
  });

  // ---------------------------------------------------------------------------
  // Cleanup contract
  // ---------------------------------------------------------------------------

  it("dispose() removes the worker generation entry", async () => {
    const pool = new WorkerPool();
    pool.setRuntimeFactory(makeFactory());
    const fakeAgent = { stop: async () => {} } as any;
    (pool as any).workers.set("task-1", fakeAgent);
    (pool as any).workerRoles.set("task-1", "dev");
    (pool as any).workerGenerations.set("task-1", pool.getRuntimeGeneration());

    await pool.dispose("task-1");
    expect((pool as any).workerGenerations.has("task-1")).toBe(false);
  });

  it("disposeAll() clears all worker generations", async () => {
    const pool = new WorkerPool();
    pool.setRuntimeFactory(makeFactory());
    const fakeAgent = { stop: async () => {} } as any;
    (pool as any).workers.set("task-1", fakeAgent);
    (pool as any).workerRoles.set("task-1", "dev");
    (pool as any).workerGenerations.set("task-1", pool.getRuntimeGeneration());
    (pool as any).workers.set("task-2", fakeAgent);
    (pool as any).workerRoles.set("task-2", "qa");
    (pool as any).workerGenerations.set("task-2", pool.getRuntimeGeneration());

    await pool.disposeAll();
    expect((pool as any).workerGenerations.size).toBe(0);
  });
});
