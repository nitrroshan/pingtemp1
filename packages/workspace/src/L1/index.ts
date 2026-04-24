/**
 * L1 — Agent Workspace (task-scoped file isolation, git branches)
 *
 * Provides per-task git branch isolation, file operations,
 * scratchpad, identity, search, and code intelligence.
 */

// Plugin
export { L1WorkspacePlugin } from "./L1WorkspacePlugin.js";

export {
  GitBranchManager,
  AgentWorkspace,
  WorkspaceManager,
  SafeAgentWorkspace,
  Scratchpad,
  createWorkspaceTools,
  WorkspaceSearchIndex,
  TreeSitterService,
  RepoMapBuilder,
  SymbolIndex,
} from "./workspace/index.js";

export type { SearchHit } from "./workspace/index.js";

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
} from "./workspace/index.js";
