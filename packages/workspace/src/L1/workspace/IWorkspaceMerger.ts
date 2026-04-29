/**
 * IWorkspaceMerger — Strategy for merging workspace branches.
 *
 * Two implementations:
 * - SharedMerger: merges task branch into main within the same repo
 * - WorktreeMerger: merges task branch in the PRIMARY CLONE (where main is checked out),
 *   then removes the worktree
 *
 * Replaces `if (isIsolated)` branching in WorkspaceManager.mergeAndCleanup().
 */

import simpleGit from "simple-git";
import type { AgentWorkspace } from "./AgentWorkspace.js";
import type { MergeResult } from "../../types/index.js";
import { rootLogger } from "../../logging.js";

const logger = rootLogger.child({ module: "WorkspaceMerger" });

export interface IWorkspaceMerger {
  /** Merge the workspace's task branch into main */
  merge(workspace: AgentWorkspace): Promise<MergeResult>;
  /** Clean up after successful merge (remove worktree, delete branch, etc.) */
  cleanup(workspace: AgentWorkspace): Promise<void>;
  /** Push merged main to remote (if configured) */
  pushMain(): Promise<void>;
}

/** Shared mode: merge task branch into main in the same repo */
export class SharedMerger implements IWorkspaceMerger {
  async merge(workspace: AgentWorkspace): Promise<MergeResult> {
    return workspace.merge();
  }

  async cleanup(_workspace: AgentWorkspace): Promise<void> {
    // Branch deletion handled by workspace.merge() internally
  }

  async pushMain(): Promise<void> {
    // Shared mode doesn't push — no remote configured
  }
}

/** Worktree mode: merge in the PRIMARY CLONE, then remove worktree */
export class WorktreeMerger implements IWorkspaceMerger {
  constructor(private primaryClonePath: string) {}

  async merge(workspace: AgentWorkspace): Promise<MergeResult> {
    const primaryGit = simpleGit(this.primaryClonePath);
    try {
      await primaryGit.merge([workspace.branchName, "--no-ff"]);
      const log = await primaryGit.log({ maxCount: 1 });
      logger.info(`Merged ${workspace.branchName} into main via primary clone`);
      return {
        success: true,
        ...(log.latest?.hash ? { mergeCommit: log.latest.hash } : {}),
      };
    } catch (err: any) {
      // Check for merge conflicts
      try {
        const status = await primaryGit.status();
        if (status.conflicted.length > 0) {
          // Abort the failed merge
          await primaryGit.merge(["--abort"]);
          return { success: false, conflicts: status.conflicted };
        }
      } catch {
        // Best effort conflict check
      }
      return { success: false, conflicts: [err.message] };
    }
  }

  async cleanup(workspace: AgentWorkspace): Promise<void> {
    const primaryGit = simpleGit(this.primaryClonePath);
    try {
      await primaryGit.raw(["worktree", "remove", workspace.basePath, "--force"]);
      logger.info(`Removed worktree at ${workspace.basePath}`);
    } catch {
      // Best effort — directory may already be gone
    }
  }

  async pushMain(): Promise<void> {
    const primaryGit = simpleGit(this.primaryClonePath);
    try {
      const remotes = await primaryGit.getRemotes();
      if (remotes.length > 0) {
        await primaryGit.push("origin", "main");
        logger.info(`Pushed main to remote from primary clone`);
      }
    } catch (err: any) {
      // Non-fatal — local merge succeeded
      logger.warn(`Push main to remote failed: ${err.message}`);
    }
  }
}
