/**
 * Services barrel export
 *
 * Services provide infrastructure that AgentManager uses for orchestration.
 */

export { WorkerPool, type WorkerPoolEvents } from "./WorkerPool.js";
export type { AgentEvent, AgentInput, AgentDefinition, IAgent } from "./types.js";
