/**
 * GroupChatManager — Stub for orchestrating multi-agent group chats
 *
 * Manages group chat sessions and persists outcomes to the CRDT
 * `chat-outcomes` Y.Array within a CollaborationSpace. The Planner
 * observes outcomes in real-time via Hocuspocus and can
 * re-prioritize tasks immediately.
 *
 * **v1.1 Status**: Stub — wiring and type contracts are in place.
 * Full orchestration (turn management, moderation, voting)
 * is deferred to v1.2+.
 *
 * @see feature_implementation_planning.md Phase 4a
 */

import { rootLogger } from "../../logging.js";
import { CollaborationSpace, WELL_KNOWN_DOCS } from "./CollaborationSpace.js";
import type {
  GroupChatOutcome,
  ActionItem,
  GroupMessage,
  SharedBinary,
} from "./types/group-chat.types.js";

export { type GroupChatOutcome, type ActionItem, type GroupMessage };

const logger = rootLogger.child({ module: "GroupChatManager" });

/**
 * Options for starting a group chat session.
 */
export interface GroupChatOptions {
  /** Unique session identifier */
  sessionId: string;
  /** Topic/question to discuss */
  topic: string;
  /** Agent roles participating in the chat */
  participants: string[];
  /** Optional initial context shared with all participants */
  sharedContext?: Record<string, unknown>;
}

/**
 * GroupChatManager — Stub implementation
 *
 * Provides the data contracts and CRDT wiring for group chat.
 * The actual message orchestration (turn-taking, moderation,
 * consensus detection) is not yet implemented.
 */
export class GroupChatManager {
  constructor(private readonly space: CollaborationSpace) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Session lifecycle (stubs)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start a new group chat session.
   * @stub — Currently only records session metadata. Full orchestration
   * (turn management, moderation) deferred to v1.2+.
   */
  async startSession(options: GroupChatOptions): Promise<string> {
    logger.info(
      `[STUB] Starting group chat session: ${options.sessionId} — topic: "${options.topic}"`,
    );
    // TODO(v1.2): Initialize turn manager, set up message routing
    return options.sessionId;
  }

  /**
   * Record the outcome of a completed group chat session into
   * the `chat-outcomes` CRDT Y.Array.
   *
   * This is the primary integration point — the Planner observes
   * outcomes as they arrive via Hocuspocus, enabling immediate
   * re-planning without polling.
   */
  async storeOutcome(outcome: GroupChatOutcome): Promise<void> {
    const doc = await this.space.openDoc(WELL_KNOWN_DOCS.CHAT_OUTCOMES);
    doc.getArray<GroupChatOutcome>("chat-outcomes").push([outcome]);
    logger.info(
      `Stored group chat outcome: session=${outcome.sessionId}, ` +
        `participants=${outcome.participants.join(",")}`,
    );
    // Hocuspocus auto-persists via Database extension + projects via onChange
  }

  /**
   * Retrieve all recorded chat outcomes for the current goal.
   */
  async getOutcomes(): Promise<GroupChatOutcome[]> {
    const doc = await this.space.openDoc(WELL_KNOWN_DOCS.CHAT_OUTCOMES);
    return doc.getArray<GroupChatOutcome>("chat-outcomes").toJSON();
  }

  /**
   * Retrieve a specific chat outcome by session ID.
   */
  async getOutcome(sessionId: string): Promise<GroupChatOutcome | undefined> {
    const outcomes = await this.getOutcomes();
    return outcomes.find((o) => o.sessionId === sessionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Binary sharing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Share a binary/large-file in the `binaries` CRDT Y.Map.
   *
   * Multi-writer: one agent generates a diagram, another annotates
   * with metadata; concurrent writes merge automatically via Y.Map.
   */
  async shareBinary(
    name: string,
    content: Uint8Array,
    metadata: Record<string, unknown> = {},
    sharedBy?: string,
  ): Promise<void> {
    const doc = await this.space.openDoc(WELL_KNOWN_DOCS.BINARIES);
    const entry: SharedBinary = {
      content,
      metadata,
      sharedAt: new Date().toISOString(),
      sharedBy,
    };
    doc.getMap<SharedBinary>("binaries").set(name, entry);
    logger.info(`Shared binary: "${name}" (${content.byteLength} bytes)`);
  }

  /**
   * Retrieve a shared binary by name.
   */
  async getBinary(name: string): Promise<SharedBinary | undefined> {
    const doc = await this.space.openDoc(WELL_KNOWN_DOCS.BINARIES);
    return doc.getMap<SharedBinary>("binaries").get(name);
  }

  /**
   * List all shared binary names.
   */
  async listBinaries(): Promise<string[]> {
    const doc = await this.space.openDoc(WELL_KNOWN_DOCS.BINARIES);
    return Array.from(doc.getMap<SharedBinary>("binaries").keys());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Dispose — currently a no-op (docs managed by CollaborationSpace).
   */
  dispose(): void {
    logger.debug("GroupChatManager disposed (no-op)");
  }
}
