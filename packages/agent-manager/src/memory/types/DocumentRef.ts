/**
 * DocumentRef — Universal exchange type between tasks.
 *
 * Everything that moves between tasks should be a DocumentRef — a URI with a name.
 * URI schemes: workspace:src/api.ts, crdt:{taskId}/report, https://...
 *
 * @see docs/features/crdt-first-architecture/feature_architecture.md
 */

export interface DocumentRef {
  /** URI identifying the document. Schemes: workspace:, crdt:, https: */
  uri: string;
  /** Human-readable name for this document */
  name: string;
  /** Optional description of what the document contains */
  description?: string;
  /** Optional hint for how to use this document (e.g., "Read sections 2-4") */
  hint?: string;
}

/**
 * ExpectedDoc — What a task is expected to produce.
 * Used in task context to tell agents what deliverables are expected.
 */
export interface ExpectedDoc {
  /** Suggested URI or path for the output */
  uri: string;
  /** What this document should contain */
  name: string;
  /** Detailed description of expected content */
  description?: string;
}
