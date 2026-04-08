/**
 * Storage barrel export + factory.
 *
 * Use getAppStateStorage() / getWorkspaceStorage() to get the correct
 * implementation based on STORAGE_TYPE config.
 */

export type { AppStateStorage } from "./AppStateStorage.js";
export { FsAppStateStorage } from "./AppStateStorage.js";

export type { WorkspaceStorage } from "./WorkspaceStorage.js";
export { FsWorkspaceStorage } from "./WorkspaceStorage.js";

import { FsAppStateStorage } from "./AppStateStorage.js";
import { FsWorkspaceStorage } from "./WorkspaceStorage.js";
import type { AppStateStorage } from "./AppStateStorage.js";
import type { WorkspaceStorage } from "./WorkspaceStorage.js";

/**
 * Create an AppStateStorage for the given base directory.
 * Reads STORAGE_TYPE from config; defaults to filesystem.
 */
export function getAppStateStorage(baseDir: string): AppStateStorage {
  // Future: switch on config.storageType for 'azure' | 's3'
  return new FsAppStateStorage(baseDir);
}

/**
 * Create a WorkspaceStorage for the given base directory.
 * Reads STORAGE_TYPE from config; defaults to filesystem.
 */
export function getWorkspaceStorage(baseDir: string): WorkspaceStorage {
  // Future: switch on config.storageType for 'azure' | 's3'
  return new FsWorkspaceStorage(baseDir);
}
