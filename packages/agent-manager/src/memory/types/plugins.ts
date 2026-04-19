/**
 * Memory Layer Plugin Interfaces
 *
 * Each memory layer (L1, L2, L3) implements a plugin interface so that
 * MemoryCoordinator can discover and manage them uniformly. Layers are
 * optional — the coordinator works with whatever plugins are registered.
 *
 * Design principles:
 * - Layers are created externally and registered with the coordinator
 * - Each layer has a consistent lifecycle: initialize → ready → dispose
 * - Each layer can provide tools for agents
 * - MemoryCoordinator doesn't import any layer implementation directly
 */

import type { StructuredToolInterface } from "@langchain/core/tools";

// ═══════════════════════════════════════════════════════════════════════════════
// BASE PLUGIN INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Memory layer identifiers
 */
export type MemoryLayerId = "L1" | "L2" | "L3";

/**
 * Base interface that all memory layer plugins implement.
 *
 * A plugin is a self-contained module that the coordinator manages
 * through a uniform lifecycle. Each plugin knows how to:
 * - initialize itself
 * - provide tools for agents
 * - clean up when done
 */
export interface IMemoryPlugin {
  /** Which layer this plugin belongs to */
  readonly layerId: MemoryLayerId;

  /** Human-readable name (e.g., "Git Workspace", "CRDT Collaboration") */
  readonly name: string;

  /** Whether the plugin has been initialized */
  readonly isReady: boolean;

  /** Initialize the plugin (async setup, connections, etc.) */
  initialize(): Promise<void>;

  /** Dispose the plugin (cleanup, close connections) */
  dispose(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// L1: WORKSPACE PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * L1 Workspace Plugin — task-scoped git branch isolation.
 *
 * Provides per-agent workspace creation, file operations,
 * and branch lifecycle (create → edit → commit → publish → merge).
 */
export interface IL1WorkspacePlugin extends IMemoryPlugin {
  layerId: "L1";

  /** Create an isolated workspace for an agent + task */
  createWorkspace(agentId: string, taskId: string): Promise<any>;

  /** Get an existing workspace by task ID */
  getWorkspace(taskId: string): any | undefined;

  /** List workspaces, optionally filtered */
  listWorkspaces(filter?: any): any[];

  /** Get the root repository path */
  getRepoPath(): string;

  /** Create LangChain tools for an agent workspace */
  createTools(workspace: any): StructuredToolInterface[];

  /** Initialize the underlying repository */
  initializeWorkspace(): Promise<void>;

  /** Root path for all workspaces */
  readonly workspacesRoot: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// L2: COLLABORATION PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * L2 Collaboration Plugin — real-time CRDT docs, plans, output manifests.
 *
 * Provides team-level shared state: collaboration spaces per goal,
 * plan storage, output manifests, and group chat.
 */
export interface IL2CollaborationPlugin extends IMemoryPlugin {
  layerId: "L2";

  /** Get or create a collaboration space for a goal */
  getOrCreateSpace(goalId: string): any;

  /** Archive a space (remove from cache, data persists) */
  archiveSpace(goalId: string): Promise<void>;

  /** Get or create a GroupChatManager for a goal */
  getGroupChatManager(goalId: string): any;

  /** Access the plan store */
  readonly planStore: any;

  /** Read a single output manifest */
  getOutputManifest(repoPath: string, taskId: string): Promise<any | null>;

  /** Get all output manifests */
  getAllManifests(repoPath: string): Promise<any[]>;

  /** Query outputs with filters */
  queryOutputs(
    repoPath: string,
    filter?: { role?: string; type?: string },
  ): Promise<any[]>;

  /** Whether the underlying CRDT server is available */
  readonly isCollabAvailable: boolean;

  /** Create the unified collab tool for an agent */
  createTools(
    space: any,
    agentRole: string,
    repoPath: string,
  ): StructuredToolInterface[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// L3: KNOWLEDGE PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * L3 Knowledge Plugin — RAG-based knowledge retrieval.
 *
 * Provides knowledge context injection for agents:
 * relevant documents, role-specific skills, and runbooks.
 */
export interface IL3KnowledgePlugin extends IMemoryPlugin {
  layerId: "L3";

  /** Find relevant documents for a query */
  relevantDocs(
    query: string,
    limit?: number,
  ): Promise<Array<{ document: { title: string; content: string } }>>;

  /** Get role-specific skills */
  roleSkills(role: string): Promise<Array<{ title: string; content: string }>>;

  /** Get role-specific runbooks */
  roleRunbooks(
    role: string,
  ): Promise<Array<{ title: string; content: string }>>;

  /** Create knowledge tools for an agent */
  createTools(agentId: string, taskId: string): StructuredToolInterface[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// COORDINATOR CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for MemoryCoordinator in plugin mode.
 * Only the team ID and task memory are required.
 * Plugins are registered separately via .registerPlugin().
 */
export interface MemoryCoordinatorPluginConfig {
  /** Team identifier for scoping memory */
  teamId: string;

  /** TaskStore / ITaskProvider instance for task state */
  taskProvider: any;

  /** Optional repo path (used by L2 projections) */
  repoPath?: string;
}
