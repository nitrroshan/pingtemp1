/**
 * AgentWorkspace — High-level workspace API for agent file operations
 *
 * Provides an isolated, git-backed workspace for one agent working on one task.
 * All file operations are sandboxed within the workspace directory.
 * Activity logging captures tool calls, decisions, and outcomes.
 *
 * Lifecycle:
 *   initialize() → createFile/updateFile/logActivity → commit() → publish() → merge()
 *   On failure: discard() or retry()
 *
 * @see feature_implementation_planning.md §3.2
 */

import { EventEmitter } from "events";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { rootLogger } from "../../logging.js";
import fg from "fast-glob";
import { rgPath } from "@vscode/ripgrep";
import { GitBranchManager } from "./GitBranchManager.js";
import type { IWorkspaceGitOps } from "./IWorkspaceGitOps.js";
import { SharedGitOps } from "./IWorkspaceGitOps.js";
import { Scratchpad } from "./Scratchpad.js";
import { WorkspaceSearchIndex } from "./search/WorkspaceSearchIndex.js";
import crypto from "crypto";
import type {
  ArtifactCategory,
  ActivityEntry,
  CommitInfo,
  FileInfo,
  MergeResult,
  WorkspaceInitOptions,
  WorkspaceMetadata,
  WorkspaceStatus,
  WorkspaceConfig,
  WorkspaceError,
} from "../../types/index.js";
import type {
  OutputManifest,
  OutputEntry,
} from "../../types/output-manifest.types.js";

const logger = rootLogger.child({ module: "AgentWorkspace" });

/**
 * Generate a URL-safe slug from a task description or ID
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
}

export class AgentWorkspace {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  /** Unique workspace identifier */
  public readonly id: string;
  /** Owning agent ID */
  public readonly agentId: string;
  /** Associated task ID */
  public readonly taskId: string;
  /** Git branch name: task-{taskId}-{slug}[-v{n}] */
  public readonly branchName: string;
  /** File system path to workspace root */
  public readonly basePath: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Current lifecycle status */
  private _status: WorkspaceStatus = "initializing";
  /** When this workspace was created */
  public readonly createdAt: Date = new Date();
  /** Last activity timestamp */
  private _lastActivityAt: Date = new Date();
  /** Retry count (0 = first attempt) */
  private retryCount: number;
  /** Previous workspace ID (if retry) */
  private previousVersion?: string;
  /** Knowledge refs pulled into context */
  private knowledgeRefs: string[] = [];
  /** Dependency task IDs */
  private dependencyTasks: string[] = [];
  /** Activity entries (also persisted to activity.jsonl) */
  private activityLog: ActivityEntry[] = [];
  /** Published artifact list */
  private publishedArtifacts: { id: string; path: string; type: string }[] = [];

  /** Event emitter for workspace-level events */
  public readonly events = new EventEmitter();

  /** Low-level git operations */
  private gitManager: GitBranchManager;

  /** Agent's private scratchpad (Zone 1 — .scratch/ directory, gitignored) */
  public readonly scratchpad: Scratchpad;

  /** Keyword search index (Phase 8 — MiniSearch BM25-like) */
  public readonly search: WorkspaceSearchIndex;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  /** Strategy for branch operations — SharedGitOps (standard) or WorktreeGitOps (worktree) */
  private gitOps: IWorkspaceGitOps;

  constructor(opts: {
    id: string;
    agentId: string;
    taskId: string;
    branchName: string;
    basePath: string;
    gitManager: GitBranchManager;
    retryCount?: number;
    previousVersion?: string;
    gitOps?: IWorkspaceGitOps;
  }) {
    this.id = opts.id;
    this.agentId = opts.agentId;
    this.taskId = opts.taskId;
    this.branchName = opts.branchName;
    this.basePath = opts.basePath;
    this.gitManager = opts.gitManager;
    this.retryCount = opts.retryCount || 0;
    this.gitOps = opts.gitOps || new SharedGitOps(opts.gitManager);
    if (opts.previousVersion !== undefined) {
      this.previousVersion = opts.previousVersion;
    }
    this.scratchpad = new Scratchpad(opts.basePath);
    this.search = new WorkspaceSearchIndex(opts.basePath);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  get status(): WorkspaceStatus {
    return this._status;
  }

  get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the workspace:
   * - Create the branch
   * - Create directory structure (artifacts/, activity/, context/)
   * - Write workspace.json metadata
   */
  async initialize(): Promise<void> {
    this._status = "initializing";

    await this.gitManager.withLock(async () => {
      // Delegate branch preparation to gitOps strategy
      // SharedGitOps: creates or checks out the branch
      // WorktreeGitOps: no-op (worktree is already on correct branch)
      await this.gitOps.prepareBranch(this.branchName);

      // Create workspace directory structure
      const dirs = [
        path.join(this.basePath, "artifacts", "code"),
        path.join(this.basePath, "artifacts", "docs"),
        path.join(this.basePath, "artifacts", "data"),
        path.join(this.basePath, "activity"),
        path.join(this.basePath, "context", "knowledge"),
        path.join(this.basePath, "context", "dependencies"),
      ];

      for (const dir of dirs) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Write workspace.json
      await this.writeWorkspaceMetadata();

      // Create empty activity log
      const activityPath = path.join(
        this.basePath,
        "activity",
        "activity.jsonl",
      );
      try {
        await fs.promises.access(activityPath);
      } catch {
        await fs.promises.writeFile(activityPath, "", "utf-8");
      }

      // Initialize scratchpad (Zone 1 — private, gitignored)
      await this.scratchpad.initialize();

      // Ensure .scratch/ and .ping/ are gitignored.
      // Normalize content to avoid whitespace diffs across branches.
      const gitignorePath = path.join(this.basePath, ".gitignore");
      const ignoreEntries = [".scratch/", ".ping/"];
      try {
        const existing = await fs.promises.readFile(gitignorePath, "utf-8");
        const lines = existing.split("\n").map((l) => l.trim());
        const missing = ignoreEntries.filter((e) => !lines.includes(e));
        if (missing.length > 0) {
          // Rebuild normalized file: existing trimmed lines + missing, trailing newline
          const merged = [...lines.filter((l) => l.length > 0), ...missing];
          await fs.promises.writeFile(
            gitignorePath,
            merged.join("\n") + "\n",
            "utf-8",
          );
        }
      } catch {
        await fs.promises.writeFile(
          gitignorePath,
          ignoreEntries.join("\n") + "\n",
          "utf-8",
        );
      }

      // Set status to active BEFORE writing metadata so workspace.json has correct status
      this._status = "active";

      // Write workspace.json with "active" status
      await this.writeWorkspaceMetadata();

      // Stage and commit the initial structure
      await this.gitManager.addAll();
      await this.gitManager.commit(
        `Initialize workspace for task ${this.taskId}`,
        `${this.agentId} <${this.agentId}@agent.local>`,
      );
    });

    this._lastActivityAt = new Date();

    // Build initial search index (non-blocking)
    this.search.indexWorkspace().catch((err) => {
      logger.debug(`Initial search index build failed: ${err}`);
    });

    this.events.emit("workspace:created", {
      workspaceId: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      branchName: this.branchName,
    });

    logger.info(
      `Workspace initialized: ${this.id} on branch '${this.branchName}'`,
    );
  }

  /**
   * Initialize workspace from a remote git repo (Phase 7 — Clone Mode).
   *
   * Clones the repo into `basePath`, creates a task branch, and adds
   * `.ping/` (our metadata) and `.scratch/` (scratchpad), both gitignored.
   *
   * The existing `initialize()` method remains for basic (no-repo) workspaces.
   */
  async initializeFromRepo(options: WorkspaceInitOptions): Promise<void> {
    this._status = "initializing";

    if (options.repoUrl) {
      // Clone the repo into basePath
      // Use GIT_ASKPASS for auth — token never embedded in URL or .git/config
      let cloneEnv: Record<string, string> | undefined;
      if (options.authToken && options.repoUrl.startsWith("https://")) {
        const askPassScript = path.join(os.tmpdir(), `git-askpass-${this.taskId}-${Date.now()}.sh`);
        await fs.promises.writeFile(askPassScript, `#!/bin/sh\necho "${options.authToken}"`, { mode: 0o700 });
        cloneEnv = { GIT_ASKPASS: askPassScript, GIT_TERMINAL_PROMPT: "0" };
      }
      try {
        await this.gitManager.clone(options.repoUrl, this.basePath, {
          branch: options.repoBranch,
          sparse: options.sparse,
          env: cloneEnv,
        });
      } finally {
        // Clean up the askpass script
        if (cloneEnv?.GIT_ASKPASS) {
          await fs.promises.unlink(cloneEnv.GIT_ASKPASS).catch(() => {});
        }
      }
    } else if (options.localPath) {
      // Copy from local folder
      await this.copyDir(options.localPath, this.basePath);
      // Initialize git if not already a repo
      const gitDir = path.join(this.basePath, ".git");
      try {
        await fs.promises.access(gitDir);
      } catch {
        await this.gitManager.withLock(async () => {
          await this.gitManager.initRepo();
        });
      }
    }

    await this.gitManager.withLock(async () => {
      // Create task branch
      const branchExists = await this.gitManager.branchExists(this.branchName);
      if (!branchExists) {
        await this.gitManager.createBranch(this.branchName);
      } else {
        await this.gitManager.checkout(this.branchName);
      }

      // Create .ping/ directory for our workspace metadata
      const pingDir = path.join(this.basePath, ".ping");
      await fs.promises.mkdir(pingDir, { recursive: true });

      // Write workspace.json to .ping/ instead of root (to not pollute the cloned repo)
      const metadata = this.buildWorkspaceMetadataObj();
      const metadataPath = path.join(pingDir, "workspace.json");
      await fs.promises.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2),
        "utf-8",
      );

      // Create empty activity log in .ping/
      const activityPath = path.join(pingDir, "activity.jsonl");
      try {
        await fs.promises.access(activityPath);
      } catch {
        await fs.promises.writeFile(activityPath, "", "utf-8");
      }

      // Initialize scratchpad
      await this.scratchpad.initialize();

      // Ensure .ping/ and .scratch/ are gitignored.
      // Normalize content to avoid whitespace diffs across branches.
      const gitignorePath = path.join(this.basePath, ".gitignore");
      const ignoreEntries = [".scratch/", ".ping/"];
      try {
        const existing = await fs.promises.readFile(gitignorePath, "utf-8");
        const lines = existing.split("\n").map((l) => l.trim());
        const missing = ignoreEntries.filter((e) => !lines.includes(e));
        if (missing.length > 0) {
          const merged = [...lines.filter((l) => l.length > 0), ...missing];
          await fs.promises.writeFile(
            gitignorePath,
            merged.join("\n") + "\n",
            "utf-8",
          );
        }
      } catch {
        await fs.promises.writeFile(
          gitignorePath,
          ignoreEntries.join("\n") + "\n",
          "utf-8",
        );
      }

      this._status = "active";

      // Stage and commit the metadata additions
      await this.gitManager.addAll();
      await this.gitManager.commit(
        `Initialize workspace for task ${this.taskId} (repo clone)`,
        `${this.agentId} <${this.agentId}@agent.local>`,
      );
    });

    this._lastActivityAt = new Date();

    this.events.emit("workspace:created", {
      workspaceId: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      branchName: this.branchName,
    });

    logger.info(
      `Workspace initialized from repo: ${this.id} on branch '${this.branchName}'`,
    );
  }

  /**
   * Pull context into the workspace
   * - L2: Copies dependency task outputs into context/dependencies/
   * - L3: Copies knowledge docs into context/knowledge/
   *
   * Both layers are stubs — L2 artifact pulling and L3 knowledge
   * retrieval will be implemented in v1.1 and v2.0 respectively.
   */
  async pullContext(knowledgeRefs: string[]): Promise<void> {
    this.knowledgeRefs = knowledgeRefs;
    // L2 (dependency artifacts) and L3 (knowledge base) context pulling
    // will be implemented when those layers are available.
    // For now, just record the refs in workspace.json
    await this.writeWorkspaceMetadata();
    logger.debug(
      `Context refs recorded for workspace ${this.id}: ${knowledgeRefs.length} refs`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new file in the workspace
   * Path is relative to workspace basePath (sandboxed)
   */
  async createFile(relativePath: string, content: string): Promise<FileInfo> {
    this.assertWritable();
    const safePath = this.sanitizePath(relativePath);
    const fullPath = path.join(this.basePath, safePath);

    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    await fs.promises.writeFile(fullPath, content, "utf-8");

    this._lastActivityAt = new Date();
    this.events.emit("workspace:file:created", {
      workspaceId: this.id,
      path: safePath,
    });

    // Auto-reindex for search
    this.search.scheduleReindex(safePath);

    logger.debug(`File created: ${safePath}`);

    return {
      path: safePath,
      name: path.basename(safePath),
      type: "file",
      size: Buffer.byteLength(content, "utf-8"),
      lastModified: new Date(),
    };
  }

  /**
   * Read a file from the workspace
   */
  async readFile(relativePath: string): Promise<string> {
    const safePath = this.sanitizePath(relativePath);
    const fullPath = path.join(this.basePath, safePath);

    try {
      return await fs.promises.readFile(fullPath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`File not found: ${safePath} in workspace ${this.id}`);
      }
      throw err;
    }
  }

  /**
   * Update an existing file
   */
  async updateFile(relativePath: string, content: string): Promise<FileInfo> {
    this.assertWritable();
    const safePath = this.sanitizePath(relativePath);
    const fullPath = path.join(this.basePath, safePath);

    // Check file exists
    try {
      await fs.promises.access(fullPath);
    } catch {
      throw new Error(
        `File not found for update: ${safePath} in workspace ${this.id}`,
      );
    }

    await fs.promises.writeFile(fullPath, content, "utf-8");

    this._lastActivityAt = new Date();
    this.events.emit("workspace:file:updated", {
      workspaceId: this.id,
      path: safePath,
    });

    // Auto-reindex for search
    this.search.scheduleReindex(safePath);

    logger.debug(`File updated: ${safePath}`);

    return {
      path: safePath,
      name: path.basename(safePath),
      type: "file",
      size: Buffer.byteLength(content, "utf-8"),
      lastModified: new Date(),
    };
  }

  /**
   * Delete a file from the workspace
   */
  async deleteFile(relativePath: string): Promise<void> {
    this.assertWritable();
    const safePath = this.sanitizePath(relativePath);
    const fullPath = path.join(this.basePath, safePath);

    await fs.promises.unlink(fullPath);

    this._lastActivityAt = new Date();
    this.events.emit("workspace:file:deleted", {
      workspaceId: this.id,
      path: safePath,
    });

    // Auto-reindex for search (remove from index)
    this.search.scheduleReindex(safePath, true);

    logger.debug(`File deleted: ${safePath}`);
  }

  /**
   * List files in a directory within the workspace
   */
  async listFiles(directory: string = "."): Promise<FileInfo[]> {
    const safePath = this.sanitizePath(directory);
    const fullPath = path.join(this.basePath, safePath);

    try {
      const entries = await fs.promises.readdir(fullPath, {
        withFileTypes: true,
      });

      const files: FileInfo[] = [];
      for (const entry of entries) {
        // Skip .git directory
        if (entry.name === ".git") continue;

        const entryPath = path.join(safePath, entry.name);
        if (entry.isFile()) {
          try {
            const stats = await fs.promises.stat(
              path.join(fullPath, entry.name),
            );
            files.push({
              path: entryPath,
              name: entry.name,
              type: "file",
              size: stats.size,
              lastModified: stats.mtime,
            });
          } catch {
            files.push({ path: entryPath, name: entry.name, type: "file" });
          }
        } else if (entry.isDirectory()) {
          files.push({
            path: entryPath,
            name: entry.name,
            type: "directory",
          });
        }
      }

      return files;
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * Check if a file exists in the workspace
   */
  async fileExists(relativePath: string): Promise<boolean> {
    const safePath = this.sanitizePath(relativePath);
    const fullPath = path.join(this.basePath, safePath);
    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVITY LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log an activity entry (tool call, decision, error, etc.)
   * Appends to activity/activity.jsonl
   */
  async logActivity(entry: ActivityEntry): Promise<void> {
    // Ensure timestamp
    if (!entry.timestamp) {
      entry.timestamp = new Date();
    }

    this.activityLog.push(entry);
    this._lastActivityAt = entry.timestamp;

    // Append to JSONL file
    const activityPath = path.join(this.basePath, "activity", "activity.jsonl");
    const line = JSON.stringify(entry) + "\n";

    try {
      await fs.promises.appendFile(activityPath, line, "utf-8");
    } catch (err) {
      logger.warn(`Failed to write activity log: ${err}`);
    }

    this.events.emit("workspace:activity", {
      workspaceId: this.id,
      entry,
    });
  }

  /**
   * Get all activity entries
   */
  async getActivityLog(): Promise<ActivityEntry[]> {
    // Return in-memory log if available
    if (this.activityLog.length > 0) {
      return [...this.activityLog];
    }

    // Otherwise read from file
    const activityPath = path.join(this.basePath, "activity", "activity.jsonl");
    try {
      const content = await fs.promises.readFile(activityPath, "utf-8");
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ActivityEntry);
    } catch {
      return [];
    }
  }

  /**
   * Get a human-readable summary of activity for L2 publish
   */
  async getActivitySummary(): Promise<string> {
    const entries = await this.getActivityLog();
    if (entries.length === 0) return "No activity recorded.";

    const toolCalls = entries.filter((e) => e.type === "tool_call");
    const errors = entries.filter((e) => e.type === "error");
    const decisions = entries.filter((e) => e.type === "decision");

    const lines: string[] = [
      `## Activity Summary — Task ${this.taskId}`,
      ``,
      `- **Total entries:** ${entries.length}`,
      `- **Tool calls:** ${toolCalls.length}`,
      `- **Decisions:** ${decisions.length}`,
      `- **Errors:** ${errors.length}`,
      ``,
    ];

    if (toolCalls.length > 0) {
      lines.push(`### Tool Calls`);
      for (const tc of toolCalls.slice(0, 20)) {
        lines.push(
          `- \`${tc.tool}\` ${tc.duration ? `(${tc.duration}ms)` : ""}`,
        );
      }
      if (toolCalls.length > 20) {
        lines.push(`- ... and ${toolCalls.length - 20} more`);
      }
      lines.push("");
    }

    if (errors.length > 0) {
      lines.push(`### Errors`);
      for (const err of errors) {
        lines.push(`- ${err.output || err.tool || "Unknown error"}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Commit all current changes
   */
  async commit(message: string): Promise<CommitInfo> {
    this.assertWritable();

    const commitInfo = await this.gitManager.withLock(async () => {
      return this._commitGitOps(message);
    });

    this._lastActivityAt = new Date();
    this.events.emit("workspace:committed", {
      workspaceId: this.id,
      commitHash: commitInfo.hash,
      message,
    });

    logger.info(`Committed: ${commitInfo.hash.substring(0, 7)} — ${message}`);

    return commitInfo;
  }

  /**
   * Internal commit logic — must be called while holding the git mutex.
   * Used by commit() and publish() to avoid nested lock acquisition.
   */
  private async _commitGitOps(message: string): Promise<CommitInfo> {
    // Delegate branch check to gitOps strategy
    // SharedGitOps: checks out branch if not current
    // WorktreeGitOps: no-op (worktree IS the branch)
    await this.gitOps.ensureBranch(this.branchName);

    // Update workspace.json BEFORE staging so it's included in the commit
    await this.writeWorkspaceMetadata();

    // Stage all changes
    await this.gitManager.addAll();

    // Commit
    return this.gitManager.commit(
      message,
      `${this.agentId} <${this.agentId}@agent.local>`,
    );
  }

  /**
   * Get commit history for this workspace's branch
   */
  async getHistory(): Promise<CommitInfo[]> {
    return this.gitManager.getCommitHistory(this.branchName);
  }

  /**
   * Revert the workspace to a specific commit
   */
  async revertToCommit(commitHash: string): Promise<void> {
    this.assertWritable();

    await this.gitManager.withLock(async () => {
      await this.gitManager.checkout(this.branchName);
      await this.gitManager.resetToCommit(commitHash);
    });

    logger.info(`Workspace ${this.id} reverted to commit: ${commitHash}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Push the current branch to a remote.
   * Used by workspace isolation (v2.0) to push task results back to the repo.
   */
  async pushToRemote(remote: string = "origin"): Promise<void> {
    if (this._status !== "active" && this._status !== "published") {
      throw new Error(`Cannot push: workspace is ${this._status}`);
    }
    // Commit any uncommitted changes
    const status = await this.gitManager.getStatus();
    if (status.staged.length > 0 || status.modified.length > 0 || status.untracked.length > 0) {
      await this.commit("Task complete: final state");
    }
    await this.gitManager.push(remote, this.branchName);
  }

  /**
   * Publish workspace — collect outputs and write OutputManifest
   * Writes manifest to `.ping/outputs/{taskId}.json` and returns it
   *
   * Replaces old Artifact[]-based publish as of v1.1.
   */
  async publish(goalId: string = "unknown"): Promise<OutputManifest> {
    this.assertWritable();

    const startTime = Date.now();

    // Commit any uncommitted changes (under lock)
    const changedFiles = await this.gitManager.getChangedFiles();
    if (changedFiles.length > 0) {
      await this.gitManager.withLock(async () => {
        await this._commitGitOps(`Publish: task-${this.taskId}`);
      });
    }

    // Count commits on this branch
    let commitCount = 0;
    try {
      const history = await this.gitManager.getCommitHistory(this.branchName);
      commitCount = history.length;
    } catch {
      // Non-critical
    }

    // Collect all workspace files as OutputEntry[] (excluding .git, .ping, .scratch, workspace.json)
    const outputs: OutputEntry[] = [];
    const excludeDirs = new Set([".git", ".ping", ".scratch", "node_modules"]);
    const excludeFiles = new Set(["workspace.json"]);

    const collectFiles = async (dir: string, prefix: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (excludeDirs.has(entry.name) || excludeFiles.has(entry.name)) continue;
          const entryPath = path.join(dir, entry.name);
          const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
          if (entry.isFile()) {
            const stat = await fs.promises.stat(entryPath);
            const content = await fs.promises.readFile(entryPath);
            const hash = crypto
              .createHash("sha256")
              .update(content)
              .digest("hex");
            outputs.push({
              path: relativePath,
              category: this.inferCategory(entry.name),
              sizeBytes: stat.size,
              contentHash: hash,
            });
          } else if (entry.isDirectory()) {
            await collectFiles(entryPath, relativePath);
          }
        }
      } catch {
        // Directory may not exist or be empty
      }
    };

    await collectFiles(this.basePath, "");

    // Generate activity summary
    const activitySummary =
      (await this.getActivitySummary()) || "No activity recorded.";

    // Build manifest
    const manifest: OutputManifest = {
      taskId: this.taskId,
      role: this.agentId,
      agentId: this.agentId,
      goalId,
      outputs,
      activitySummary,
      publishedAt: new Date().toISOString(),
      metrics: {
        filesCreated: outputs.length,
        commits: commitCount,
        duration: Date.now() - startTime,
      },
    };

    // Write manifest to .ping/outputs/{taskId}.json
    const pingOutputsDir = path.join(this.basePath, ".ping", "outputs");
    await fs.promises.mkdir(pingOutputsDir, { recursive: true });
    const manifestPath = path.join(pingOutputsDir, `${this.taskId}.json`);
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    // Update internal state for metadata
    this.publishedArtifacts = outputs.map((o) => ({
      id: `${this.taskId}-${o.path.replace(/[\/\\]/g, "-")}`,
      path: o.path,
      type: "file",
    }));
    this._status = "published";

    // Commit manifest and metadata under lock
    await this.gitManager.withLock(async () => {
      await this.writeWorkspaceMetadata();
      await this.gitManager.addAll();
      await this.gitManager.commit(
        `Update metadata: published`,
        `${this.agentId} <${this.agentId}@agent.local>`,
      );
    });

    this.events.emit("workspace:published", {
      workspaceId: this.id,
      manifest,
    });

    logger.info(
      `Published ${outputs.length} outputs from workspace ${this.id} → .ping/outputs/${this.taskId}.json`,
    );

    return manifest;
  }

  /**
   * Store a binary file — writes to artifacts/ but does NOT stage in git
   * Returns the relative path for L2 BinaryStorage
   */
  async storeBinary(
    filename: string,
    content: Buffer,
    _mimeType: string,
  ): Promise<string> {
    this.assertWritable();

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const binaryDir = path.join(this.basePath, "artifacts", "data");
    await fs.promises.mkdir(binaryDir, { recursive: true });

    const filePath = path.join(binaryDir, safeName);
    await fs.promises.writeFile(filePath, content);

    // DO NOT stage in git — binaries bypass git per v1.0 plan
    logger.debug(`Binary stored (not staged): artifacts/data/${safeName}`);

    return `artifacts/data/${safeName}`;
  }

  /**
   * Merge this workspace's branch into main
   */
  async merge(): Promise<MergeResult> {
    if (this._status !== "published") {
      throw new Error(
        `Cannot merge workspace ${this.id}: must be published first (status: ${this._status})`,
      );
    }

    const result = await this.gitManager.withLock(async () => {
      // Remove workspace.json before merge — it's task-specific metadata
      // that would conflict if multiple workspaces merge into the same main branch
      const wsJsonPath = path.join(this.basePath, "workspace.json");
      try {
        await fs.promises.unlink(wsJsonPath);
        await this.gitManager.addAll();
        await this.gitManager.commit(
          `Remove workspace metadata before merge`,
          `${this.agentId} <${this.agentId}@agent.local>`,
        );
      } catch {
        // workspace.json may not exist
      }

      return this.gitManager.mergeBranch(this.branchName);
    });

    if (result.success) {
      this._status = "merged";
      this.events.emit("workspace:merged", {
        workspaceId: this.id,
        mergeCommit: result.mergeCommit || "",
      });
      logger.info(`Workspace ${this.id} merged successfully`);
    } else {
      this._status = "failed";
      logger.warn(
        `Workspace ${this.id} merge failed: conflicts in ${result.conflicts?.join(", ")}`,
      );
    }

    return result;
  }

  /**
   * Reactivate workspace — move from 'published' back to 'active' status
   * Allows continued work after premature or incremental publishing
   */
  async reactivate(): Promise<void> {
    if (this._status !== "published") {
      throw new Error(
        `Cannot reactivate workspace ${this.id}: must be in 'published' state (status: ${this._status})`,
      );
    }

    this._status = "active";
    this.publishedArtifacts = [];

    await this.gitManager.withLock(async () => {
      await this.writeWorkspaceMetadata();
      // Commit metadata update so working tree stays clean
      await this.gitManager.addAll();
      await this.gitManager.commit(
        `Reactivate workspace for continued work`,
        `${this.agentId} <${this.agentId}@agent.local>`,
      );
    });

    this.events.emit("workspace:reactivated", {
      workspaceId: this.id,
    });

    logger.info(`Workspace ${this.id} reactivated for continued work`);
  }

  /**
   * Discard workspace — delete branch, clean up
   */
  async discard(): Promise<void> {
    await this.gitManager.withLock(async () => {
      try {
        await this.gitManager.deleteBranch(this.branchName, true);
      } catch (err) {
        logger.warn(`Could not delete branch ${this.branchName}: ${err}`);
      }
    });

    this._status = "discarded";
    this.events.emit("workspace:discarded", {
      workspaceId: this.id,
    });

    logger.info(`Workspace ${this.id} discarded`);
  }

  /**
   * Create a retry workspace — new branch (v2, v3, etc.) preserving context
   * Returns a new AgentWorkspace instance
   */
  async retry(): Promise<AgentWorkspace> {
    const newRetryCount = this.retryCount + 1;
    const newBranchName = `task-${this.taskId}-v${newRetryCount + 1}`;
    const newId = `ws-${this.taskId}-v${newRetryCount + 1}`;

    const newWorkspace = new AgentWorkspace({
      id: newId,
      agentId: this.agentId,
      taskId: this.taskId,
      branchName: newBranchName,
      basePath: this.basePath, // Same base path, different branch
      gitManager: this.gitManager,
      retryCount: newRetryCount,
      previousVersion: this.id,
    });

    // Initialize the new workspace
    await newWorkspace.initialize();

    this.events.emit("workspace:retry", {
      workspaceId: this.id,
      newWorkspaceId: newId,
      retryCount: newRetryCount,
    });

    logger.info(
      `Retrying workspace ${this.id} → ${newId} (attempt ${newRetryCount + 1})`,
    );

    return newWorkspace;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKSPACE STATUS (for tools / API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get full workspace status (for workspace_status tool)
   */
  async getWorkspaceStatus(): Promise<{
    id: string;
    taskId: string;
    agentId: string;
    branchName: string;
    status: WorkspaceStatus;
    uncommittedChanges: string[];
    lastCommit?: CommitInfo;
    activityStats: {
      totalEntries: number;
      toolCalls: number;
      errors: number;
    };
  }> {
    const changedFiles = await this.gitManager.getChangedFiles();
    const history = await this.gitManager.getCommitHistory(this.branchName, 1);
    const entries = await this.getActivityLog();

    return {
      id: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      branchName: this.branchName,
      status: this._status,
      uncommittedChanges: changedFiles,
      ...(history[0] ? { lastCommit: history[0] } : {}),
      activityStats: {
        totalEntries: entries.length,
        toolCalls: entries.filter((e) => e.type === "tool_call").length,
        errors: entries.filter((e) => e.type === "error").length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH & FILE UTILITIES (Phase 5)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Grep — regex/literal search across workspace files using ripgrep.
   * Returns matching lines with file:line:content format.
   */
  async grep(
    pattern: string,
    options?: {
      /** Glob pattern to filter files (e.g. "*.ts") */
      glob?: string;
      /** Case-insensitive search (default: true) */
      ignoreCase?: boolean;
      /** Maximum number of results (default: 100) */
      maxResults?: number;
      /** Include surrounding context lines (default: 0) */
      contextLines?: number;
    },
  ): Promise<{ file: string; line: number; content: string }[]> {
    const args: string[] = [
      "--no-heading",
      "--line-number",
      "--color",
      "never",
      "--max-count",
      String(options?.maxResults ?? 100),
    ];

    if (options?.ignoreCase !== false) {
      args.push("--ignore-case");
    }

    if (options?.contextLines && options.contextLines > 0) {
      args.push("--context", String(options.contextLines));
    }

    if (options?.glob) {
      args.push("--glob", options.glob);
    }

    // Exclude .git and .scratch directories
    args.push("--glob", "!.git", "--glob", "!.scratch");

    args.push("--", pattern, this.basePath);

    return new Promise((resolve) => {
      execFile(rgPath, args, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout.trim()) {
          // ripgrep exits 1 when no matches found — not an error
          resolve([]);
          return;
        }

        const results: { file: string; line: number; content: string }[] = [];
        const baseNorm = this.basePath.replace(/\\/g, "/");

        for (const rawLine of stdout.split("\n")) {
          if (!rawLine.trim()) continue;
          // Format: filepath:line:content
          const match = rawLine.match(/^(.+?):(\d+):(.*)$/);
          if (!match) continue;

          const absFile = match[1]!.replace(/\\/g, "/");
          const relFile = absFile.startsWith(baseNorm)
            ? absFile.slice(baseNorm.length + 1)
            : absFile;

          results.push({
            file: relFile,
            line: parseInt(match[2]!, 10),
            content: match[3]!,
          });
        }

        resolve(results);
      });
    });
  }

  /**
   * Glob — find files matching a glob pattern within the workspace.
   * Uses fast-glob for cross-platform, pure-JS globbing.
   */
  async glob(
    pattern: string,
    options?: {
      /** Maximum results (default: 200) */
      maxResults?: number;
      /** Include directories (default: false) */
      onlyDirectories?: boolean;
    },
  ): Promise<string[]> {
    const entries = await fg(pattern, {
      cwd: this.basePath,
      dot: false,
      onlyFiles: !options?.onlyDirectories,
      onlyDirectories: options?.onlyDirectories ?? false,
      ignore: [".git", ".git/**", ".scratch", ".scratch/**"],
      absolute: false,
    });

    const limit = options?.maxResults ?? 200;
    return entries.slice(0, limit);
  }

  /**
   * Get file statistics without reading the full file content.
   * Useful for checking size, last modified date, and file type.
   */
  async fileStats(relativePath: string): Promise<{
    path: string;
    name: string;
    extension: string;
    size: number;
    lastModified: Date;
    isDirectory: boolean;
  }> {
    const safePath = this.sanitizePath(relativePath);
    const fullPath = path.join(this.basePath, safePath);

    try {
      const stats = await fs.promises.stat(fullPath);
      return {
        path: safePath,
        name: path.basename(safePath),
        extension: path.extname(safePath).toLowerCase().slice(1),
        size: stats.size,
        lastModified: stats.mtime,
        isDirectory: stats.isDirectory(),
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`File not found: ${safePath} in workspace ${this.id}`);
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ensure workspace is in 'active' status before mutations
   */
  private assertWritable(): void {
    if (this._status !== "active" && this._status !== "published") {
      throw new Error(
        `Workspace ${this.id} is not writable (status: ${this._status})`,
      );
    }
  }

  /**
   * Sanitize a relative path to prevent directory traversal and symlink escape
   */
  private sanitizePath(relativePath: string): string {
    // Reject null bytes
    if (relativePath.includes('\0')) {
      throw new Error(`Invalid path: contains null byte`);
    }

    // Normalize and resolve
    const normalized = path.normalize(relativePath).replace(/\\/g, "/");

    // Reject paths that try to escape
    if (normalized.startsWith("..") || normalized.startsWith("/")) {
      throw new Error(
        `Invalid path: '${relativePath}' — cannot escape workspace`,
      );
    }

    // Remove leading ./
    const clean = normalized.replace(/^\.\//, "");

    // Symlink check: if the file exists, resolve its real path and verify containment
    const fullPath = path.join(this.basePath, clean);
    try {
      const realPath = fs.realpathSync(fullPath);
      const realBase = fs.realpathSync(this.basePath);
      if (!realPath.startsWith(realBase + path.sep) && realPath !== realBase) {
        throw new Error(`Symlink escape blocked: '${relativePath}' resolves outside workspace`);
      }
    } catch (err: any) {
      // ENOENT = file doesn't exist yet — that's fine (creating new files)
      if (err.code !== "ENOENT") throw err;
    }

    return clean;
  }

  /**
   * Write workspace.json metadata file
   */
  private async writeWorkspaceMetadata(): Promise<void> {
    const entries = this.activityLog;
    const toolCalls = entries.filter((e) => e.type === "tool_call").length;
    const errors = entries.filter((e) => e.type === "error").length;

    const metadata: WorkspaceMetadata = {
      version: "1.0",
      workspaceId: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      branchName: this.branchName,
      baseBranch: this.gitManager.mainBranch,
      baseCommit: "", // Will be populated after first commit
      knowledgeRefs: this.knowledgeRefs,
      dependencyTasks: this.dependencyTasks,
      createdAt: this.createdAt.toISOString(),
      lastCommitAt: this._lastActivityAt.toISOString(),
      status: this._status,
      retryCount: this.retryCount,
      ...(this.previousVersion !== undefined
        ? { previousVersion: this.previousVersion }
        : {}),
      ...(this.publishedArtifacts.length > 0
        ? { publishedArtifacts: this.publishedArtifacts }
        : {}),
      activityStats: {
        totalEntries: entries.length,
        toolCalls,
        errors,
        ...(entries[0]?.timestamp
          ? { firstActivity: new Date(entries[0].timestamp).toISOString() }
          : {}),
        ...(entries[entries.length - 1]?.timestamp
          ? {
              lastActivity: new Date(
                entries[entries.length - 1]!.timestamp,
              ).toISOString(),
            }
          : {}),
      },
    };

    const metadataPath = path.join(this.basePath, "workspace.json");
    await fs.promises.writeFile(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      "utf-8",
    );
  }

  /**
   * Infer artifact category from file path/extension
   */
  private inferCategory(fileName: string): ArtifactCategory {
    const ext = path.extname(fileName).toLowerCase().slice(1);

    const codeExts = [
      "ts",
      "js",
      "tsx",
      "jsx",
      "py",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "h",
      "cs",
      "rb",
      "php",
      "swift",
      "kt",
    ];
    const docExts = ["md", "txt", "rst", "doc", "docx", "pdf"];
    const configExts = ["json", "yaml", "yml", "toml", "env", "ini", "xml"];
    const dataExts = ["csv", "sql", "db", "sqlite"];
    const testPatterns = [
      "test.ts",
      "spec.ts",
      "test.js",
      "spec.js",
      "test.py",
    ];
    const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"];

    if (testPatterns.some((t) => fileName.endsWith(t))) return "test";
    if (codeExts.includes(ext)) return "code";
    if (docExts.includes(ext)) return "document";
    if (configExts.includes(ext)) return "config";
    if (dataExts.includes(ext)) return "data";
    if (imageExts.includes(ext)) return "image";
    return "other";
  }

  /**
   * Build the workspace metadata object (shared between writeWorkspaceMetadata
   * and initializeFromRepo).
   */
  private buildWorkspaceMetadataObj(): WorkspaceMetadata {
    const entries = this.activityLog;
    const toolCalls = entries.filter((e) => e.type === "tool_call").length;
    const errors = entries.filter((e) => e.type === "error").length;

    return {
      version: "1.0",
      workspaceId: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      branchName: this.branchName,
      baseBranch: this.gitManager.mainBranch,
      baseCommit: "",
      knowledgeRefs: this.knowledgeRefs,
      dependencyTasks: this.dependencyTasks,
      createdAt: this.createdAt.toISOString(),
      lastCommitAt: this._lastActivityAt.toISOString(),
      status: this._status,
      retryCount: this.retryCount,
      ...(this.previousVersion !== undefined
        ? { previousVersion: this.previousVersion }
        : {}),
      ...(this.publishedArtifacts.length > 0
        ? { publishedArtifacts: this.publishedArtifacts }
        : {}),
      activityStats: {
        totalEntries: entries.length,
        toolCalls,
        errors,
        ...(entries[0]?.timestamp
          ? { firstActivity: new Date(entries[0].timestamp).toISOString() }
          : {}),
        ...(entries[entries.length - 1]?.timestamp
          ? {
              lastActivity: new Date(
                entries[entries.length - 1]!.timestamp,
              ).toISOString(),
            }
          : {}),
      },
    };
  }

  /**
   * Recursively copy a directory (used by initializeFromRepo localPath mode).
   */
  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }
}
