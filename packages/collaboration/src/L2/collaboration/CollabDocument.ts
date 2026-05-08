/**
 * CollabDocument — Thin Y.Doc wrapper with typed accessors
 *
 * Wraps a single Yjs document opened via CollabServer.openDoc().
 * Provides typed accessors for Map, Array, XmlFragment, Text shared types.
 *
 * @see feature_implementation_planning.md Phase 2b
 */

import * as Y from "yjs";

/**
 * Agent presence information
 */
export interface AgentPresence {
  agentId: string;
  role: string;
  lastSeen: string;
}

/**
 * CollabDocument — Typed wrapper around a Yjs document
 */
export class CollabDocument {
  constructor(
    /** Document name within the collaboration space */
    readonly name: string,
    /** Space ID: "{teamId}/{goalId}" */
    readonly spaceId: string,
    /** Raw Yjs document reference */
    readonly ydoc: Y.Doc,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Typed accessors
  // ─────────────────────────────────────────────────────────────────────────

  getMap<T = any>(name: string = "default"): Y.Map<T> {
    return this.ydoc.getMap(name);
  }

  getArray<T = any>(name: string = "default"): Y.Array<T> {
    return this.ydoc.getArray(name);
  }

  getXmlFragment(name: string = "content"): Y.XmlFragment {
    return this.ydoc.getXmlFragment(name);
  }

  getText(name: string = "default"): Y.Text {
    return this.ydoc.getText(name);
  }

  /**
   * Run an atomic transaction on the underlying Y.Doc. Multiple shared-type
   * mutations inside the callback are batched into a single update event,
   * which both improves performance and ensures observers see them as one
   * logical change.
   *
   * Wraps `Y.Doc.transact` so callers don't need to reach through `.ydoc`.
   *
   * @param fn  Callback that performs the mutations.
   * @param origin  Optional origin tag attached to the transaction (useful
   *                for filtering observer events when broadcasting updates).
   */
  transact<T>(fn: () => T, origin?: any): T {
    return this.ydoc.transact(fn, origin);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Serialize all shared types to a plain JS object
   */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    this.ydoc.share.forEach((value, key) => {
      result[key] = value.toJSON();
    });
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata (_meta convention)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the document's _meta (description, createdBy, createdAt).
   * Convention: stored as a key in the root Y.Map("default").
   */
  getMeta(): {
    description?: string;
    createdBy?: string;
    createdAt?: string;
  } | null {
    const map = this.ydoc.getMap("default");
    const meta = map.get("_meta");
    return (meta as any) || null;
  }

  /**
   * Set the _meta for this document
   */
  setMeta(meta: {
    description: string;
    createdBy: string;
    createdAt?: string;
  }): void {
    const map = this.ydoc.getMap("default");
    map.set("_meta", {
      ...meta,
      createdAt: meta.createdAt || new Date().toISOString(),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Presence (stub — wired in Phase 3 with Hocuspocus awareness)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get agents currently viewing/editing this document
   */
  getPresence(): AgentPresence[] {
    // TODO: wire to Hocuspocus awareness states in Phase 3
    return [];
  }

  /**
   * Disconnect — cleanup handled by CollabServer
   */
  disconnect(): void {
    // No-op: connection lifecycle managed by server
  }
}
