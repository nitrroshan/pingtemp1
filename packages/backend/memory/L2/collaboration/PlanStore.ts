/**
 * PlanStore — goalId-scoped plan persistence
 *
 * Replaces FilePlanStore with multi-goal support, plan history,
 * and replan lineage tracking. Plans are never deleted — only archived.
 *
 * Directory structure:
 *   data/plans/{teamId}/{goalId}/{planId}.json
 *   data/plans/{teamId}/{goalId}/_archive/{planId}.json
 *
 * @see feature_implementation_planning.md Phase 1a
 */

import { promises as fs } from "fs";
import path from "path";
import { Logger } from "tslog";
import type { AgentPlanOutput } from "../../orchestrator/schemas.js";

const logger = new Logger({ name: "PlanStore" });

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PlanStatus =
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "interrupted";

export interface PlanMetadata {
  planId: string;
  teamId: string;
  goalId: string;
  goal: string;
  createdAt: string;
  completedAt?: string;
  status: PlanStatus;
  taskCount: number;
  version: number;
  parentPlanId?: string; // if this plan was created by replanning
}

export interface StoredPlan {
  plan: AgentPlanOutput;
  metadata: PlanMetadata;
  savedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate stable goalId from goal text.
 * Same goal always produces same goalId — enables replans to land in the same directory.
 */
export function toGoalId(goal: string): string {
  return goal
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN STORE
// ═══════════════════════════════════════════════════════════════════════════════

export class PlanStore {
  private baseDir: string;

  constructor(
    private teamId: string,
    repoPath: string = ".",
  ) {
    this.baseDir = path.join(repoPath, "data", "plans", teamId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Directory helpers
  // ─────────────────────────────────────────────────────────────────────────

  private goalDir(goalId: string): string {
    return path.join(this.baseDir, goalId);
  }

  private archiveDir(goalId: string): string {
    return path.join(this.baseDir, goalId, "_archive");
  }

  private planPath(goalId: string, planId: string): string {
    return path.join(this.goalDir(goalId), `${planId}.json`);
  }

  private archivePath(goalId: string, planId: string): string {
    return path.join(this.archiveDir(goalId), `${planId}.json`);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save a plan to disk. goalId is required.
   */
  async savePlan(
    plan: AgentPlanOutput,
    opts: {
      goalId: string;
      status?: PlanStatus;
      parentPlanId?: string;
      version?: number;
    },
  ): Promise<void> {
    const goalId = opts.goalId;
    await this.ensureDir(this.goalDir(goalId));

    // Compute version: count existing plans for this goal + 1
    const version =
      opts.version ?? (await this.listPlansByGoal(goalId)).length + 1;

    const storedPlan: StoredPlan = {
      plan,
      metadata: {
        planId: plan.planId,
        teamId: this.teamId,
        goalId,
        goal: plan.goal,
        createdAt: new Date().toISOString(),
        status: opts.status || "pending",
        taskCount: plan.tasks.length,
        version,
        parentPlanId: opts.parentPlanId,
      },
      savedAt: new Date().toISOString(),
    };

    const filePath = this.planPath(goalId, plan.planId);
    await fs.writeFile(filePath, JSON.stringify(storedPlan, null, 2), "utf8");
    logger.info(
      `Plan saved: ${plan.planId} (goal: ${goalId}, v${version})`,
    );
  }

  /**
   * Load a specific plan by planId and goalId
   */
  async loadPlan(
    planId: string,
    goalId: string,
  ): Promise<StoredPlan | null> {
    const filePath = this.planPath(goalId, planId);
    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content) as StoredPlan;
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * Update plan status. Adds completedAt when status is completed/failed.
   */
  async updatePlanStatus(
    planId: string,
    goalId: string,
    status: PlanStatus,
  ): Promise<boolean> {
    const stored = await this.loadPlan(planId, goalId);
    if (!stored) return false;

    stored.metadata.status = status;
    if (status === "completed" || status === "failed") {
      stored.metadata.completedAt = new Date().toISOString();
    }
    stored.savedAt = new Date().toISOString();

    const filePath = this.planPath(goalId, planId);
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), "utf8");
    logger.info(`Plan ${planId} status → ${status}`);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List all plans for a specific goal (excluding archived)
   */
  async listPlansByGoal(goalId: string): Promise<PlanMetadata[]> {
    const dir = this.goalDir(goalId);
    try {
      const files = await fs.readdir(dir);
      const plans: PlanMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = await fs.readFile(path.join(dir, file), "utf8");
          const stored: StoredPlan = JSON.parse(content);
          plans.push(stored.metadata);
        } catch {
          // Skip corrupt files
        }
      }

      return plans.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  /**
   * List all plans across all goals
   */
  async listAllPlans(): Promise<PlanMetadata[]> {
    try {
      const goalDirs = await fs.readdir(this.baseDir, {
        withFileTypes: true,
      });
      const all: PlanMetadata[] = [];

      for (const entry of goalDirs) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const plans = await this.listPlansByGoal(entry.name);
        all.push(...plans);
      }

      return all.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  /**
   * Get the active plan for a specific goal (approved or executing)
   */
  async getActivePlan(goalId: string): Promise<StoredPlan | null> {
    const plans = await this.listPlansByGoal(goalId);
    const active = plans.find(
      (p) => p.status === "executing" || p.status === "approved",
    );
    if (!active) return null;
    return this.loadPlan(active.planId, goalId);
  }

  /**
   * Get the latest active plan across all goals (for restart recovery)
   */
  async getLatestActivePlan(): Promise<StoredPlan | null> {
    const all = await this.listAllPlans();
    const active = all.find(
      (p) => p.status === "executing" || p.status === "approved",
    );
    if (!active) return null;
    return this.loadPlan(active.planId, active.goalId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Archive (replaces delete)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Archive a plan (move to _archive/ subfolder). Never truly deleted.
   */
  async archivePlan(planId: string, goalId: string): Promise<boolean> {
    const srcPath = this.planPath(goalId, planId);
    try {
      await fs.access(srcPath);
    } catch {
      return false; // file doesn't exist
    }

    await this.ensureDir(this.archiveDir(goalId));
    const destPath = this.archivePath(goalId, planId);
    await fs.rename(srcPath, destPath);
    logger.info(`Plan archived: ${planId}`);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backward compatibility (used by OrchestratorService during migration)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @deprecated Use savePlan with goalId instead. Kept for migration.
   */
  async deletePlan(planId: string): Promise<boolean> {
    // Search across all goals for this planId and archive it
    const all = await this.listAllPlans();
    const plan = all.find((p) => p.planId === planId);
    if (!plan) return false;
    return this.archivePlan(planId, plan.goalId);
  }

  /**
   * @deprecated Use getLatestActivePlan() instead.
   * Returns the latest plan for this team (any goal), mimicking old FilePlanStore.getLatestPlan().
   */
  async getLatestPlan(): Promise<StoredPlan | null> {
    const all = await this.listAllPlans();
    if (all.length === 0) return null;
    const latest = all[0]!;
    return this.loadPlan(latest.planId, latest.goalId);
  }
}
