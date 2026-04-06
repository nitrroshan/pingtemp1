/**
 * @ping/collaboration — L2 Collaboration Plugin
 *
 * Real-time CRDT-based collaboration: shared docs, plans, group chat, output manifests.
 */

export { CollaborationPlugin } from "./plugin/CollaborationPlugin.js";
export { L2CollaborationPlugin } from "./L2/L2CollaborationPlugin.js";
export type { L2CollaborationPluginConfig } from "./L2/L2CollaborationPlugin.js";
export { PlanStore } from "./L2/collaboration/PlanStore.js";
export { createCollabTool } from "./L2/tools/index.js";
