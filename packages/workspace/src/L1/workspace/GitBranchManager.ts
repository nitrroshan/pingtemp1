/**
 * GitBranchManager — Low-level Git operations for branch management
 *
 * Wraps `simple-git` to provide a clean async API for:
 * - Branch CRUD (create, delete, merge, checkout)
 * - Commit operations (add, commit, history)
 * - Status and diff queries
 * - Repository initialization
 *
 * Branch naming convention: task-{taskId}-{slug}[-v{n}]
 *
 * @see feature_implementation_planning.md §3.1
 */

import { simpleGit, type SimpleGit, type LogResult } from "simple-git";
import fs from "fs";
import path from "path";
import { rootLogger } from "../../logging.js";
import type {
  BranchInfo,
  BranchStatusInfo,
  CommitInfo,
  MergeResult,
  WorkspaceError,
} from "../types/index.js";

const logger = rootLogger.child({ module: "GitBranchManager" });

/**
 * Simple async mutex — serializes git operations to prevent index.lock conflicts.
 * Multiple workspace initializations can race on the same repo; this ensures
 * only one git operation runs at a time.
 */
class GitMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // hand lock to next waiter
    } else {
      this.locked = false;
    }
  }
}

export class GitBranchManager {
  /** Path to the git repository */
  public readonly repoPath: string;
  /** Default branch name (usually 'main') */
  public readonly mainBranch: string;
  /** simple-git instance */
  private git: SimpleGit;
  /** Mutex to serialize git operations (prevents index.lock conflicts) */
  private mutex = new GitMutex();

  constructor(repoPath: string, mainBranch: string = "main", options?: { skipAutoInit?: boolean }) {
    this.repoPath = repoPath;
    this.mainBranch = mainBranch;
    // Ensure directory exists before creating simpleGit instance
    fs.mkdirSync(repoPath, { recursive: true });

    // CRITICAL: Ensure this directory has its own .git BEFORE any operations.
    // Without this, simple-git walks up to the PROJECT's .git and
    // any checkout/branch operation switches the developer's working branch.
    // Skip when cloning — clone creates its own .git.
    const gitDir = path.join(repoPath, ".git");
    if (!options?.skipAutoInit && !fs.existsSync(gitDir)) {
      try {
        require("child_process").execSync(`git init -b ${mainBranch}`, {
          cwd: repoPath,
          stdio: "pipe",
        });
        logger.info(`Auto-initialized isolated git repo at: ${repoPath}`);
      } catch (err) {
        logger.error(`Failed to auto-init git at ${repoPath}: ${err}`);
      }
    }

    this.git = simpleGit(repoPath);
    logger.debug(`GitBranchManager initialized at: ${repoPath}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPOSITORY INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize a new git repository at repoPath, or connect to existing one.
   * Creates the directory if it doesn't exist.
   * Creates an initial commit so branches can be created.
   */
  /**
   * Run a git operation under the mutex to prevent index.lock conflicts.
   * All public methods that touch the git index should go through this.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.mutex.acquire();
    try {
      return await fn();
    } finally {
      this.mutex.release();
    }
  }

  async initRepo(): Promise<void> {
    // Ensure directory exists
    await fs.promises.mkdir(this.repoPath, { recursive: true });

    const gitDir = path.join(this.repoPath, ".git");
    const exists = await this.directoryExists(gitDir);

    if (exists) {
      // Validate existing repo — ensure it's OUR repo, not a parent's
      try {
        const topLevel = await this.git.revparse(["--show-toplevel"]);
        const resolvedRepo = path.resolve(this.repoPath);
        const resolvedTop = path.resolve(topLevel.trim());
        if (resolvedTop !== resolvedRepo) {
          // simple-git found a parent .git — we need our own
          logger.warn(
            `Git repo at ${resolvedTop} is a parent of ${resolvedRepo} — initializing local repo`,
          );
          await this.git.init(["-b", this.mainBranch]);
          await this.seedInitialCommit();
          return;
        }
        await this.git.status();
        logger.info(`Connected to existing repo at: ${this.repoPath}`);
      } catch (err) {
        throw new Error(`Invalid git repository at ${this.repoPath}: ${err}`);
      }
    } else {
      // No .git here — but check if simple-git would walk up to a parent repo
      try {
        const topLevel = await this.git.revparse(["--show-toplevel"]);
        const resolvedRepo = path.resolve(this.repoPath);
        const resolvedTop = path.resolve(topLevel.trim());
        if (resolvedTop !== resolvedRepo) {
          logger.warn(
            `No local .git but parent repo found at ${resolvedTop} — initializing isolated repo at ${resolvedRepo}`,
          );
        }
      } catch {
        // No parent repo either — clean init
      }

      // Create new repo
      await this.git.init(["-b", this.mainBranch]);
      logger.info(
        `Created new repo at: ${this.repoPath} (branch: ${this.mainBranch})`,
      );

      await this.seedInitialCommit();
    }
  }

  /** Create initial commit with README + .gitignore so branches/worktrees can be created */
  async seedInitialCommit(): Promise<void> {
    const readmePath = path.join(this.repoPath, "README.md");
    if (!fs.existsSync(readmePath)) {
      await fs.promises.writeFile(
        readmePath,
        "# Agent Workspace\n\nInitialized by WorkspaceManager\n",
        "utf-8",
      );
    }

    const gitignorePath = path.join(this.repoPath, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      await fs.promises.writeFile(
        gitignorePath,
        [
          "node_modules/",
          "dist/",
          "build/",
          ".DS_Store",
          ".scratch/",
          ".ping/",
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    await this.git.add(["README.md", ".gitignore"]);
    await this.git.commit("Initial commit", {
      "--author": "WorkspaceManager <workspace@system.local>",
    });
    logger.info("Initial commit created");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new branch from baseBranch (defaults to mainBranch)
   */
  async createBranch(
    branchName: string,
    baseBranch?: string,
  ): Promise<BranchInfo> {
    const base = baseBranch || this.mainBranch;

    // Check if branch already exists
    if (await this.branchExists(branchName)) {
      throw new Error(`Branch '${branchName}' already exists`);
    }

    // Ensure clean working tree before switching branches
    await this.ensureClean();

    // Create branch from base
    await this.git.checkoutBranch(branchName, base);

    // Get HEAD commit info
    const log = await this.git.log({ maxCount: 1 });
    const headCommit = log.latest?.hash || "";

    logger.info(`Created branch '${branchName}' from '${base}'`);

    return {
      name: branchName,
      baseBranch: base,
      createdAt: new Date(),
      headCommit,
    };
  }

  /**
   * Delete a branch
   * @param force - Force delete even if not fully merged
   */
  async deleteBranch(
    branchName: string,
    force: boolean = false,
  ): Promise<void> {
    // Don't delete main branch
    if (branchName === this.mainBranch) {
      throw new Error(`Cannot delete main branch '${this.mainBranch}'`);
    }

    // Switch away from branch if currently on it
    const currentBranch = await this.getCurrentBranch();
    if (currentBranch === branchName) {
      await this.checkout(this.mainBranch);
    }

    if (force) {
      await this.git.branch(["-D", branchName]);
    } else {
      await this.git.branch(["-d", branchName]);
    }

    logger.info(`Deleted branch '${branchName}' (force: ${force})`);
  }

  /**
   * Files that are auto-resolved during merge conflicts.
   * These are infrastructure files that every task branch modifies identically —
   * accepting "theirs" (the task branch version) is always safe.
   */
  private static readonly AUTO_RESOLVE_FILES = new Set([
    ".gitignore",
    "workspace.json",
  ]);

  /**
   * Merge a branch into target (defaults to mainBranch)
   * Returns merge result with success status and potential conflicts.
   *
   * Auto-resolves conflicts in infrastructure files (.gitignore, workspace.json)
   * by accepting the incoming branch version. Only truly unresolvable conflicts
   * cause the merge to abort.
   */
  async mergeBranch(
    branchName: string,
    targetBranch?: string,
  ): Promise<MergeResult> {
    const target = targetBranch || this.mainBranch;

    // Checkout target branch
    await this.checkout(target);

    try {
      const result = await this.git.merge([branchName, "--no-ff"]);

      logger.info(`Merged '${branchName}' into '${target}'`);

      // Get the merge commit hash
      const log = await this.git.log({ maxCount: 1 });

      return {
        success: true,
        ...(log.latest?.hash ? { mergeCommit: log.latest.hash } : {}),
      };
    } catch (err: any) {
      // Check if it's a merge conflict
      const status = await this.git.status();
      if (status.conflicted.length > 0) {
        // Try to auto-resolve known infrastructure file conflicts
        const resolved = await this.autoResolveConflicts(
          status.conflicted,
          branchName,
        );

        // Check what's still conflicted after auto-resolution
        const remaining = status.conflicted.filter((f) => !resolved.has(f));

        if (remaining.length === 0) {
          // All conflicts auto-resolved — commit the merge
          try {
            await this.git.add(".");
            await this.git.commit(
              `Merge '${branchName}' into '${target}' (auto-resolved: ${[...resolved].join(", ")})`,
            );

            const log = await this.git.log({ maxCount: 1 });
            logger.info(
              `Merged '${branchName}' into '${target}' (auto-resolved: ${[...resolved].join(", ")})`,
            );

            return {
              success: true,
              ...(log.latest?.hash ? { mergeCommit: log.latest.hash } : {}),
            };
          } catch (commitErr) {
            logger.warn(
              `Auto-resolve commit failed for '${branchName}' → '${target}': ${commitErr}`,
            );
            // Fall through to abort
          }
        }

        // Unresolvable conflicts remain — abort the merge
        await this.git.merge(["--abort"]);

        logger.warn(
          `Merge conflict: '${branchName}' → '${target}', conflicts: ${remaining.join(", ")}` +
            (resolved.size > 0
              ? ` (auto-resolved: ${[...resolved].join(", ")})`
              : ""),
        );

        return {
          success: false,
          conflicts: remaining,
        };
      }

      throw err;
    }
  }

  /**
   * Auto-resolve conflicts for known infrastructure files.
   *
   * Strategy: accept the incoming branch version ("theirs") for files like
   * .gitignore and workspace.json, which every task branch modifies identically.
   * For .gitignore specifically, we also try a union merge (combine both sides
   * deduplicating lines) since all branches just append the same ignore entries.
   *
   * @returns Set of filenames that were successfully resolved
   */
  private async autoResolveConflicts(
    conflictedFiles: string[],
    branchName: string,
  ): Promise<Set<string>> {
    const resolved = new Set<string>();

    for (const file of conflictedFiles) {
      const basename = path.basename(file);
      if (!GitBranchManager.AUTO_RESOLVE_FILES.has(basename)) continue;

      try {
        if (basename === ".gitignore") {
          // Union strategy: combine lines from both sides, deduplicate
          await this.resolveGitignoreUnion(file);
        } else {
          // Accept theirs (incoming branch version)
          await this.git.checkout(["--theirs", file]);
        }
        await this.git.add(file);
        resolved.add(file);
        logger.debug(`Auto-resolved conflict: ${file} (from ${branchName})`);
      } catch (resolveErr) {
        logger.warn(
          `Failed to auto-resolve ${file}: ${resolveErr}`,
        );
      }
    }

    return resolved;
  }

  /**
   * Resolve a .gitignore conflict by union-merging both sides:
   * reads both versions, combines lines, deduplicates, writes result.
   */
  private async resolveGitignoreUnion(filePath: string): Promise<void> {
    const absPath = path.join(this.repoPath, filePath);

    // Read the conflicted file — contains conflict markers
    const raw = fs.readFileSync(absPath, "utf-8");

    // Extract all non-marker lines and deduplicate
    const lines = raw
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("<<<<<<<") &&
          !line.startsWith("=======") &&
          !line.startsWith(">>>>>>>"),
      )
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const unique = [...new Set(lines)];
    fs.writeFileSync(absPath, unique.join("\n") + "\n", "utf-8");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH INFO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the status of a branch relative to main
   */
  async getBranchStatus(branchName: string): Promise<BranchStatusInfo> {
    if (!(await this.branchExists(branchName))) {
      return {
        name: branchName,
        exists: false,
        aheadOfMain: 0,
        behindOfMain: 0,
        files: { added: 0, modified: 0, deleted: 0 },
      };
    }

    // Get ahead/behind counts
    let aheadOfMain = 0;
    let behindOfMain = 0;
    try {
      const revList = await this.git.raw([
        "rev-list",
        "--left-right",
        "--count",
        `${this.mainBranch}...${branchName}`,
      ]);
      const [behind, ahead] = revList.trim().split(/\s+/).map(Number);
      aheadOfMain = ahead || 0;
      behindOfMain = behind || 0;
    } catch {
      // May fail if branches don't share history
    }

    // Get last commit
    let lastCommit: CommitInfo | undefined;
    try {
      const log = await this.git.log({
        maxCount: 1,
        from: branchName,
      });
      if (log.latest) {
        lastCommit = {
          hash: log.latest.hash,
          message: log.latest.message,
          author: log.latest.author_name,
          timestamp: new Date(log.latest.date),
        };
      }
    } catch {
      // No commits on branch
    }

    // Get file diff stats
    let added = 0;
    let modified = 0;
    let deleted = 0;
    try {
      const diffSummary = await this.git.diffSummary([
        this.mainBranch,
        branchName,
      ]);
      for (const file of diffSummary.files) {
        if (file.binary) continue;
        // simple-git doesn't distinguish add vs modify in diffSummary cleanly,
        // so we count insertions vs deletions as a proxy
        if (file.insertions > 0 && file.deletions === 0) {
          added++;
        } else if (file.insertions === 0 && file.deletions > 0) {
          deleted++;
        } else {
          modified++;
        }
      }
    } catch {
      // May fail if no common ancestor
    }

    return {
      name: branchName,
      exists: true,
      aheadOfMain,
      behindOfMain,
      ...(lastCommit ? { lastCommit } : {}),
      files: { added, modified, deleted },
    };
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    const summary = await this.git.branchLocal();
    return summary.all.includes(branchName);
  }

  /**
   * Get the currently checked-out branch
   */
  async getCurrentBranch(): Promise<string> {
    const summary = await this.git.branchLocal();
    return summary.current;
  }

  /**
   * List all branches matching a pattern
   */
  async listBranches(pattern?: string): Promise<string[]> {
    const summary = await this.git.branchLocal();
    if (!pattern) return summary.all;
    const regex = new RegExp(pattern);
    return summary.all.filter((b) => regex.test(b));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE OPERATIONS (within current branch)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ensure the working tree is clean before branch operations.
   * Stages and commits any pending changes to avoid checkout conflicts.
   */
  async ensureClean(): Promise<void> {
    const status = await this.git.status();
    if (!status.isClean()) {
      await this.git.add("-A");
      await this.git.commit(
        "Auto-commit: clean working tree before branch switch",
        {
          "--author": "system <system@agent.local>",
        },
      );
      logger.debug("Auto-committed pending changes before branch operation");
    }
  }

  /**
   * Checkout a branch.
   * Callers must hold the git mutex (via withLock) when calling this
   * as part of a multi-step operation.
   */
  async checkout(branchName: string): Promise<void> {
    await this.ensureClean();
    await this.git.checkout(branchName);
    logger.debug(`Checked out: ${branchName}`);
  }

  /**
   * Stage a specific file
   */
  async addFile(filePath: string): Promise<void> {
    await this.git.add(filePath);
  }

  /**
   * Stage all changes
   */
  async addAll(): Promise<void> {
    await this.git.add("-A");
  }

  /**
   * Commit staged changes.
   * Callers must hold the git mutex (via withLock) when calling this
   * as part of a multi-step operation.
   */
  async commit(message: string, author?: string): Promise<CommitInfo> {
    const authorStr = author || "AgentWorkspace <agent@workspace.local>";
    const result = await this.git.commit(message, {
      "--author": authorStr,
    });

    const hash = result.commit || "";

    logger.debug(`Committed: ${hash.substring(0, 7)} — ${message}`);

    return {
      hash,
      message,
      author: authorStr.split(" <")[0] ?? authorStr,
      timestamp: new Date(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reset current branch to a specific commit
   */
  async resetToCommit(commitHash: string): Promise<void> {
    await this.git.reset(["--hard", commitHash]);
    logger.info(`Reset to commit: ${commitHash}`);
  }

  /**
   * Get commit history for a branch
   */
  async getCommitHistory(
    branchName?: string,
    limit: number = 20,
  ): Promise<CommitInfo[]> {
    const options: Record<string, any> = { maxCount: limit };

    // If branch specified and not currently on it, use "from"
    if (branchName) {
      const current = await this.getCurrentBranch();
      if (current !== branchName) {
        // Log from the specified branch
        try {
          await this.checkout(branchName);
        } catch {
          // Branch might not exist
          return [];
        }
      }
    }

    try {
      const log: LogResult = await this.git.log(options);
      return log.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        author: entry.author_name,
        timestamp: new Date(entry.date),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get the current status of the working directory
   */
  async getStatus(): Promise<{
    staged: string[];
    modified: string[];
    untracked: string[];
    conflicted: string[];
  }> {
    const status = await this.git.status();
    return {
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      conflicted: status.conflicted,
    };
  }

  /**
   * Get list of changed files (modified + new + deleted)
   */
  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.modified,
      ...status.not_added,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map((r) => r.to),
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLONE SUPPORT (Phase 7)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clone a remote repository into a target directory.
   * After cloning, re-points this GitBranchManager at the cloned repo.
   *
   * @param repoUrl - Git URL (HTTPS or SSH)
   * @param targetDir - Directory to clone into
   * @param options - Optional branch and sparse checkout config
   */
  async clone(
    repoUrl: string,
    targetDir: string,
    options?: {
      branch?: string;
      sparse?: string[];
    },
  ): Promise<void> {
    const args: string[] = [];

    if (options?.branch) {
      args.push("--branch", options.branch);
    }

    if (options?.sparse && options.sparse.length > 0) {
      // Use --no-checkout for sparse, then configure sparse-checkout
      args.push("--no-checkout", "--filter=blob:none");
    }

    args.push("--single-branch");

    // Clone using a temporary git instance (not tied to any repo)
    const tmpGit = simpleGit();
    try {
      await tmpGit.clone(repoUrl, targetDir, args);
    } catch (err: any) {
      // Empty repos have no branches — retry without --branch and --single-branch
      if (err.message?.includes("not found in upstream") || err.message?.includes("empty repository")) {
        logger.info(`Branch not found — cloning without branch filter (empty repo?)`);
        const fallbackArgs = args.filter(a => a !== "--single-branch" && a !== "--branch" && a !== (options?.branch || ""));
        // Remove --branch and its value
        const cleanArgs: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--branch") { i++; continue; } // skip --branch and next arg
          if (args[i] === "--single-branch") continue;
          cleanArgs.push(args[i]);
        }
        await tmpGit.clone(repoUrl, targetDir, cleanArgs);
      } else {
        throw err;
      }
    }

    // Point this manager at the cloned repo
    this.git = simpleGit(targetDir);

    // Handle sparse checkout
    if (options?.sparse && options.sparse.length > 0) {
      await this.git.raw(["sparse-checkout", "init", "--cone"]);
      await this.git.raw(["sparse-checkout", "set", ...options.sparse]);
      await this.git.checkout(options?.branch || this.mainBranch);
    }

    logger.info(`Cloned ${repoUrl} → ${targetDir}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the simple-git instance for advanced operations
   */
  getGit(): SimpleGit {
    return this.git;
  }

  /**
   * Check if a directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOTE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add or update a git remote.
   * If the remote already exists, updates its URL.
   */
  async addRemote(name: string, url: string): Promise<void> {
    await this.mutex.acquire();
    try {
      const remotes = await this.git.getRemotes(true);
      const existing = remotes.find((r) => r.name === name);
      if (existing) {
        await this.git.remote(["set-url", name, url]);
        logger.info(`Remote "${name}" URL updated`);
      } else {
        await this.git.addRemote(name, url);
        logger.info(`Remote "${name}" added: ${url}`);
      }
    } finally {
      this.mutex.release();
    }
  }

  /** List configured remotes. */
  async getRemotes(): Promise<Array<{ name: string; refs: { fetch: string; push: string } }>> {
    return this.git.getRemotes(true);
  }

  /**
   * Push a branch to a remote.
   * @param remote - Remote name (default: "origin")
   * @param branch - Branch to push (default: current branch)
   */
  async push(remote: string = "origin", branch?: string): Promise<void> {
    await this.mutex.acquire();
    try {
      const branchName = branch || (await this.git.revparse(["--abbrev-ref", "HEAD"]));
      await this.git.push(remote, branchName, ["--set-upstream"]);
      logger.info(`Pushed ${branchName} to ${remote}`);
    } finally {
      this.mutex.release();
    }
  }
}
