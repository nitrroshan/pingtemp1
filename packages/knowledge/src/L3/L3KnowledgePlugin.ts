/**
 * L3 Knowledge Plugin — Concrete implementation
 *
 * Wraps KnowledgeBase as an IL3KnowledgePlugin.
 * Instantiated externally and registered with MemoryCoordinator.
 */

import { Logger } from "tslog";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { IL3KnowledgePlugin } from "../types/plugins.js";
import type { KnowledgeBaseConfig } from "../types/index.js";
import { KnowledgeBase } from "./knowledge/KnowledgeBase.js";

const logger = new Logger({ name: "L3Plugin" });

export class L3KnowledgePlugin implements IL3KnowledgePlugin {
  readonly layerId = "L3" as const;
  readonly name = "Knowledge Base";

  private _kb: KnowledgeBase;
  private _ready = false;

  constructor(config: KnowledgeBaseConfig) {
    this._kb = new KnowledgeBase(config);
  }

  get isReady(): boolean {
    return this._ready;
  }

  async initialize(): Promise<void> {
    await this._kb.initialize();
    this._ready = true;
    logger.info("L3 initialized");
  }

  async dispose(): Promise<void> {
    this._ready = false;
    logger.info("L3 disposed");
  }

  async relevantDocs(
    query: string,
    limit?: number,
  ): Promise<Array<{ document: { title: string; content: string } }>> {
    return this._kb.relevantDocs(query, limit);
  }

  async roleSkills(
    role: string,
  ): Promise<Array<{ title: string; content: string }>> {
    return this._kb.roleSkills(role);
  }

  async roleRunbooks(
    role: string,
  ): Promise<Array<{ title: string; content: string }>> {
    return this._kb.roleRunbooks(role);
  }

  createTools(_agentId: string, _taskId: string): StructuredToolInterface[] {
    // L3 tools stub — will provide search/add tools in v2.0
    return [];
  }

  /** Expose underlying KnowledgeBase for backward compat */
  get knowledgeBase(): KnowledgeBase {
    return this._kb;
  }
}
