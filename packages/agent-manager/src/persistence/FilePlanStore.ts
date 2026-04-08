/**
 * FilePlanStore — Built-in file-based plan persistence for @ping/agent-manager
 *
 * Simple JSON-on-disk store. Used as default when no plugin provides a PlanStore.
 * Directory structure: data/plans/{teamId}/{goalId}/{planId}.json
 *
 * Accepts an optional StorageProvider for cloud storage.
 */

import { promises as fs } from "fs";
import path from "path";
import { rootLogger } from "../logging.js";

const logger = rootLogger.child({ module: "FilePlanStore" });

/** Minimal storage interface — matches @ping/backend AppStateStorage */
export interface StorageProvider {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export type PlanStatus = "pending" | "approved" | "executing" | "completed" | "failed" | "archived";

export interface StoredPlan {
  plan: any;
  metadata: {
    planId: string;
    teamId: string;
    goalId: string;
    goal: string;
    createdAt: string;
    status: PlanStatus;
    taskCount?: number;
    version: number;
    parentPlanId?: string;
    completedAt?: string;
  };
  savedAt: string;
}

export class FilePlanStore {
  private baseDir: string;
  private relativeBase: string;
  private storage: StorageProvider | null;

  constructor(teamId: string, repoPath: string = ".", storage?: StorageProvider) {
    this.baseDir = path.join(repoPath, "data", "plans", teamId);
    this.relativeBase = path.join("plans", teamId);
    this.storage = storage || null;
  }

  private goalDir(goalId: string): string {
    return path.join(this.baseDir, goalId);
  }

  private archiveDir(goalId: string): string {
    return path.join(this.baseDir, goalId, "_archive");
  }

  private planPath(goalId: string, planId: string): string {
    return path.join(this.goalDir(goalId), `${planId}.json`);
  }

  private relPath(goalId: string, planId: string): string {
    return path.join(this.relativeBase, goalId, `${planId}.json`);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!this.storage) await fs.mkdir(dir, { recursive: true });
  }

  async savePlan(
    plan: any,
    opts: { goalId: string; status?: PlanStatus; parentPlanId?: string; version?: number },
  ): Promise<void> {
    const goalId = opts.goalId;
    await this.ensureDir(this.goalDir(goalId));
    const version = opts.version ?? (await this.listPlansByGoal(goalId)).length + 1;

    const storedPlan: StoredPlan = {
      plan,
      metadata: {
        planId: plan.planId,
        teamId: path.basename(this.baseDir),
        goalId,
        goal: plan.goal,
        createdAt: new Date().toISOString(),
        status: opts.status || "pending",
        taskCount: plan.tasks?.length,
        version,
        parentPlanId: opts.parentPlanId,
      },
      savedAt: new Date().toISOString(),
    };

    const data = JSON.stringify(storedPlan, null, 2);
    if (this.storage) {
      await this.storage.write(this.relPath(goalId, plan.planId), data);
    } else {
      await fs.writeFile(this.planPath(goalId, plan.planId), data, "utf8");
    }
    logger.info(`Plan saved: ${plan.planId} (goal: ${goalId}, v${version})`);
  }

  async loadPlan(planId: string, goalId: string): Promise<StoredPlan | null> {
    try {
      const content = this.storage
        ? await this.storage.read(this.relPath(goalId, planId))
        : await fs.readFile(this.planPath(goalId, planId), "utf8");
      if (!content) return null;
      return JSON.parse(content);
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async listPlansByGoal(goalId: string): Promise<StoredPlan[]> {
    try {
      if (this.storage) {
        const files = await this.storage.list(path.join(this.relativeBase, goalId));
        const plans: StoredPlan[] = [];
        for (const f of files) {
          if (f.endsWith(".json") && !path.basename(f).startsWith("_")) {
            const content = await this.storage.read(f);
            if (content) plans.push(JSON.parse(content));
          }
        }
        return plans;
      }
      const dir = this.goalDir(goalId);
      const files = await fs.readdir(dir);
      const plans: StoredPlan[] = [];
      for (const f of files) {
        if (f.endsWith(".json") && !f.startsWith("_")) {
          const content = await fs.readFile(path.join(dir, f), "utf8");
          plans.push(JSON.parse(content));
        }
      }
      return plans;
    } catch {
      return [];
    }
  }

  async getActivePlan(goalId: string): Promise<StoredPlan | null> {
    const plans = await this.listPlansByGoal(goalId);
    return plans.find(p => ["pending", "approved", "executing"].includes(p.metadata.status)) ?? null;
  }

  async archivePlan(goalId: string, planId: string): Promise<void> {
    const src = this.planPath(goalId, planId);
    const dst = path.join(this.archiveDir(goalId), `${planId}.json`);
    await this.ensureDir(this.archiveDir(goalId));
    await fs.rename(src, dst);
    logger.info(`Plan archived: ${planId}`);
  }

  async updatePlanStatus(planId: string, goalId: string, status: PlanStatus): Promise<boolean> {
    const stored = await this.loadPlan(planId, goalId);
    if (!stored) return false;
    stored.metadata.status = status;
    if (status === "completed" || status === "failed") {
      stored.metadata.completedAt = new Date().toISOString();
    }
    const data = JSON.stringify(stored, null, 2);
    if (this.storage) {
      await this.storage.write(this.relPath(goalId, planId), data);
    } else {
      await fs.writeFile(this.planPath(goalId, planId), data, "utf8");
    }
    logger.info(`Plan ${planId} status → ${status}`);
    return true;
  }

  async deletePlan(goalId: string, planId: string): Promise<void> {
    try {
      if (this.storage) {
        await this.storage.delete(this.relPath(goalId, planId));
      } else {
        await fs.unlink(this.planPath(goalId, planId));
      }
    } catch { /* ignore */ }
  }
}
