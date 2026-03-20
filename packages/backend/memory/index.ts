/**
 * Memory Module — Barrel Export
 *
 * Central entry point for all memory layer components:
 * - L1: Workspace (task-level git isolation)
 * - L2: Team Memory (CRDT collaboration, plans, output manifests)
 * - L3: Knowledge (stub)
 * - MemoryCoordinator: orchestrates all layers
 */

// Types
export * from "./types/index.js";

// Coordinator
export { MemoryCoordinator } from "./MemoryCoordinator.js";

// L1: Workspace
export {
  L1WorkspacePlugin,
  GitBranchManager,
  AgentWorkspace,
  WorkspaceManager,
  SafeAgentWorkspace,
  Scratchpad,
  IdentityCard,
  WorkspaceSearchIndex,
  TreeSitterService,
  RepoMapBuilder,
  SymbolIndex,
  createWorkspaceTools,
} from "./L1/index.js";

// L2: Team Memory (CRDT, plans, manifests, tools)
export {
  L2CollaborationPlugin,
  CollabServer,
  CollaborationSpace,
  CollabDocument,
  PlanStore,
  toGoalId,
  GroupChatManager,
  IndexPersistence,
  createCollabTool,
} from "./L2/index.js";

// L3: Knowledge (stub)
export {
  L3KnowledgePlugin,
  KnowledgeBase,
  createKnowledgeBase,
} from "./L3/index.js";
export type { KnowledgeBaseConfig } from "./L3/index.js";
