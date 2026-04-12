/**
 * CollaborationPlugin — IPlugin wrapper around L2CollaborationPlugin
 *
 * Adapts the existing L2 collaboration layer to the plugin architecture.
 * Delegates all real work to L2CollaborationPlugin — zero behavior change.
 *
 * Lives in backend because:
 *   - @ping/collaboration (L2) is a standalone library usable by anyone
 *   - The plugin adapter bridges L2 into the agent-manager plugin system
 *   - "Plugin should be where it is being used" (backend)
 *
 * Provides:
 *   - CollabMcpServer (unified collab tool via createCollabTool)
 *   - CollabGuideSkill (always-mode prompt playbook)
 *   - CollaborationStorage (CRDT server, PlanStore, GroupChat)
 */

import type {
  IPlugin,
  IMcpServer,
  ISkill,
  IPluginStorage,
  ToolContext,
  SkillContext,
} from "@ping/agent-manager";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  L2CollaborationPlugin,
  createCollabTool,
} from "@ping/collaboration";
import type { L2CollaborationPluginConfig } from "@ping/collaboration";

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER — Collab tool provider
// ═══════════════════════════════════════════════════════════════════════════════

class CollabMcpServer implements IMcpServer {
  readonly id = "collab-tools";
  readonly name = "Collaboration Tools";

  constructor(
    private l2: L2CollaborationPlugin,
    private repoPath: string,
  ) {}

  private goalId: string = "default";

  setGoalId(goalId: string): void {
    this.goalId = goalId;
  }

  getTools(context: ToolContext): any[] {
    // Planner doesn't need collab tools
    if (context.consumer === "planner") return [];
    if (!context.role) return [];
    if (!this.l2.isReady) return [];

    const space = this.l2.getOrCreateSpace(this.goalId);
    const collabTool = createCollabTool(space, context.role, this.l2, this.repoPath);
    return [collabTool];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL — Collaboration guide prompt playbook
// ═══════════════════════════════════════════════════════════════════════════════

class CollabGuideSkill implements ISkill {
  readonly id = "collab-guide";
  readonly name = "Collaboration Guide";
  readonly description =
    "How to use the collab tool for team collaboration — CRDT docs, plans, output manifests, and the shared editor.";
  readonly loadMode = "always" as const;

  private instructions = `## Collaboration Guidelines
- Use collab tool with progressive discovery: discover → list → read → write.
- Read shared docs before starting to avoid duplicate work.
- Use write-block for text content (reports, findings), write for structured data.`;

  setContent(content: string): void {
    let body = content;
    if (body.startsWith("---")) {
      const endIndex = body.indexOf("---", 3);
      if (endIndex !== -1) {
        body = body.slice(endIndex + 3).trim();
      }
    }
    this.instructions = body;
  }

  getInstructions(_context: SkillContext): string {
    return this.instructions;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

export class CollaborationPlugin implements IPlugin {
  readonly id = "collaboration";
  readonly name = "Collaboration (L2)";

  private l2: L2CollaborationPlugin;
  private mcpServer: CollabMcpServer;
  private skill: CollabGuideSkill;
  private repoPath: string;

  constructor(config: L2CollaborationPluginConfig) {
    this.repoPath = config.repoPath || ".";
    this.l2 = new L2CollaborationPlugin(config);
    this.mcpServer = new CollabMcpServer(this.l2, this.repoPath);
    this.skill = new CollabGuideSkill();
  }

  async initialize(): Promise<void> {
    await this.l2.initialize();

    // Load collab guide skill from @ping/collaboration package
    try {
      const collabPkgDir = join(require.resolve("@ping/collaboration/package.json"), "..");
      const skillPath = join(collabPkgDir, "skills", "collab-guide", "SKILL.md");
      if (existsSync(skillPath)) {
        const content = await readFile(skillPath, "utf-8");
        this.skill.setContent(content);
      }
    } catch {
      // Fallback: monorepo dev path
      const monorepoPath = join(__dirname, "..", "..", "..", "..", "collaboration", "skills", "collab-guide", "SKILL.md");
      if (existsSync(monorepoPath)) {
        const content = await readFile(monorepoPath, "utf-8");
        this.skill.setContent(content);
      }
    }
  }

  async dispose(): Promise<void> {
    await this.l2.dispose();
  }

  getMcpServers(): IMcpServer[] {
    return [this.mcpServer];
  }

  getSkills(): ISkill[] {
    return [this.skill];
  }

  getStorage(): IPluginStorage {
    return {
      planStore: this.l2.planStore as any,
      crdt: this.l2,
      groupChat: this.l2,
    };
  }

  /** Access the underlying L2 plugin for backward compat */
  get l2Plugin(): L2CollaborationPlugin {
    return this.l2;
  }

  /** Set the active goal ID for collab space scoping */
  setGoalId(goalId: string): void {
    this.mcpServer.setGoalId(goalId);
  }
}
