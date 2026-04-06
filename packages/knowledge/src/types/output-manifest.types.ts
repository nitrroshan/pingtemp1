/**
 * Output Manifest Types — Shared data contract between L1 and L2
 *
 * An OutputManifest is written by L1's AgentWorkspace.publish() to
 * `.ping/outputs/{taskId}.json`. L2 discovers and queries them via
 * the unified `collab` tool.
 *
 * Lives in shared types/ because it bridges layers — L1 produces it,
 * L2 reads it. Neither layer owns it.
 */

/**
 * Single file entry in an output manifest
 */
export interface OutputEntry {
  /** Relative path in workspace (e.g., "artifacts/code/handler.ts") */
  path: string;
  /** Inferred category from file extension */
  category:
    | "code"
    | "document"
    | "config"
    | "data"
    | "test"
    | "image"
    | "other";
  /** File size in bytes */
  sizeBytes: number;
  /** SHA-256 content hash for deduplication */
  contentHash: string;
}

/**
 * Output manifest — describes everything an agent produced for a task.
 * Written to `.ping/outputs/{taskId}.json` on publish().
 */
export interface OutputManifest {
  /** Task that produced this output */
  taskId: string;
  /** Role of the agent that produced it */
  role: string;
  /** Agent (worker) ID */
  agentId: string;
  /** Goal this task belongs to */
  goalId: string;
  /** All files produced */
  outputs: OutputEntry[];
  /** LLM-friendly summary of what the agent did */
  activitySummary: string;
  /** When the manifest was created */
  publishedAt: string;
  /** Metrics */
  metrics: {
    filesCreated: number;
    commits: number;
    duration: number;
  };
}
