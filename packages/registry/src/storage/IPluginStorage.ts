/**
 * IPluginStorage — Abstract storage backend for reading plugin files
 *
 * Implementations:
 * - LocalPluginStorage: reads from local filesystem (default, dev)
 * - S3PluginStorage: reads from AWS S3 bucket (cloud)
 * - AzureBlobPluginStorage: reads from Azure Blob Storage (cloud)
 *
 * All paths are relative to the plugin root (e.g., "engineering-team/agents/backend-developer.md").
 */

export interface IPluginStorage {
  /** Check if a file or directory exists */
  exists(relativePath: string): Promise<boolean>;

  /** Read a file's content as UTF-8 string */
  readFile(relativePath: string): Promise<string>;

  /** List entries in a directory. Returns names only (not full paths). */
  listDir(relativePath: string): Promise<DirEntry[]>;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}
