/**
 * CollaborationSpace — Per-goal namespace over a CollabServer
 *
 * Each goal gets its own CollaborationSpace which applies a
 * `{teamId}/{goalId}/` prefix to all document names. This ensures
 * document isolation between goals while sharing a single Hocuspocus
 * server instance.
 *
 * @see feature_implementation_planning.md Phase 2c
 */

import * as Y from "yjs";
import type { ICollabProvider } from "./types/collab-provider.types.js";
import { CollabDocument } from "./CollabDocument.js";
import { rootLogger } from "../../logging.js";

const logger = rootLogger.child({ module: "CollaborationSpace" });

/**
 * Well-known document names within a CollaborationSpace.
 * These are auto-discovered by the `collab` tool.
 */
export const WELL_KNOWN_DOCS = {
  /** Map of agentId → { role, status, lastUpdated } */
  AGENT_STATUSES: "agent-statuses",
  /** Array of { sessionId, participants, outcome, summary } */
  CHAT_OUTCOMES: "chat-outcomes",
  /** Array of binary/large-file references */
  BINARIES: "binaries",
} as const;

export class CollaborationSpace {
  /** Document prefix: "{teamId}/{goalId}/" */
  private readonly prefix: string;

  /** Cache of opened CollabDocuments */
  private readonly docs = new Map<string, CollabDocument>();

  constructor(
    /** Space identifier — typically "{teamId}/{goalId}" */
    readonly id: string,
    readonly teamId: string,
    readonly goalId: string,
    private readonly server: ICollabProvider,
  ) {
    this.prefix = `${teamId}/${goalId}/`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Document access
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Open (or reuse) a CRDT document within this space.
   *
   * The doc name is prefixed with `{teamId}/{goalId}/` automatically.
   * E.g., `openDoc("agent-statuses")` → document `"team-1/build-app/agent-statuses"`
   */
  async openDoc(docName: string): Promise<CollabDocument> {
    // Return cached if already open
    const cached = this.docs.get(docName);
    if (cached) return cached;

    const fullName = this.prefix + docName;
    const ydoc = await this.server.openDoc(fullName);

    const doc = new CollabDocument(docName, this.id, ydoc);
    this.docs.set(docName, doc);
    logger.debug(`Opened doc: ${fullName}`);
    return doc;
  }

  /**
   * List all documents that belong to this space
   * (filters server-wide doc names by this space's prefix).
   */
  async listDocs(): Promise<string[]> {
    const allNames = await this.server.getDocNames();
    return allNames
      .filter((n) => n.startsWith(this.prefix))
      .map((n) => n.slice(this.prefix.length));
  }

  /**
   * Check if a document exists in this space (loaded or persisted).
   */
  async hasDoc(docName: string): Promise<boolean> {
    const docs = await this.listDocs();
    return docs.includes(docName);
  }

  /**
   * Get a previously opened doc, or null if not yet opened
   */
  getDoc(docName: string): CollabDocument | null {
    return this.docs.get(docName) ?? null;
  }

  /**
   * Disconnect all documents in this space
   */
  disconnectAll(): void {
    for (const doc of this.docs.values()) {
      doc.disconnect();
    }
    this.docs.clear();
    logger.debug(`Disconnected all docs in space: ${this.id}`);
  }
}
