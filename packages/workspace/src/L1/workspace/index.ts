/**
 * Workspace module barrel export
 */
export { GitBranchManager } from "./GitBranchManager.js";
export { AgentWorkspace } from "./AgentWorkspace.js";
export { WorkspaceManager } from "./WorkspaceManager.js";
export { SafeAgentWorkspace } from "./SafeAgentWorkspace.js";
export { Scratchpad } from "./Scratchpad.js";
export { IdentityCard } from "./IdentityCard.js";
export type {
  IdentityAgentDef,
  IdentityTaskContext,
  IdentityTeamContext,
  ProgressSnapshot,
  ToolInfo,
  ContextInfo,
  Decision,
  IdentitySnapshot,
} from "./IdentityCard.js";
export { createWorkspaceTools } from "./tools/workspace-tools.js";

// Search (Phase 8)
export { WorkspaceSearchIndex } from "./search/WorkspaceSearchIndex.js";
export type { SearchHit } from "./search/index.js";

// Code Intelligence (Phase 10)
export {
  TreeSitterService,
  RepoMapBuilder,
  SymbolIndex,
} from "./codeintel/index.js";
export type {
  LanguageName,
  Symbol,
  SymbolKind,
  RankedSymbol,
  RepoMap,
  FileSummary,
  SymbolLocation,
  SymbolSearchOptions,
  SymbolReference,
} from "./codeintel/index.js";
