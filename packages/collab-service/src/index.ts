/**
 * @ping/collab-service — Standalone Hocuspocus CRDT Server
 *
 * Provides the CollabServer (Hocuspocus + Database extension + filesystem projection)
 * as an independent service package. Can run embedded or standalone.
 */

export { CollabServer } from "./server/HocuspocusServer.js";
export type { DiscussionChangeEvent } from "./server/HocuspocusServer.js";
export { FsBlobStorage, HocuspocusBlobStorageAdapter } from "./server/HocuspocusBlobStorageAdapter.js";
export type { BlobStorageProvider } from "./types/blob-storage.types.js";
export type { ICollabProvider } from "./types/collab-provider.types.js";
