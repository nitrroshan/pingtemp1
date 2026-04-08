/**
 * @ping/knowledge — L3 Knowledge Library
 *
 * RAG-based knowledge retrieval for agents.
 *
 * Standalone library — no dependency on @ping/agent-manager.
 * Anyone can use L3 directly. Plugin adapter lives in the consumer (e.g. backend).
 */

export { L3KnowledgePlugin } from "./L3/L3KnowledgePlugin.js";
export type { KnowledgeBaseConfig } from "./types/index.js";
