/**
 * KnowledgeBase — L3 Knowledge Layer (stub)
 *
 * Will provide RAG-based knowledge retrieval for agents.
 * Currently a stub that returns empty results.
 *
 * v2.0: Full implementation with vector store, embeddings, and retrieval.
 */

import { rootLogger } from "../../logging.js";
import type { KnowledgeBaseConfig } from "../../types/index.js";

const logger = rootLogger.child({ module: "KnowledgeBase" });

// Re-export the config type for convenience
export type { KnowledgeBaseConfig };

/**
 * KnowledgeBase stub — returns empty results for all queries
 */
export class KnowledgeBase {
  private config: KnowledgeBaseConfig;
  private initialized = false;

  constructor(config: KnowledgeBaseConfig) {
    this.config = config;
    logger.info("[KnowledgeBase stub] Created with config:", config);
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    logger.info("[KnowledgeBase stub] Initialized (no-op)");
  }

  async relevantDocs(
    _query: string,
    _limit?: number,
  ): Promise<Array<{ document: { title: string; content: string } }>> {
    logger.debug("[KnowledgeBase stub] relevantDocs — returning empty");
    return [];
  }

  async roleSkills(
    _role: string,
  ): Promise<Array<{ title: string; content: string }>> {
    logger.debug("[KnowledgeBase stub] roleSkills — returning empty");
    return [];
  }

  async roleRunbooks(
    _role: string,
  ): Promise<Array<{ title: string; content: string }>> {
    logger.debug("[KnowledgeBase stub] roleRunbooks — returning empty");
    return [];
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Factory function to create a KnowledgeBase instance
 */
export function createKnowledgeBase(
  config: KnowledgeBaseConfig,
): KnowledgeBase {
  return new KnowledgeBase(config);
}
