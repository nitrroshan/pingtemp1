/**
 * Storage barrel export + factory.
 *
 * Use getAppStateStorage() / getWorkspaceStorage() to get the correct
 * implementation based on STORAGE_TYPE config.
 */

export type { AppStateStorage } from "./AppStateStorage.js";
export { FsAppStateStorage } from "./AppStateStorage.js";
export { AzureBlobStorageProvider } from "./AzureBlobStorageProvider.js";

export type { WorkspaceStorage } from "./WorkspaceStorage.js";
export { FsWorkspaceStorage } from "./WorkspaceStorage.js";

import { FsAppStateStorage } from "./AppStateStorage.js";
import { AzureBlobStorageProvider } from "./AzureBlobStorageProvider.js";
import { FsWorkspaceStorage } from "./WorkspaceStorage.js";
import type { AppStateStorage } from "./AppStateStorage.js";
import type { WorkspaceStorage } from "./WorkspaceStorage.js";

let _appStateStorage: AppStateStorage | null = null;

/**
 * Create an AppStateStorage based on STORAGE_TYPE config.
 * Caches the instance — call multiple times safely.
 */
export function getAppStateStorage(baseDir: string): AppStateStorage {
  if (_appStateStorage) return _appStateStorage;

  const storageType = process.env.STORAGE_TYPE || "fs";

  switch (storageType) {
    case "azure": {
      const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
      const container = process.env.AZURE_STORAGE_CONTAINER || "ping-data";
      if (!connStr) throw new Error("AZURE_STORAGE_CONNECTION_STRING required when STORAGE_TYPE=azure");
      const provider = new AzureBlobStorageProvider(connStr, container);
      // Init is async but we fire-and-forget — container likely already exists
      provider.init().catch(() => {});
      _appStateStorage = provider;
      return provider;
    }
    case "fs":
    default:
      _appStateStorage = new FsAppStateStorage(baseDir);
      return _appStateStorage;
  }
}

/**
 * Create a WorkspaceStorage for the given base directory.
 */
export function getWorkspaceStorage(baseDir: string): WorkspaceStorage {
  // Workspaces always use filesystem (git repos need local disk)
  return new FsWorkspaceStorage(baseDir);
}
