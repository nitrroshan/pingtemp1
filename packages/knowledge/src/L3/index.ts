/**
 * L3 — Organization Knowledge (RAG, knowledge base)
 *
 * Provides knowledge storage, retrieval, and embedding-based search.
 * Currently a stub — full implementation planned for v2.0.
 */

// Plugin
export { L3KnowledgePlugin } from "./L3KnowledgePlugin.js";

export {
  KnowledgeBase,
  createKnowledgeBase,
} from "./knowledge/KnowledgeBase.js";
export type { KnowledgeBaseConfig } from "./knowledge/KnowledgeBase.js";
