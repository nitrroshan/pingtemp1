/**
 * @ping/workspace — L1 Workspace Plugin
 *
 * Git-based isolated workspaces for agent tasks.
 * Provides 31+ workspace tools (file CRUD, git, scratchpad, code intel).
 */

export { WorkspacePlugin } from "./plugin/WorkspacePlugin.js";
export { L1WorkspacePlugin } from "./L1/L1WorkspacePlugin.js";
export { WorkspaceManager } from "./L1/workspace/WorkspaceManager.js";
export { AgentWorkspace } from "./L1/workspace/AgentWorkspace.js";
export { createWorkspaceTools } from "./L1/workspace/tools/workspace-tools.js";
