/**
 * AppStateStorage — Interface for persisting application state (tasks, plans).
 *
 * Abstracts the underlying storage mechanism (filesystem, Azure Blob, S3)
 * so the backend can switch between local dev and cloud production storage.
 */

export interface AppStateStorage {
  /** Read a file by relative path. Returns null if not found. */
  read(path: string): Promise<string | null>;

  /** Write content to a file by relative path. Creates parent dirs. */
  write(path: string, data: string): Promise<void>;

  /** Delete a file by relative path. No-op if not found. */
  delete(path: string): Promise<void>;

  /** List files under a prefix (directory). Returns relative paths. */
  list(prefix: string): Promise<string[]>;

  /** Check if a file exists. */
  exists(path: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------

import * as fs from "fs/promises";
import * as path from "path";

/**
 * FsAppStateStorage — Filesystem-backed implementation.
 * Wraps reads/writes to a base directory (e.g. `data/plans/`).
 */
export class FsAppStateStorage implements AppStateStorage {
  constructor(private baseDir: string) {}

  async read(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.baseDir, filePath), "utf8");
    } catch {
      return null;
    }
  }

  async write(filePath: string, data: string): Promise<void> {
    const fullPath = path.join(this.baseDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data, "utf8");
  }

  async delete(filePath: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.baseDir, filePath));
    } catch {
      // No-op if file doesn't exist
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = path.join(this.baseDir, prefix);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => path.join(prefix, e.name));
    } catch {
      return [];
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.baseDir, filePath));
      return true;
    } catch {
      return false;
    }
  }
}
