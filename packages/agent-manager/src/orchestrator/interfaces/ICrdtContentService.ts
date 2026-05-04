/**
 * ICrdtContentService — CRDT document operations.
 *
 * CRDT is truth for rich content (documents, reports, discussions).
 * System uses this for status projection (Flow A) and doc creation (Flow C).
 * Agents use this indirectly via the `collab` tool.
 *
 * Production: HocuspocusCrdtService (wraps CrdtTaskSync + CrdtGoalStore).
 */

export interface ICrdtContentService {
  // ─── Document Creation (Flow C: system → CRDT) ──────────
  createTaskDoc(task: { id: string; description: string; assigned_role: string; context?: Record<string, any> }): Promise<void>;
  createPlanDoc(plan: any, goalId: string): Promise<void>;
  createGoalDoc(goalId: string, title: string, message: string): Promise<void>;

  // ─── Status Projection (Flow A: MongoDB → CRDT copy) ────
  syncTaskStatus(taskId: string, status: string, output?: any): Promise<void>;
  syncPlanStatus(status: string): Promise<void>;
  syncGoalStatus(status: string): Promise<void>;
  updateIndex(tasks: Array<{ id: string; assigned_role: string; status: string }>): Promise<void>;

  // ─── Agent Status (CRDT-exclusive ephemeral) ─────────────
  updateAgentStatus(role: string, status: "busy" | "idle", taskId?: string): Promise<void>;

  // ─── Lifecycle ────────────────────────────────────────────
  /** Resolve CRDT scope to a specific goal (lazy initialization). */
  resolveForGoal(goalId: string): void;
  /** Check if CRDT is available (goal resolved, connection active). */
  isAvailable(): boolean;
}
