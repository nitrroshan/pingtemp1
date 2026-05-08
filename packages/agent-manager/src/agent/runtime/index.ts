/**
 * Agent runtime — Phase 1.7+ wiring.
 *
 * `AgentRuntimeFactory` is the one place that turns a freshly-loaded
 * `IStreamingAgent` into a fully-wired, ready-to-run agent (visitors +
 * lifecycle hooks + lifecycle tools). Hooks is the only orchestration
 * mode (the `executionMode` flag was removed May 9 2026 — debt patch #5).
 */

export * from "./AgentRuntimeFactory.js";
