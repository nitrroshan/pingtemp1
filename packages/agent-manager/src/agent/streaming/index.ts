/**
 * Streaming module — hooks, visitors, and the IStreamingAgent contract.
 *
 * Phase 1 of the agent-stream-bus refactor.
 * See: docs/features/agent-stream-bus/feature_architecture.md
 */

export * from "./types.js";
export * from "./visitors/index.js";
export { SmoothStream } from "./smoothStream.js";
