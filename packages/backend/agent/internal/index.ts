/**
 * Internal Agent Module
 *
 * Exports the unified InternalAgent class that handles both:
 * - Tool mode: For workers and orchestrator (tool-calling)
 * - Structured output mode: For builders (responseFormat with schemas)
 */

export { InternalAgent } from "./InternalAgent.js";

// Export schemas for structured output mode
export * from "./schemas/index.js";
