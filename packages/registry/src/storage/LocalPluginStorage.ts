/**
 * LocalPluginStorage — Reads plugin files from the local filesystem
 *
 * This is the default storage backend for development and self-hosted deployments.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import type { IPluginStorage, DirEntry } from "./IPluginStorage.js";

export class LocalPluginStorage implements IPluginStorage {
  constructor(private rootDir: string) {}

  async exists(relativePath: string): Promise<boolean> {
    return existsSync(join(this.rootDir, relativePath));
  }

  async readFile(relativePath: string): Promise<string> {
    return readFileSync(join(this.rootDir, relativePath), "utf-8");
  }

  async listDir(relativePath: string): Promise<DirEntry[]> {
    const fullPath = join(this.rootDir, relativePath);
    if (!existsSync(fullPath)) return [];

    return readdirSync(fullPath, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  }
}
