/**
 * WorkspaceStorage — Interface for workspace file operations.
 *
 * Wraps Git-backed workspace storage so it can be extended
 * to support remote push/pull in production.
 */

export interface WorkspaceStorage {
  /** Read a file from the workspace. Returns null if not found. */
  read(filePath: string): Promise<string | null>;

  /** Write a file to the workspace. Creates parent dirs. */
  write(filePath: string, data: string): Promise<void>;

  /** Delete a file from the workspace. */
  delete(filePath: string): Promise<void>;

  /** List files under a directory. Returns relative paths. */
  list(prefix: string): Promise<string[]>;

  /** Check if a file exists. */
  exists(filePath: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------

import * as fs from "fs/promises";
import * as path from "path";

/**
 * FsWorkspaceStorage — Filesystem-backed workspace storage.
 * Wraps reads/writes to the team's workspace directory.
 */
export class FsWorkspaceStorage implements WorkspaceStorage {
  private readonly resolvedBase: string;

  constructor(private baseDir: string) {
    this.resolvedBase = path.resolve(baseDir);
  }

  /** Resolve and validate path stays within baseDir */
  private safePath(filePath: string): string {
    const resolved = path.resolve(this.resolvedBase, filePath);
    if (!resolved.startsWith(this.resolvedBase + path.sep) && resolved !== this.resolvedBase) {
      throw new Error(`Path traversal blocked: ${filePath}`);
    }
    return resolved;
  }

  async read(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(this.safePath(filePath), "utf8");
    } catch {
      return null;
    }
  }

  async write(filePath: string, data: string): Promise<void> {
    const fullPath = this.safePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data, "utf8");
  }

  async delete(filePath: string): Promise<void> {
    try {
      await fs.unlink(this.safePath(filePath));
    } catch {
      // No-op if file doesn't exist
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.safePath(prefix);
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
      await fs.access(this.safePath(filePath));
      return true;
    } catch {
      return false;
    }
  }
}
