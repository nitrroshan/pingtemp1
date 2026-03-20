/**
 * Group Chat Types — Used by GroupChatManager to record
 * chat session outcomes into CRDT `chat-outcomes` doc.
 *
 * @see feature_implementation_planning.md Phase 4
 */

/**
 * A single message within a group chat session.
 */
export interface GroupMessage {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
}

/**
 * Action item arising from a group chat decision.
 */
export interface ActionItem {
  id: string;
  description: string;
  assignedTo?: string;
  priority?: "low" | "medium" | "high";
  dueBy?: Date;
}

/**
 * Outcome of a completed group chat session.
 * Stored as items in the `chat-outcomes` Y.Array within a CollaborationSpace.
 */
export interface GroupChatOutcome {
  sessionId: string;
  topic: string;
  participants: string[];
  summary: string;
  sharedContext: Record<string, unknown>;
  actionItems: ActionItem[];
  transcript: GroupMessage[];
  startedAt: Date;
  concludedAt: Date;
}

/**
 * Binary reference shared between agents (stored in `binaries` Y.Map).
 */
export interface SharedBinary {
  content: Uint8Array;
  metadata: Record<string, unknown>;
  sharedAt: string;
  sharedBy?: string;
}
