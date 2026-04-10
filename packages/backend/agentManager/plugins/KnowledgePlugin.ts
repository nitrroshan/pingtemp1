/**
 * KnowledgePlugin — IPlugin wrapper around L3KnowledgePlugin
 *
 * Adapts the existing L3 knowledge layer to the plugin architecture.
 * Delegates all real work to L3KnowledgePlugin — zero behavior change.
 *
 * Lives in backend because:
 *   - @ping/knowledge (L3) is a standalone library usable by anyone
 *   - The plugin adapter bridges L3 into the agent-manager plugin system
 *   - "Plugin should be where it is being used" (backend)
 *
 * Provides:
 *   - KnowledgeMcpServer (knowledge query/add tools)
 *   - KnowledgeGuideSkill (always-mode prompt playbook)
 *   - KnowledgeStorage (KnowledgeBase access)
 */

import type {
  IPlugin,
  IMcpServer,
  ISkill,
  IPluginStorage,
  ToolContext,
  SkillContext,
} from "@ping/agent-manager";
import { L3KnowledgePlugin } from "@ping/knowledge";
import type { KnowledgeBaseConfig } from "@ping/knowledge";

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER — Knowledge tool provider
// ═══════════════════════════════════════════════════════════════════════════════

class KnowledgeMcpServer implements IMcpServer {
  readonly id = "knowledge-tools";
  readonly name = "Knowledge Tools";

  constructor(private l3: L3KnowledgePlugin) {}

  getTools(context: ToolContext): any[] {
    // Planner doesn't need knowledge tools (yet)
    if (context.consumer === "planner") return [];
    if (!this.l3.isReady) return [];

    return this.l3.createTools(context.role || "agent", context.taskId || "");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL — Knowledge guide prompt playbook
// ═══════════════════════════════════════════════════════════════════════════════

class KnowledgeGuideSkill implements ISkill {
  readonly id = "knowledge-guide";
  readonly name = "Knowledge Guide";
  readonly description =
    "Guidelines for searching and using the organizational knowledge base.";
  readonly loadMode = "always" as const;

  getInstructions(_context: SkillContext): string {
    return `## Knowledge Base
- Search the knowledge base before starting tasks to leverage existing information.
- Knowledge queries use semantic search — describe WHAT you need, not exact keywords.`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

export class KnowledgePlugin implements IPlugin {
  readonly id = "knowledge";
  readonly name = "Knowledge (L3)";

  private l3: L3KnowledgePlugin;
  private mcpServer: KnowledgeMcpServer;
  private skill: KnowledgeGuideSkill;

  constructor(config: KnowledgeBaseConfig) {
    this.l3 = new L3KnowledgePlugin(config);
    this.mcpServer = new KnowledgeMcpServer(this.l3);
    this.skill = new KnowledgeGuideSkill();
  }

  async initialize(): Promise<void> {
    await this.l3.initialize();
  }

  async dispose(): Promise<void> {
    await this.l3.dispose();
  }

  getMcpServers(): IMcpServer[] {
    return [this.mcpServer];
  }

  getSkills(): ISkill[] {
    return [this.skill];
  }

  getStorage(): IPluginStorage {
    return { kb: this.l3.knowledgeBase };
  }

  /** Access the underlying L3 plugin for backward compat */
  get l3Plugin(): L3KnowledgePlugin {
    return this.l3;
  }
}
