/**
 * @ping/workspace — L1 Workspace Library
 *
 * Git-based isolated workspaces for agent tasks.
 * Provides 31+ workspace tools (file CRUD, git, scratchpad, code intel).
 *
 * Standalone library — no dependency on @ping/agent-manager.
 * Anyone can use L1 directly. Plugin adapter lives in the consumer (e.g. backend).
 */

export { L1WorkspacePlugin } from "./L1/L1WorkspacePlugin.js";
export { WorkspaceManager } from "./L1/workspace/WorkspaceManager.js";
export { AgentWorkspace } from "./L1/workspace/AgentWorkspace.js";
export { createWorkspaceTools } from "./L1/workspace/tools/workspace-tools.js";
export type { WorkspaceConfig } from "./types/index.js";
