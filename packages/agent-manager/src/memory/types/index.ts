/**
 * Memory System Types — Centralized type definitions for all memory layers
 *
 * L1: Agent Workspace (task-scoped file isolation, git branches)
 * L2: Team Memory (output manifests, collaboration) — v1.1
 * L3: Organization Knowledge (RAG, knowledge base) — v2.0
 */

// Plugin interfaces
export type {
  IMemoryPlugin,
  IL1WorkspacePlugin,
  IL2CollaborationPlugin,
  IL3KnowledgePlugin,
  MemoryLayerId,
  MemoryCoordinatorPluginConfig,
} from "./plugins.js";

// Output manifest types
export type { OutputManifest, OutputEntry } from "./output-manifest.types.js";

// Import OutputManifest for use in interfaces below
import type { OutputManifest } from "./output-manifest.types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// ARTIFACT TYPES (kept for backward compat; new code should use OutputManifest)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Artifact category inferred from file extension
 */
export type ArtifactCategory =
  | "code"
  | "document"
  | "config"
  | "data"
  | "test"
  | "image"
  | "other";

/**
 * @deprecated Use OutputManifest/OutputEntry from collaboration/types instead.
 * Kept for backward compat during v1.1 migration.
 */
export interface Artifact {
  id: string;
  taskId: string;
  agentId: string;
  path: string;
  type: "file" | "content";
  category: ArtifactCategory;
  content?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GIT / BRANCH TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Information about a git branch
 */
export interface BranchInfo {
  /** Branch name */
  name: string;
  /** Branch this was created from */
  baseBranch: string;
  /** When the branch was created */
  createdAt: Date;
  /** HEAD commit hash */
  headCommit: string;
}

/**
 * Status of a git branch relative to base
 */
export interface BranchStatusInfo {
  /** Branch name */
  name: string;
  /** Whether the branch exists */
  exists: boolean;
  /** Commits ahead of main */
  aheadOfMain: number;
  /** Commits behind main */
  behindOfMain: number;
  /** Most recent commit */
  lastCommit?: CommitInfo;
  /** File change counts */
  files: {
    added: number;
    modified: number;
    deleted: number;
  };
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;
  /** Merge commit hash (if successful) */
  mergeCommit?: string;
  /** Files with conflicts (if any) */
  conflicts?: string[];
}

// Task types (from MemoryManager)
export type { Task, TaskStatus, BranchStatus } from "./Task.types.js";
export type {
  TaskWithContext,
  QueueMetrics,
} from "../../util/RoleTaskQueue.types.js";

/**
 * Git commit information
 */
export interface CommitInfo {
  /** Commit SHA hash */
  hash: string;
  /** Commit message */
  message: string;
  /** Author name */
  author: string;
  /** Commit timestamp */
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Workspace lifecycle status
 */
export type WorkspaceStatus =
  | "initializing"
  | "active"
  | "published"
  | "merged"
  | "discarded"
  | "failed";

/**
 * File info within a workspace
 */
export interface FileInfo {
  /** Relative path within workspace */
  path: string;
  /** File or directory name */
  name: string;
  /** Entry type */
  type: "file" | "directory";
  /** File size in bytes */
  size?: number;
  /** Last modification time */
  lastModified?: Date;
}

/**
 * Activity log entry — records tool calls, decisions, and outcomes
 */
export interface ActivityEntry {
  /** When the activity occurred */
  timestamp: Date;
  /** Activity type */
  type: "tool_call" | "tool_result" | "decision" | "observation" | "error";
  /** Tool name (e.g., 'send_email', 'search_web') */
  tool?: string;
  /** Tool input (sanitized — no secrets) */
  input?: Record<string, any>;
  /** Tool result summary */
  output?: string;
  /** Execution duration in ms */
  duration?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Workspace metadata stored in workspace.json
 */
export interface WorkspaceMetadata {
  /** Schema version */
  version: "1.0";
  /** Unique workspace identifier */
  workspaceId: string;
  /** Associated task ID */
  taskId: string;
  /** Owning agent ID */
  agentId: string;
  /** Git branch name */
  branchName: string;
  /** Base branch (usually 'main') */
  baseBranch: string;
  /** Base commit hash at branch creation */
  baseCommit: string;
  /** Knowledge docs pulled into context */
  knowledgeRefs: string[];
  /** Task IDs whose outputs are available as context */
  dependencyTasks: string[];
  /** ISO timestamp of workspace creation */
  createdAt: string;
  /** ISO timestamp of last commit */
  lastCommitAt?: string;
  /** Current workspace lifecycle status */
  status: WorkspaceStatus;
  /** Retry attempt number (0 = first attempt) */
  retryCount: number;
  /** Workspace ID of previous attempt (if retry) */
  previousVersion?: string;
  /** Artifacts published from this workspace */
  publishedArtifacts?: {
    id: string;
    path: string;
    type: string;
  }[];
  /** Activity statistics */
  activityStats: {
    totalEntries: number;
    toolCalls: number;
    errors: number;
    firstActivity?: string;
    lastActivity?: string;
  };
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Absolute path to the repository/workspace root */
  repoPath: string;
  /** Default branch name (e.g., 'main') */
  defaultBranch?: string;
  /** Optional remote configuration */
  remote?: {
    url: string;
    name?: string;
  };
}

/**
 * Options for initializing a workspace from an existing repo (Phase 7)
 * If repoUrl is provided → clone mode. Otherwise → basic mode (current behavior).
 */
export interface WorkspaceInitOptions {
  /** Git URL to clone (HTTPS or SSH). If provided → clone mode. */
  repoUrl?: string;
  /** Branch to clone from (default: main) */
  repoBranch?: string;
  /** OR: copy from a local folder instead of cloning */
  localPath?: string;
  /** Sparse checkout — only clone these directories (saves time/space for large repos) */
  sparse?: string[];
}

/**
 * Filter for listing workspaces
 */
export interface WorkspaceFilter {
  /** Filter by agent ID */
  agentId?: string;
  /** Filter by workspace status */
  status?: WorkspaceStatus | WorkspaceStatus[];
  /** Filter workspaces created after this date */
  createdAfter?: Date;
  /** Filter workspaces created before this date */
  createdBefore?: Date;
}

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  /** Number of workspaces cleaned up */
  cleaned: number;
  /** Number of failed cleanups */
  failed: number;
  /** Error messages from failed cleanups */
  errors?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Events emitted by workspace system
 */
export interface WorkspaceEvents {
  "workspace:created": {
    workspaceId: string;
    taskId: string;
    agentId: string;
    branchName: string;
  };
  "workspace:file:created": { workspaceId: string; path: string };
  "workspace:file:updated": { workspaceId: string; path: string };
  "workspace:file:deleted": { workspaceId: string; path: string };
  "workspace:activity": { workspaceId: string; entry: ActivityEntry };
  "workspace:committed": {
    workspaceId: string;
    commitHash: string;
    message: string;
  };
  "workspace:published": { workspaceId: string; manifest: OutputManifest };
  "workspace:merged": { workspaceId: string; mergeCommit: string };
  "workspace:discarded": { workspaceId: string; reason?: string };
  "workspace:retry": {
    workspaceId: string;
    newWorkspaceId: string;
    retryCount: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Workspace error codes
 */
export type WorkspaceErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "BRANCH_EXISTS"
  | "BRANCH_NOT_FOUND"
  | "MERGE_CONFLICT"
  | "FILE_NOT_FOUND"
  | "FILE_EXISTS"
  | "INVALID_PATH"
  | "GIT_ERROR"
  | "WORKSPACE_LOCKED"
  | "MUST_READ_BEFORE_WRITE";

/**
 * Typed workspace error
 */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public code: WorkspaceErrorCode,
    public workspaceId?: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface for WorkspaceManager — implemented by memory/L1/workspace/WorkspaceManager
 */
export interface IWorkspaceManager {
  createWorkspace(agentId: string, taskId: string): Promise<any>;
  getWorkspace(taskId: string): any | undefined;
  getWorkspaceByAgent(agentId: string): any[];
  listWorkspaces(filter?: WorkspaceFilter): any[];
  cleanupCompleted(maxAge?: number): Promise<CleanupResult>;
  cleanupFailed(maxAge?: number): Promise<CleanupResult>;
  initializeWorkspace(): Promise<void>;
  getRepoPath(): string;
  getConfig(): WorkspaceConfig;
}

/**
 * @deprecated Removed in v1.1. Output manifests replace artifact registry.
 */
export interface IArtifactRegistry {
  register(opts: {
    teamId: string;
    goalId: string;
    taskId: string;
    agentId: string;
    path: string;
    content: string;
    type: string;
  }): void;
}

/**
 * Knowledge base configuration (L3 stub)
 */
export interface KnowledgeBaseConfig {
  /** Connection string or path */
  connectionString?: string;
  /** MongoDB connection URI */
  mongoUri?: string;
  /** Collection/index name */
  collection?: string;
  /** Embedding model to use */
  embeddingModel?: string;
  /** Knowledge promotion settings */
  promotion?: {
    autoApproveFromTrusted?: boolean;
    trustedProposers?: string[];
  };
}
