/**
 * L2 — Team Memory (CRDT collaboration, plans, output manifests, tools)
 *
 * Provides real-time CRDT doc collaboration, plan storage,
 * output manifest management, group chat, and L2 agent tools.
 */

// Plugin
export { L2CollaborationPlugin } from "./L2CollaborationPlugin.js";
export type { L2CollaborationPluginConfig } from "./L2CollaborationPlugin.js";

// Collaboration
export { CollabServer } from "./collaboration/HocuspocusServer.js";
export { RemoteCollabClient } from "./collaboration/RemoteCollabClient.js";
export { CollaborationSpace } from "./collaboration/CollaborationSpace.js";
export { CollabDocument } from "./collaboration/CollabDocument.js";
export { PlanStore, toGoalId } from "./collaboration/PlanStore.js";
export { GroupChatManager } from "./collaboration/GroupChatManager.js";

// Collaboration types
export type { ICollabProvider } from "./collaboration/types/collab-provider.types.js";
export type {
  OutputManifest,
  OutputEntry,
} from "./collaboration/types/output-manifest.types.js";

export type {
  GroupChatOutcome,
  ActionItem,
  GroupMessage,
  SharedBinary,
} from "./collaboration/types/group-chat.types.js";

// Code Intelligence persistence (L2 snapshot save/load for L1 indexes)
export { IndexPersistence } from "./codeintel/IndexPersistence.js";
export {
  IndexSnapshotModel,
  type SymbolEntry,
  type FileState,
  type IIndexSnapshot,
} from "./codeintel/models/IndexSnapshot.model.js";

// L2 Agent tools
export { createCollabTool } from "./tools/index.js";
