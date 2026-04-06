/**
 * Services barrel export
 *
 * Services provide infrastructure that AgentManager uses for orchestration.
 */

export { WorkerPool, type WorkerCallbacks } from "./WorkerPool.js";
export type { AgentEvent, AgentInput, AgentDefinition, IAgent } from "./types.js";
