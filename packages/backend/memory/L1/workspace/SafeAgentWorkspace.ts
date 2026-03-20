/**
 * SafeAgentWorkspace — Safety wrapper around AgentWorkspace
 *
 * Adds:
 * - requireReadBeforeWrite: prevents writes to existing files not yet read
 * - Read-only path protection: configurable list of protected paths
 * - Max file size guard: prevents writing excessively large files
 *
 * Used by WorkerPool to wrap the base AgentWorkspace when safety is desired.
 *
 * @see feature_implementation_planning.md §Phase 5
 */

import type { FileInfo } from "../../types/index.js";
import { WorkspaceError } from "../../types/index.js";
import { AgentWorkspace } from "./AgentWorkspace.js";

export interface SafeWorkspaceOptions {
  /** Block writes to existing files that haven't been read first (default: true) */
  requireReadBeforeWrite?: boolean;
  /** Paths that cannot be written/deleted (relative to workspace root) */
  readOnlyPaths?: string[];
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSizeBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE = 1_048_576; // 1 MB

/**
 * Wraps an AgentWorkspace with safety checks.
 *
 * Uses composition (not inheritance) so the underlying workspace
 * is fully accessible via `.inner` when needed.
 */
export class SafeAgentWorkspace {
  /** Set of relative paths the agent has read during this session */
  private readonly readPaths = new Set<string>();
  private readonly requireReadBeforeWrite: boolean;
  private readonly readOnlyPaths: Set<string>;
  private readonly maxFileSizeBytes: number;

  constructor(
    /** The underlying workspace — all delegated calls go here */
    public readonly inner: AgentWorkspace,
    options: SafeWorkspaceOptions = {},
  ) {
    this.requireReadBeforeWrite = options.requireReadBeforeWrite ?? true;
    this.readOnlyPaths = new Set(
      (options.readOnlyPaths ?? []).map((p) => p.replace(/\\/g, "/")),
    );
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS-THROUGH IDENTITY (delegated to inner workspace)
  // ═══════════════════════════════════════════════════════════════════════════

  get id() {
    return this.inner.id;
  }
  get agentId() {
    return this.inner.agentId;
  }
  get taskId() {
    return this.inner.taskId;
  }
  get branchName() {
    return this.inner.branchName;
  }
  get basePath() {
    return this.inner.basePath;
  }
  get status() {
    return this.inner.status;
  }
  get createdAt() {
    return this.inner.createdAt;
  }
  get lastActivityAt() {
    return this.inner.lastActivityAt;
  }
  get events() {
    return this.inner.events;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAFE FILE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Read a file — also records the path so future writes are allowed.
   */
  async readFile(relativePath: string): Promise<string> {
    const content = await this.inner.readFile(relativePath);
    this.readPaths.add(this.normalizePath(relativePath));
    return content;
  }

  /**
   * Create a new file — enforces max file size, read-only protection.
   * createFile is always allowed (the file doesn't exist yet, so
   * requireReadBeforeWrite doesn't apply).
   */
  async createFile(relativePath: string, content: string): Promise<FileInfo> {
    this.assertNotReadOnly(relativePath);
    this.assertFileSizeOk(content);
    const info = await this.inner.createFile(relativePath, content);
    // Mark as read since the agent just created it
    this.readPaths.add(this.normalizePath(relativePath));
    return info;
  }

  /**
   * Update an existing file — enforces requireReadBeforeWrite,
   * max file size, and read-only protection.
   */
  async updateFile(relativePath: string, content: string): Promise<FileInfo> {
    this.assertNotReadOnly(relativePath);
    this.assertFileSizeOk(content);

    if (this.requireReadBeforeWrite) {
      const norm = this.normalizePath(relativePath);
      if (!this.readPaths.has(norm)) {
        throw new WorkspaceError(
          `Must read '${relativePath}' before writing to it. Call readFile() first.`,
          "MUST_READ_BEFORE_WRITE",
          this.inner.id,
        );
      }
    }

    return this.inner.updateFile(relativePath, content);
  }

  /**
   * Delete a file — enforces read-only protection.
   */
  async deleteFile(relativePath: string): Promise<void> {
    this.assertNotReadOnly(relativePath);
    await this.inner.deleteFile(relativePath);
    this.readPaths.delete(this.normalizePath(relativePath));
  }

  /**
   * List files — pass-through, no safety restriction.
   */
  async listFiles(directory?: string): Promise<FileInfo[]> {
    return this.inner.listFiles(directory);
  }

  /**
   * Check if a file exists — pass-through.
   */
  async fileExists(relativePath: string): Promise<boolean> {
    return this.inner.fileExists(relativePath);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELEGATED METHODS (no safety override needed)
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize() {
    return this.inner.initialize();
  }
  async pullContext(knowledgeRefs: string[]) {
    return this.inner.pullContext(knowledgeRefs);
  }
  async logActivity(...args: Parameters<AgentWorkspace["logActivity"]>) {
    return this.inner.logActivity(...args);
  }
  async getActivityLog() {
    return this.inner.getActivityLog();
  }
  async getActivitySummary() {
    return this.inner.getActivitySummary();
  }
  async commit(message: string) {
    return this.inner.commit(message);
  }
  async getHistory() {
    return this.inner.getHistory();
  }
  async revertToCommit(hash: string) {
    return this.inner.revertToCommit(hash);
  }
  async publish(goalId?: string) {
    return this.inner.publish(goalId);
  }
  async storeBinary(...args: Parameters<AgentWorkspace["storeBinary"]>) {
    return this.inner.storeBinary(...args);
  }
  async merge() {
    return this.inner.merge();
  }
  async reactivate() {
    return this.inner.reactivate();
  }
  async discard() {
    return this.inner.discard();
  }
  async retry() {
    return this.inner.retry();
  }
  async getWorkspaceStatus() {
    return this.inner.getWorkspaceStatus();
  }

  // Grep/glob/fileStats delegate to inner (added in Phase 5)
  async grep(...args: Parameters<AgentWorkspace["grep"]>) {
    return this.inner.grep(...args);
  }
  async glob(...args: Parameters<AgentWorkspace["glob"]>) {
    return this.inner.glob(...args);
  }
  async fileStats(...args: Parameters<AgentWorkspace["fileStats"]>) {
    return this.inner.fileStats(...args);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get set of paths the agent has read */
  getReadPaths(): ReadonlySet<string> {
    return this.readPaths;
  }

  /** Manually mark a path as read (e.g. for files agent created outside this wrapper) */
  markAsRead(relativePath: string): void {
    this.readPaths.add(this.normalizePath(relativePath));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE GUARDS
  // ═══════════════════════════════════════════════════════════════════════════

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  private assertNotReadOnly(relativePath: string): void {
    const norm = this.normalizePath(relativePath);
    for (const ro of this.readOnlyPaths) {
      if (norm === ro || norm.startsWith(ro + "/")) {
        throw new WorkspaceError(
          `Path '${relativePath}' is read-only`,
          "INVALID_PATH",
          this.inner.id,
        );
      }
    }
  }

  private assertFileSizeOk(content: string): void {
    const bytes = Buffer.byteLength(content, "utf-8");
    if (bytes > this.maxFileSizeBytes) {
      throw new WorkspaceError(
        `File content exceeds max size (${bytes} bytes > ${this.maxFileSizeBytes} bytes limit)`,
        "INVALID_PATH",
        this.inner.id,
      );
    }
  }
}
