/**
 * WorkspacePlugin — IPlugin wrapper around L1WorkspacePlugin
 *
 * Adapts the existing L1 workspace layer to the plugin architecture.
 * Delegates all real work to L1WorkspacePlugin — zero behavior change.
 *
 * Lives in backend because:
 *   - @ping/workspace (L1) is a standalone library usable by anyone
 *   - The plugin adapter bridges L1 into the agent-manager plugin system
 *   - "Plugin should be where it is being used" (backend)
 *
 * Provides:
 *   - WorkspaceMcpServer (32 workspace tools via createWorkspaceTools)
 *   - WorkspaceGuideSkill (always-mode prompt playbook)
 *   - WorkspaceStorage (WorkspaceManager access)
 */

import type {
  IPlugin,
  IMcpServer,
  ISkill,
  IPluginStorage,
  ToolContext,
  SkillContext,
} from "@ping/agent-manager";
import { L1WorkspacePlugin } from "@ping/workspace";
import type { WorkspaceConfig } from "@ping/workspace";

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER — Tool provider for workspace operations
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceMcpServer implements IMcpServer {
  readonly id = "workspace-tools";
  readonly name = "Workspace Tools";

  constructor(private l1: L1WorkspacePlugin) {}

  getTools(context: ToolContext): any[] {
    // Planner doesn't need workspace tools
    if (context.consumer === "planner") return [];

    // Workers need a workspace for their role+task
    if (!context.role || !context.taskId) return [];
    if (!this.l1.isReady) return [];

    // Get or create workspace — L1WorkspacePlugin handles caching
    const workspace = this.l1.getWorkspace(context.taskId);
    if (!workspace) return [];

    return this.l1.createTools(workspace);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL — Workspace guide prompt playbook
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceGuideSkill implements ISkill {
  readonly id = "workspace-guide";
  readonly name = "Workspace Guide";
  readonly description =
    "Guidelines for working with git-based workspace files and version control.";
  readonly loadMode = "always" as const;

  getInstructions(_context: SkillContext): string {
    return `## Workspace Best Practices
- Use workspace_list_files to orient before creating files.
- workspace_grep and workspace_keyword_search before duplicating work.
- Commit frequently after each logical change.
- Call workspace_publish when task is complete.`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

export class WorkspacePlugin implements IPlugin {
  readonly id = "workspace";
  readonly name = "Workspace (L1)";

  private l1: L1WorkspacePlugin;
  private mcpServer: WorkspaceMcpServer;
  private skill: WorkspaceGuideSkill;

  constructor(config: WorkspaceConfig) {
    this.l1 = new L1WorkspacePlugin(config);
    this.mcpServer = new WorkspaceMcpServer(this.l1);
    this.skill = new WorkspaceGuideSkill();
  }

  async initialize(): Promise<void> {
    await this.l1.initialize();
  }

  async dispose(): Promise<void> {
    await this.l1.dispose();
  }

  getMcpServers(): IMcpServer[] {
    return [this.mcpServer];
  }

  getSkills(): ISkill[] {
    return [this.skill];
  }

  getStorage(): IPluginStorage {
    return { manager: this.l1.manager };
  }

  /** Access the underlying L1 plugin for backward compat */
  get l1Plugin(): L1WorkspacePlugin {
    return this.l1;
  }

  /** Create workspace for a role+task (called by WorkerPool during tool assembly) */
  async createWorkspace(role: string, taskId: string): Promise<any> {
    return this.l1.createWorkspace(role, taskId);
  }

  /** Get root workspace path */
  get workspacesRoot(): string {
    return this.l1.workspacesRoot;
  }
}
