/**
 * @ping/collaboration — L2 Collaboration Library
 *
 * Real-time CRDT-based collaboration: shared docs, plans, group chat, output manifests.
 *
 * Standalone library — no dependency on @ping/agent-manager.
 * Anyone can use L2 directly. Plugin adapter lives in the consumer (e.g. backend).
 */

export { L2CollaborationPlugin } from "./L2/L2CollaborationPlugin.js";
export type { L2CollaborationPluginConfig } from "./L2/L2CollaborationPlugin.js";
export { PlanStore } from "./L2/collaboration/PlanStore.js";
export { CrdtTaskSync } from "./L2/collaboration/CrdtTaskSync.js";
export type { CrdtTaskData, TaskLike } from "./L2/collaboration/CrdtTaskSync.js";
export { CrdtGoalStore } from "./L2/collaboration/CrdtGoalStore.js";
export type { GoalData, GoalStatus } from "./L2/collaboration/CrdtGoalStore.js";
export { CollabServer } from "./L2/collaboration/HocuspocusServer.js";
export type { DiscussionChangeEvent } from "./L2/collaboration/HocuspocusServer.js";
export { RemoteCollabClient } from "./L2/collaboration/RemoteCollabClient.js";
export { createCollabTool } from "./L2/tools/index.js";
