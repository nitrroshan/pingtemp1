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
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
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
// SKILL — Workspace guide loaded from @ping/workspace skills/workspace-guide/SKILL.md
// ═══════════════════════════════════════════════════════════════════════════════

class FileBackedWorkspaceSkill implements ISkill {
  readonly id = "workspace-guide";
  readonly name = "Workspace Guide";
  readonly description =
    "How to use your git-based workspace effectively. Covers tool selection, file operations, search, collaboration, and lifecycle.";
  readonly loadMode = "always" as const;

  private instructions = "";

  setContent(content: string): void {
    // Strip YAML frontmatter
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

export class WorkspacePlugin implements IPlugin {
  readonly id = "workspace";
  readonly name = "Workspace (L1)";

  private l1: L1WorkspacePlugin;
  private mcpServer: WorkspaceMcpServer;
  private skill = new FileBackedWorkspaceSkill();

  constructor(config: WorkspaceConfig) {
    this.l1 = new L1WorkspacePlugin(config);
    this.mcpServer = new WorkspaceMcpServer(this.l1);
  }

  async initialize(): Promise<void> {
    await this.l1.initialize();

    // Load workspace guide skill from @ping/workspace package
    // Resolve from the workspace package's installed location
    try {
      const workspacePkgDir = join(require.resolve("@ping/workspace/package.json"), "..");
      const skillPath = join(workspacePkgDir, "skills", "workspace-guide", "SKILL.md");
      if (existsSync(skillPath)) {
        const content = await readFile(skillPath, "utf-8");
        this.skill.setContent(content);
      }
    } catch {
      // Fallback: try relative from workspace source (monorepo dev)
      const monorepoPath = join(__dirname, "..", "..", "..", "..", "workspace", "skills", "workspace-guide", "SKILL.md");
      if (existsSync(monorepoPath)) {
        const content = await readFile(monorepoPath, "utf-8");
        this.skill.setContent(content);
      }
    }
  }

  async dispose(): Promise<void> {
    await this.l1.dispose();
  }

  /** Create workspace for a task before getTools resolves tools */
  async prepareForTask(context: ToolContext): Promise<void> {
    if (context.consumer === "planner") return;
    if (!context.role || !context.taskId) return;
    if (!this.l1.isReady) return;

    // Ensure workspace exists — createWorkspace returns existing if already created
    const existing = this.l1.getWorkspace(context.taskId);
    if (!existing) {
      await this.l1.createWorkspace(context.role, context.taskId);
    }
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

  /** Publish workspace outputs and merge branch to main */
  async onTaskComplete(taskId: string, goalId?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.l1.isReady) return { success: true };

    const workspace = this.l1.getWorkspace(taskId);
    if (!workspace) return { success: true }; // No workspace for this task

    // Publish outputs if not already published (agent may have called workspace_publish)
    if (workspace.status === "active") {
      try {
        await workspace.publish(goalId);
      } catch (err: any) {
        return { success: false, error: `publish failed: ${err.message}` };
      }
    }

    // Merge task branch to main and cleanup
    return this.l1.manager.mergeAndCleanup(taskId);
  }

  /** Cleanup failed workspace */
  async onTaskFailed(_taskId: string): Promise<void> {
    if (!this.l1.isReady) return;
    // Keep the workspace/branch for debugging — no active cleanup needed
    // WorkspaceManager retains it in its map; cleanupFailed() can be called later
  }

  /** Access the underlying L1 plugin for backward compat */
  get l1Plugin(): L1WorkspacePlugin {
    return this.l1;
  }

  /** Get root workspace path */
  get workspacesRoot(): string {
    return this.l1.workspacesRoot;
  }

  /**
   * Write identity file to workspace so agent can read it via workspace_read_file.
   * Replaces the old IdentityCard class with a simple JSON file.
   */
  async writeIdentityFile(params: {
    taskId: string;
    role: string;
    name?: string;
    goal?: string;
    skills?: string[];
    teamId?: string | null;
    teamRoles?: string[];
  }): Promise<void> {
    if (!this.l1.isReady) return;

    const workspace = this.l1.getWorkspace(params.taskId);
    if (!workspace) return;

    const identity = {
      role: params.role,
      name: params.name || params.role,
      goal: params.goal || `Execute ${params.role} tasks`,
      skills: params.skills || [],
      team: {
        id: params.teamId || null,
        roles: params.teamRoles || [],
      },
    };

    try {
      await workspace.writeFile(".ping/identity.json", JSON.stringify(identity, null, 2));
    } catch {
      // Non-fatal — agent can still work without identity file
    }
  }
}
