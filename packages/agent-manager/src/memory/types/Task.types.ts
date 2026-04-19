/**
 * Task status type
 * Represents the lifecycle states of a task in the memory manager
 */
export type TaskStatus =
  | "ready"
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "discarded";

/**
 * Workspace branch status for git-based workflows
 */
export type BranchStatus =
  | "not_created"
  | "active"
  | "merged"
  | "merge_requested"
  | "discarded";

/**
 * How a task was completed — prevents auto-complete race condition.
 */
export type CompletionSource = "tool" | "auto" | "manual";

/**
 * Task interface
 * Represents a task with its metadata, dependencies, and execution state
 */
export interface Task {
  /** Unique task identifier */
  id: string;

  /** Short human-readable title */
  title?: string;

  /** Human-readable description of what the task should accomplish */
  description: string;

  /** The role (lowercase) assigned to execute this task */
  assigned_role: string;

  /** Priority level (1=highest, 5=lowest, default: 3) */
  priority?: number;

  /** Task type — drives dispatch behavior */
  type?: "work" | "review" | "collaboration" | "subtask" | "decision" | "research";

  /** Description of what this task should produce */
  expectedOutput?: string;

  /** Optional context or additional information for the task */
  context?: Record<string, any>;

  /** Current execution status of the task */
  status: TaskStatus;

  /** Optional output or result from task execution */
  output?: any;

  /** How the task was completed (set at completion time) */
  completionSource?: CompletionSource;

  /** Last status reported by the worker (e.g., "blocked") — used by auto-complete guard */
  lastReportedStatus?: string;

  /** Map of prerequisite task IDs to their completion status (true = completed) */
  prerequisites: Map<string, boolean>;

  /** Array of task IDs that depend on this task's completion */
  dependants: string[];

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace Layer Fields (v1.1)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Workspace ID for git-based task isolation */
  workspaceId?: string;

  /** Git branch name for task work */
  branchName?: string;

  /** Current status of the task's branch */
  branchStatus?: BranchStatus;

  /** Retry version number for workspace branches (1 = first attempt) */
  branchVersion?: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // Artifact & Knowledge Fields (v1.0, v2.0)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Array of artifact IDs produced by this task */
  artifacts?: string[];

  /** Array of knowledge reference IDs used by this task */
  knowledgeRefs?: string[];
}
