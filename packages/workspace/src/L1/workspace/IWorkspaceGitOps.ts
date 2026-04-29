/**
 * IWorkspaceGitOps — Strategy for branch operations in AgentWorkspace.
 *
 * Two implementations:
 * - SharedGitOps: standard mode — workspace owns its branch lifecycle (checkout, create)
 * - WorktreeGitOps: worktree mode — branch IS the worktree, no checkout needed
 *
 * Replaces the `skipGitInit` boolean flag with polymorphism.
 */

import type { GitBranchManager } from "./GitBranchManager.js";

export interface IWorkspaceGitOps {
  /** Prepare branch before workspace initialization (create or checkout) */
  prepareBranch(branchName: string): Promise<void>;
  /** Ensure we're on the right branch before commit */
  ensureBranch(branchName: string): Promise<void>;
}

/** Standard mode: workspace owns its branch lifecycle */
export class SharedGitOps implements IWorkspaceGitOps {
  constructor(private gitManager: GitBranchManager) {}

  async prepareBranch(branchName: string): Promise<void> {
    const exists = await this.gitManager.branchExists(branchName);
    if (!exists) {
      await this.gitManager.createBranch(branchName);
    } else {
      await this.gitManager.checkout(branchName);
    }
  }

  async ensureBranch(branchName: string): Promise<void> {
    const current = await this.gitManager.getCurrentBranch();
    if (current !== branchName) {
      await this.gitManager.checkout(branchName);
    }
  }
}

/** Worktree mode: branch IS the worktree — no checkout, no branch creation */
export class WorktreeGitOps implements IWorkspaceGitOps {
  async prepareBranch(_branchName: string): Promise<void> {
    // Worktree is already on the correct branch — nothing to do
  }

  async ensureBranch(_branchName: string): Promise<void> {
    // Worktree IS the branch — checkout is impossible and unnecessary
  }
}
