/**
 * IndexPersistence — L2 snapshot save/load/fork/merge for code intelligence
 *
 * Persists L1 in-memory indexes (MiniSearch + SymbolIndex) to MongoDB as
 * gzipped snapshots keyed by branch ID. Supports:
 *
 * - **Load**: Hydrate L1 indexes from L2 snapshot (warm start)
 * - **Save**: Debounced persist of L1 → L2 (5s after last change)
 * - **Fork**: Copy-on-write branch snapshot (O(1) MongoDB doc copy)
 * - **Merge**: Re-index changed files into target branch snapshot
 * - **Delete**: Cleanup branch snapshot after merge/discard
 *
 * @see feature_implementation_planning.md Phase 6
 */

import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import crypto from "crypto";
import {
  IndexSnapshotModel,
  type SymbolEntry,
  type FileState,
} from "./models/IndexSnapshot.model.js";
import type { SymbolIndex } from "../SymbolIndex.js";
import type { WorkspaceSearchIndex } from "../../search/WorkspaceSearchIndex.js";
import { Logger } from "tslog";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const logger = new Logger({ name: "IndexPersistence" });

/** Debounce delay for auto-save (ms) */
const SAVE_DEBOUNCE_MS = 5000;

export class IndexPersistence {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private fileHashes = new Map<string, string>(); // file → contentHash
  private dirty = false; // true once branch has its own snapshot

  constructor(
    private branchId: string,
    private symbolIndex: SymbolIndex,
    private searchIndex: WorkspaceSearchIndex,
    /** Fallback branch to read from if this branch has no snapshot yet (default: "main") */
    private baseBranch: string = "main",
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // LOAD: L2 snapshot → L1 in-memory indexes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load snapshot from MongoDB and hydrate L1 indexes.
   * Tries this branch first, falls back to baseBranch (e.g. main).
   * Returns null if no snapshot exists anywhere (cold start).
   */
  async load(): Promise<{ changedFiles: string[]; fromBase: boolean } | null> {
    try {
      // Try branch-specific snapshot first
      let snapshot = await IndexSnapshotModel.findOne({
        branchId: this.branchId,
      }).lean();

      let fromBase = false;

      // Fall back to base branch (main) if no branch-specific snapshot
      if (!snapshot && this.branchId !== this.baseBranch) {
        snapshot = await IndexSnapshotModel.findOne({
          branchId: this.baseBranch,
        }).lean();
        if (snapshot) {
          fromBase = true;
          // Fork: copy base snapshot to this branch so future saves are isolated
          await IndexPersistence.forkSnapshot(this.baseBranch, this.branchId);
          logger.debug(
            `No snapshot for ${this.branchId}, forked from ${this.baseBranch}`,
          );
        }
      }

      if (!snapshot) {
        logger.debug(
          `No snapshot found for branch: ${this.branchId} (or base ${this.baseBranch})`,
        );
        return null;
      }

      // Hydrate MiniSearch from gzipped JSON
      const searchJSON = (await gunzipAsync(snapshot.searchIndex)).toString(
        "utf-8",
      );
      this.searchIndex.loadFromJSON(searchJSON);

      // Hydrate SymbolIndex from flat entries
      this.symbolIndex.loadFromEntries(snapshot.symbols);

      // Rebuild file hash map
      for (const fs of snapshot.fileStates) {
        this.fileHashes.set(fs.file, fs.contentHash);
      }

      logger.info(
        `Loaded snapshot for ${this.branchId}${fromBase ? ` (from ${this.baseBranch})` : ""}: ${snapshot.symbols.length} symbols, ${snapshot.fileStates.length} files`,
      );
      return { changedFiles: [], fromBase };
    } catch (error) {
      logger.warn(`Failed to load snapshot for ${this.branchId}: ${error}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHANGE DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compare current file hashes against snapshot to find changed files.
   * Returns files that were added, modified, or deleted.
   */
  getChangedFiles(currentFiles: Map<string, string>): string[] {
    const changed: string[] = [];

    // Files added or modified
    for (const [file, hash] of currentFiles) {
      if (this.fileHashes.get(file) !== hash) changed.push(file);
    }

    // Files deleted (in snapshot but not current)
    for (const file of this.fileHashes.keys()) {
      if (!currentFiles.has(file)) changed.push(file);
    }

    return changed;
  }

  /**
   * Compute SHA-256 content hash
   */
  static contentHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SAVE: L1 in-memory indexes → L2 snapshot
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a debounced save (5s after last change)
   */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
  }

  /**
   * Persist current L1 indexes to MongoDB as a gzipped snapshot.
   */
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    try {
      // Serialize + gzip MiniSearch
      const searchJSON = JSON.stringify(this.searchIndex.toJSON());
      const searchBuffer = await gzipAsync(Buffer.from(searchJSON, "utf-8"));

      // Serialize symbols
      const symbols: SymbolEntry[] = this.symbolIndex.toEntries();

      // Build file state list
      const fileStates: FileState[] = Array.from(this.fileHashes.entries()).map(
        ([file, contentHash]) => ({
          file,
          contentHash,
          lineCount: this.symbolIndex.getFileLineCount(file) ?? 0,
          language: this.symbolIndex.getFileLanguage(file) ?? "unknown",
        }),
      );

      await IndexSnapshotModel.findOneAndUpdate(
        { branchId: this.branchId },
        {
          searchIndex: searchBuffer,
          symbols,
          fileStates,
          version: 1,
          savedAt: new Date(),
        },
        { upsert: true },
      );

      this.dirty = true;
      logger.info(
        `Saved snapshot for ${this.branchId}: ${symbols.length} symbols, ${fileStates.length} files`,
      );
    } catch (error) {
      logger.error(`Failed to save snapshot for ${this.branchId}: ${error}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FILE TRACKING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Track a file change (updated content hash) and schedule save
   */
  trackFile(file: string, contentHash: string): void {
    this.fileHashes.set(file, contentHash);
    this.scheduleSave();
  }

  /**
   * Untrack a deleted file and schedule save
   */
  untrackFile(file: string): void {
    this.fileHashes.delete(file);
    this.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BRANCHING: Copy-on-Write fork + merge
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fork: Copy snapshot from source branch to a new branch.
   * Called internally by load() when falling back to base branch,
   * so the branch gets its own copy to mutate safely.
   */
  static async forkSnapshot(
    sourceBranch: string,
    newBranch: string,
  ): Promise<void> {
    try {
      const source = await IndexSnapshotModel.findOne({
        branchId: sourceBranch,
      }).lean();
      if (!source) {
        logger.debug(
          `No snapshot to fork from: ${sourceBranch} → ${newBranch}`,
        );
        return;
      }
      const { _id, ...data } = source as any;
      await IndexSnapshotModel.create({
        ...data,
        branchId: newBranch,
        savedAt: new Date(),
      });
      logger.info(`Forked snapshot: ${sourceBranch} → ${newBranch}`);
    } catch (error) {
      logger.warn(`Failed to fork snapshot: ${error}`);
    }
  }

  /**
   * Merge: Load target branch snapshot and re-index changed files
   */
  static async mergeSnapshot(
    targetBranch: string,
    _changedFiles: string[],
    symbolIndex: SymbolIndex,
    searchIndex: WorkspaceSearchIndex,
  ): Promise<void> {
    const persistence = new IndexPersistence(
      targetBranch,
      symbolIndex,
      searchIndex,
    );
    await persistence.load();
    // Caller is responsible for re-indexing changed files after this
  }

  /**
   * Delete: Clean up a branch's snapshot after merge or discard.
   * Only deletes branch-specific snapshots, never the base branch.
   */
  static async deleteSnapshot(branchId: string): Promise<void> {
    if (branchId === "main" || branchId === "master") {
      logger.warn(`Refusing to delete base branch snapshot: ${branchId}`);
      return;
    }
    try {
      await IndexSnapshotModel.deleteOne({ branchId });
      logger.info(`Deleted snapshot for: ${branchId}`);
    } catch (error) {
      logger.warn(`Failed to delete snapshot for ${branchId}: ${error}`);
    }
  }

  /**
   * Dispose — clear timers
   */
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
