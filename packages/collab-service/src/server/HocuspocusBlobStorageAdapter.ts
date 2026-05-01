/**
 * HocuspocusBlobStorageAdapter — Bridges BlobStorageProvider → Hocuspocus Database extension.
 *
 * Hocuspocus Database extension expects { fetch, store } callbacks that return/accept Buffers.
 * This adapter delegates those operations to a BlobStorageProvider (fs, S3, Azure, GCS).
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BlobStorageProvider } from "../types/blob-storage.types.js";

/** Convert doc name (may contain slashes) to a safe storage key */
function docNameToKey(prefix: string, docName: string): string {
  const safeName = docName.replace(/\//g, "_");
  return `${prefix}/${safeName}.bin`;
}

/**
 * Default filesystem BlobStorageProvider.
 * Reads/writes raw buffers to local files.
 */
export class FsBlobStorage implements BlobStorageProvider {
  constructor(private baseDir: string) {}

  async read(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(this.baseDir, key));
    } catch {
      return null;
    }
  }

  async write(key: string, data: Buffer): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async delete(key: string): Promise<void> {
    try { await fs.unlink(path.join(this.baseDir, key)); } catch { /* ignore */ }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const dir = path.join(this.baseDir, prefix);
      const files = await fs.readdir(dir);
      return files.map(f => `${prefix}/${f}`);
    } catch {
      return [];
    }
  }
}

/**
 * Adapter that provides Hocuspocus-compatible { fetch, store } callbacks
 * backed by any BlobStorageProvider.
 */
export class HocuspocusBlobStorageAdapter {
  constructor(
    private storage: BlobStorageProvider,
    private prefix: string = "yjs",
  ) {}

  async fetch({ documentName }: { documentName: string }): Promise<Buffer | null> {
    return this.storage.read(docNameToKey(this.prefix, documentName));
  }

  async store({ documentName, state }: { documentName: string; state: Buffer }): Promise<void> {
    await this.storage.write(docNameToKey(this.prefix, documentName), state);
  }
}
