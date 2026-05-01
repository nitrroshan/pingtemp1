/**
 * WorkspaceManager — Manages multiple agent workspaces
 *
 * Responsible for:
 * - Creating and tracking workspaces per agent/task
 * - Workspace lifecycle (create → active → publish → merge → cleanup)
 * - Cleanup policies for completed/failed workspaces
 * - Event forwarding from child workspaces
 * - Repository initialization via GitBranchManager
 *
 * @see feature_implementation_planning.md §3.3
 */

import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import { rootLogger } from "../../logging.js";
import { GitBranchManager } from "./GitBranchManager.js";
import { AgentWorkspace } from "./AgentWorkspace.js";
import { WorktreeGitOps } from "./IWorkspaceGitOps.js";
import type { IWorkspaceMerger } from "./IWorkspaceMerger.js";
import { SharedMerger, WorktreeMerger } from "./IWorkspaceMerger.js";
import type {
  IWorkspaceManager,
  WorkspaceConfig,
  WorkspaceFilter,
  WorkspaceInitOptions,
  WorkspaceStatus,
  CleanupResult,
  Artifact,
} from "../../types/index.js";

const logger = rootLogger.child({ module: "WorkspaceManager" });

/**
 * Generate a unique workspace ID
 */
function generateWorkspaceId(taskId: string): string {
  return `ws-${taskId}-${Date.now().toString(36)}`;
}

export class WorkspaceManager implements IWorkspaceManager {
  /** Root directory for all workspaces */
  public readonly workspacesRoot: string;
  /** Workspace configuration */
  private config: WorkspaceConfig;
  /** Low-level git manager */
  private gitManager: GitBranchManager;

  /** Active workspace registry — keyed by taskId */
  private workspaces: Map<string, AgentWorkspace> = new Map();

  /** Merge strategy per workspace — keyed by taskId */
  private mergers: Map<string, IWorkspaceMerger> = new Map();

  /** Tracks primary clone per plan for worktree reuse: planId → repo dir path */
  private planRepos: Map<string, string> = new Map();

  /** Event emitter for workspace lifecycle events */
  public readonly events = new EventEmitter();

  constructor(config: WorkspaceConfig) {
    this.config = config;
    // Resolve to absolute — git worktree add resolves relative paths from repo root, not cwd
    this.workspacesRoot = path.resolve(config.repoPath);
    this.gitManager = new GitBranchManager(
      this.workspacesRoot,
      config.defaultBranch || "main",
    );
    logger.info(`WorkspaceManager created at: ${this.workspacesRoot}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the workspace system — create or connect to git repo
   */
  async initializeWorkspace(): Promise<void> {
    await this.gitManager.withLock(async () => {
      await this.gitManager.initRepo();
    });
    logger.info(`Workspace system initialized at: ${this.workspacesRoot}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKSPACE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new workspace for an agent working on a task
   * Returns an existing workspace if one already exists for this taskId.
   *
   * If `initOptions` is provided with a `repoUrl`, the workspace
   * will clone the repo instead of creating a basic workspace.
   */
  async createWorkspace(
    agentId: string,
    taskId: string,
    initOptions?: WorkspaceInitOptions & { goalId?: string; planId?: string },
  ): Promise<AgentWorkspace> {
    // Return existing workspace for this task
    if (this.workspaces.has(taskId)) {
      logger.debug(`Returning existing workspace for task: ${taskId}`);
      return this.workspaces.get(taskId)!;
    }

    const useIsolation = initOptions?.repoUrl && initOptions?.planId
      && process.env.FF_WORKSPACE_ISOLATION !== "false";
    const workspaceId = generateWorkspaceId(taskId);

    let workspace: AgentWorkspace;

    if (useIsolation) {
      // ── ISOLATED MODE: worktree optimization ──
      // First task for a plan → full clone into plan-{planId}/repo/
      // Subsequent tasks → git worktree add from the primary clone
      const planDir = path.join(this.workspacesRoot, `plan-${initOptions.planId}`);
      const taskDir = path.join(planDir, `task-${taskId}`);
      const branchName = initOptions.goalId
        ? `goal-${initOptions.goalId}/task-${taskId}`
        : `task-${taskId}`;

      const primaryClone = this.planRepos.get(initOptions.planId!);

      if (!primaryClone) {
        // First task → full clone
        const repoDir = path.join(planDir, "repo");
        await fs.promises.mkdir(repoDir, { recursive: true });

        const cloneGitManager = new GitBranchManager(
          repoDir,
          initOptions.repoBranch || "main",
          { skipAutoInit: true }, // Don't auto-init — we're about to clone into this dir
        );
        await cloneGitManager.clone(
          initOptions.authToken && initOptions.repoUrl!.startsWith("https://")
            ? initOptions.repoUrl!.replace("https://", `https://oauth2:${initOptions.authToken}@`)
            : initOptions.repoUrl!,
          repoDir,
          { branch: initOptions.repoBranch, sparse: initOptions.sparse },
        );

        // Seed empty repo so worktrees can be created (requires at least one commit)
        const log = await cloneGitManager.getGit().log().catch(() => null);
        if (!log || log.total === 0) {
          await cloneGitManager.seedInitialCommit();
          logger.info(`Seeded empty cloned repo with initial commit at ${repoDir}`);
        }

        this.planRepos.set(initOptions.planId!, repoDir);

        // Create worktree for this task from the clone
        const repoGit = cloneGitManager.getGit();
        await repoGit.raw(["worktree", "add", taskDir, "-b", branchName]);

        logger.info(
          `Created primary clone at ${repoDir} + worktree at ${taskDir} for task '${taskId}'`,
        );
      } else {
        // Subsequent task → worktree from existing clone
        await fs.promises.mkdir(path.dirname(taskDir), { recursive: true });
        const repoGitManager = new GitBranchManager(
          primaryClone,
          initOptions.repoBranch || "main",
        );
        const repoGit = repoGitManager.getGit();
        await repoGit.raw(["worktree", "add", taskDir, "-b", branchName]);

        logger.info(
          `Created worktree at ${taskDir} from clone at ${primaryClone} for task '${taskId}'`,
        );
      }

      // Create workspace pointing at the worktree directory
      // skipAutoInit: worktree has a .git file (not dir) linking back to the clone
      const taskGitManager = new GitBranchManager(taskDir, initOptions.repoBranch || "main", { skipAutoInit: true });

      workspace = new AgentWorkspace({
        id: workspaceId,
        agentId,
        taskId,
        branchName,
        basePath: taskDir,
        gitManager: taskGitManager,
        gitOps: new WorktreeGitOps(), // worktree IS the branch — no checkout/createBranch
      });

      // Skip initializeFromRepo — worktree already has the repo content
      // Just initialize workspace metadata (.ping/, .scratch/, workspace.json)
      await workspace.initialize();

      logger.info(
        `Created ISOLATED workspace: ${workspaceId} at ${taskDir} for task '${taskId}'`,
      );

      // Store worktree merger — merges from primary clone (where main is checked out)
      const clonePath = this.planRepos.get(initOptions.planId!) || path.join(planDir, "repo");
      this.mergers.set(taskId, new WorktreeMerger(clonePath));
    } else {
      // ── SHARED MODE: existing behavior (branch isolation in shared repo) ──
      const branchName = initOptions?.goalId
        ? `goal-${initOptions.goalId}/task-${taskId}`
        : `task-${taskId}`;

      workspace = new AgentWorkspace({
        id: workspaceId,
        agentId,
        taskId,
        branchName,
        basePath: this.workspacesRoot,
        gitManager: this.gitManager,
      });

      if (initOptions?.repoUrl || initOptions?.localPath) {
        await workspace.initializeFromRepo(initOptions);
      } else {
        await workspace.initialize();
      }

      logger.info(
        `Created workspace: ${workspaceId} for agent '${agentId}' task '${taskId}' on branch '${branchName}'`,
      );
    }

    // Register in map
    this.workspaces.set(taskId, workspace);

    // Forward workspace events
    this.forwardEvents(workspace);

    return workspace;
  }

  /**
   * Get workspace by task ID
   */
  getWorkspace(taskId: string): AgentWorkspace | undefined {
    return this.workspaces.get(taskId);
  }

  /**
   * Get all workspaces for an agent
   */
  getWorkspaceByAgent(agentId: string): AgentWorkspace[] {
    return Array.from(this.workspaces.values()).filter(
      (ws) => ws.agentId === agentId,
    );
  }

  /**
   * List workspaces with optional filtering
   */
  listWorkspaces(filter?: WorkspaceFilter): AgentWorkspace[] {
    let workspaces = Array.from(this.workspaces.values());

    if (!filter) return workspaces;

    if (filter.agentId) {
      workspaces = workspaces.filter((ws) => ws.agentId === filter.agentId);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      workspaces = workspaces.filter((ws) => statuses.includes(ws.status));
    }

    if (filter.createdAfter) {
      workspaces = workspaces.filter(
        (ws) => ws.createdAt >= filter.createdAfter!,
      );
    }

    if (filter.createdBefore) {
      workspaces = workspaces.filter(
        (ws) => ws.createdAt <= filter.createdBefore!,
      );
    }

    return workspaces;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cleanup completed (merged) workspaces older than maxAge (ms)
   * Default: 24 hours
   */
  async cleanupCompleted(maxAge: number = 86400000): Promise<CleanupResult> {
    return this.cleanupByStatus(["merged"], maxAge);
  }

  /**
   * Cleanup failed/discarded workspaces older than maxAge (ms)
   * Default: 1 hour
   */
  async cleanupFailed(maxAge: number = 3600000): Promise<CleanupResult> {
    return this.cleanupByStatus(["failed", "discarded"], maxAge);
  }

  /**
   * Merge a workspace's branch into main and cleanup
   */
  async mergeAndCleanup(
    taskId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const workspace = this.workspaces.get(taskId);

    if (!workspace) {
      // No workspace for this task — no-op
      return { success: true };
    }

    try {
      // Publish if not already published
      if (workspace.status === "active") {
        await workspace.publish();
      }

      // Delegate merge to the appropriate strategy
      const merger = this.mergers.get(taskId) || new SharedMerger();
      const result = await merger.merge(workspace);

      if (result.success) {
        await merger.cleanup(workspace);

        // Remove from registries
        this.workspaces.delete(taskId);
        this.mergers.delete(taskId);
        logger.info(`Merged and cleaned up workspace for task: ${taskId}`);

        // Push to remote AFTER merge+cleanup (non-blocking — fire and forget)
        merger.pushMain().catch(err => {
          logger.warn(`Push main failed for task ${taskId}: ${err.message}`);
        });

        return { success: true };
      } else {
        return {
          success: false,
          error: `Merge conflicts in: ${result.conflicts?.join(", ")}`,
        };
      }
    } catch (error: any) {
      logger.error(`Merge failed for task ${taskId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the repo path
   */
  getRepoPath(): string {
    return this.workspacesRoot;
  }

  /**
   * Get workspace configuration
   */
  getConfig(): WorkspaceConfig {
    return { ...this.config };
  }

  /**
   * Get the underlying GitBranchManager
   */
  getGitManager(): GitBranchManager {
    return this.gitManager;
  }

  /**
   * Get count of active workspaces
   */
  get activeCount(): number {
    return this.workspaces.size;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN CLEANUP (v2.0 workspace isolation)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clean up all workspace directories for a completed plan.
   * Removes the `plan-{planId}/` directory and all task workspaces inside it.
   */
  async cleanupPlan(planId: string): Promise<void> {
    // Validate planId to prevent path traversal
    if (!/^[a-zA-Z0-9_\-]+$/.test(planId)) {
      throw new Error(`Invalid planId format: ${planId}`);
    }
    const planDir = path.resolve(this.workspacesRoot, `plan-${planId}`);
    if (!planDir.startsWith(path.resolve(this.workspacesRoot))) {
      throw new Error("Path escape detected in cleanupPlan");
    }

    // Remove worktrees from the primary clone before deleting directories
    const primaryClone = this.planRepos.get(planId);
    if (primaryClone) {
      try {
        const repoGitManager = new GitBranchManager(primaryClone, "main");
        const repoGit = repoGitManager.getGit();
        // Prune stale worktrees (handles already-deleted dirs gracefully)
        await repoGit.raw(["worktree", "prune"]);
      } catch {
        // Non-fatal — directory cleanup will still work
      }
      this.planRepos.delete(planId);
    }

    // Remove all workspace entries for this plan from registry
    for (const [taskId, ws] of this.workspaces) {
      if (ws.basePath.startsWith(planDir)) {
        this.workspaces.delete(taskId);
      }
    }

    // Remove plan directory from disk
    try {
      await fs.promises.rm(planDir, { recursive: true, force: true });
      logger.info(`Cleaned up plan directory: ${planDir}`);
    } catch (err) {
      logger.warn(`Failed to cleanup plan directory ${planDir}:`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH OPERATIONS (compatibility with WorkerPool)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a branch for an agent (used by WorkerPool.enableWorkspace)
   */
  async createAgentBranch(agentId: string): Promise<string> {
    const branchName = `agent/${agentId}`;

    if (await this.gitManager.branchExists(branchName)) {
      await this.gitManager.withLock(async () => {
        await this.gitManager.checkout(branchName);
      });
      return branchName;
    }

    await this.gitManager.withLock(async () => {
      await this.gitManager.createBranch(branchName);
    });
    return branchName;
  }

  /**
   * Checkout a branch
   */
  async checkoutBranch(branchName: string): Promise<void> {
    await this.gitManager.withLock(async () => {
      if (!(await this.gitManager.branchExists(branchName))) {
        await this.gitManager.createBranch(branchName);
      } else {
        await this.gitManager.checkout(branchName);
      }
    });
  }

  /**
   * Merge a branch into target
   */
  async mergeAgentBranch(
    branchName: string,
    targetBranch?: string,
  ): Promise<void> {
    const result = await this.gitManager.withLock(async () => {
      return this.gitManager.mergeBranch(branchName, targetBranch);
    });
    if (!result.success) {
      throw new Error(`Merge conflict: ${result.conflicts?.join(", ")}`);
    }
  }

  /**
   * Delete a branch
   */
  async deleteAgentBranch(branchName: string): Promise<void> {
    await this.gitManager.withLock(async () => {
      await this.gitManager.deleteBranch(branchName, true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cleanup workspaces by status and age
   */
  private async cleanupByStatus(
    statuses: WorkspaceStatus[],
    maxAge: number,
  ): Promise<CleanupResult> {
    const now = Date.now();
    const result: CleanupResult = { cleaned: 0, failed: 0, errors: [] };

    for (const [taskId, ws] of this.workspaces.entries()) {
      if (!statuses.includes(ws.status)) continue;
      if (now - ws.createdAt.getTime() < maxAge) continue;

      try {
        // Try to delete the branch
        try {
          await this.gitManager.withLock(async () => {
            await this.gitManager.deleteBranch(ws.branchName, true);
          });
        } catch {
          // Branch may already be deleted
        }

        this.workspaces.delete(taskId);
        result.cleaned++;
      } catch (err: any) {
        result.failed++;
        result.errors?.push(`${taskId}: ${err.message}`);
      }
    }

    // Also clean orphaned branches (branches not in registry)
    try {
      const branches = await this.gitManager.listBranches("^task-");
      const activeBranches = new Set(
        Array.from(this.workspaces.values()).map((ws) => ws.branchName),
      );

      for (const branch of branches) {
        if (!activeBranches.has(branch)) {
          try {
            await this.gitManager.withLock(async () => {
              await this.gitManager.deleteBranch(branch, true);
            });
            result.cleaned++;
            logger.debug(`Cleaned orphaned branch: ${branch}`);
          } catch {
            // Ignore cleanup failures for orphaned branches
          }
        }
      }
    } catch {
      // Ignore errors listing branches
    }

    if (result.cleaned > 0) {
      logger.info(
        `Cleanup: ${result.cleaned} cleaned, ${result.failed} failed`,
      );
    }

    return result;
  }

  /**
   * Clear all cached workspaces.
   * Called when a new plan is approved so stale workspaces (e.g. in "published"
   * status from a previous plan) are not reused for tasks with the same id.
   */
  clearWorkspaces(): void {
    const count = this.workspaces.size;
    this.workspaces.clear();
    if (count > 0) {
      logger.info(`Cleared ${count} cached workspace(s)`);
    }
  }

  /**
   * Forward events from a child workspace to the manager's event emitter
   */
  private forwardEvents(workspace: AgentWorkspace): void {
    const eventNames = [
      "workspace:created",
      "workspace:file:created",
      "workspace:file:updated",
      "workspace:file:deleted",
      "workspace:activity",
      "workspace:committed",
      "workspace:published",
      "workspace:merged",
      "workspace:discarded",
      "workspace:retry",
    ];

    for (const eventName of eventNames) {
      workspace.events.on(eventName, (data: any) => {
        this.events.emit(eventName, data);
      });
    }
  }
}
