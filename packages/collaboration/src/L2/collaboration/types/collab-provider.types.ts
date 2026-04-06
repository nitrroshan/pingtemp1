/**
 * ICollabProvider — Interface for CRDT document access
 *
 * Abstracts the difference between:
 * - Embedded: CollabServer (in-process openDirectConnection)
 * - Remote: RemoteCollabClient (WebSocket HocuspocusProvider)
 *
 * CollaborationSpace depends on this interface, not on CollabServer directly.
 */

import * as Y from "yjs";

/**
 * Minimal interface for opening and listing CRDT documents.
 * Implemented by CollabServer (embedded) and RemoteCollabClient (WebSocket).
 */
export interface ICollabProvider {
  /** Open a Yjs document by name. Returns the underlying Y.Doc. */
  openDoc(docName: string): Promise<Y.Doc>;

  /** List all known document names (loaded + persisted). */
  getDocNames(): Promise<string[]>;
}
