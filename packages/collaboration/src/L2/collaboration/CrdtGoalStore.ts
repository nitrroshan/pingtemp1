/**
 * CrdtGoalStore — Goal lifecycle management via CRDT
 *
 * Stores team-level goals as CRDT Y.Map documents.
 * Each goal is a first-class document that every agent can read for context.
 *
 * CRDT doc hierarchy:
 *   {teamId}/{goalId}/goal — Goal Y.Map
 *
 * @see docs/features/task-orchestration/markdown-tasks/feature_architecture.md
 */

import type { CollaborationSpace } from "./CollaborationSpace.js";
import { rootLogger } from "../../logging.js";

const logger = rootLogger.child({ module: "CrdtGoalStore" });

export type GoalStatus = "pending" | "planning" | "researching" | "executing" | "completed" | "failed";

export interface GoalData {
  id: string;
  title: string;
  teamId: string;
  status: GoalStatus;
  submittedBy: string;          // user | system
  planId?: string | null;
  createdAt: string;
  completedAt?: string | null;
  body: string;                 // Rich markdown: user intent, success criteria, constraints
}

export class CrdtGoalStore {
  constructor(
    private space: CollaborationSpace,
    private teamId: string,
  ) {}

  /**
   * Save a goal to CRDT. Called when user submits a new goal.
   *
   * Full Hocuspocus path: {teamId}/{goalId}/goal
   */
  async saveGoal(goalId: string, title: string, userMessage: string): Promise<void> {
    try {
      const doc = await this.space.openDoc("goal");
      const map = doc.getMap("goal");

      map.set("id", goalId);
      map.set("title", title);
      map.set("teamId", this.teamId);
      map.set("status", "planning" as GoalStatus);
      map.set("submittedBy", "user");
      map.set("planId", null);
      // Fix #13: Only set createdAt if not already present
      if (!map.get("createdAt")) {
        map.set("createdAt", new Date().toISOString());
      }
      map.set("completedAt", null);

      // Build goal body from user message
      const body = [
        `# ${title}`,
        "",
        "## User Intent",
        userMessage,
        "",
        "## Success Criteria",
        "_(To be determined by planner during decomposition)_",
      ].join("\n");
      map.set("body", body);

      doc.setMeta({
        description: `Goal: ${title}`,
        createdBy: "user",
      });

      logger.debug(`Saved goal ${goalId} to CRDT`);
    } catch (err) {
      logger.error(`Failed to save goal ${goalId}: ${err}`);
    }
  }

  /**
   * Update goal status in CRDT.
   */
  async updateStatus(status: GoalStatus, planId?: string): Promise<void> {
    try {
      const doc = await this.space.openDoc("goal");
      const map = doc.getMap("goal");
      map.set("status", status);
      if (planId) {
        map.set("planId", planId);
      }
      if (status === "completed" || status === "failed") {
        map.set("completedAt", new Date().toISOString());
      }
      logger.debug(`Updated goal status → ${status}`);
    } catch (err) {
      logger.debug(`Goal status update failed (non-critical): ${err}`);
    }
  }

  /**
   * Load goal data from CRDT. Used for context injection into planner.
   */
  async loadGoal(): Promise<GoalData | null> {
    try {
      const hasGoal = await this.space.hasDoc("goal");
      if (!hasGoal) return null;

      const doc = await this.space.openDoc("goal");
      const map = doc.getMap("goal");
      const data = map.toJSON();

      if (!data.id) return null;
      return data as GoalData;
    } catch {
      return null;
    }
  }

  /**
   * List all goals across all spaces in this team (Fix #18).
   * Scans all CollaborationSpaces for goal docs.
   */
  async loadAllGoals(allSpaces: Map<string, any>): Promise<GoalData[]> {
    const goals: GoalData[] = [];
    for (const [_key, space] of allSpaces) {
      try {
        const hasGoal = await space.hasDoc("goal");
        if (!hasGoal) continue;
        const doc = await space.openDoc("goal");
        const map = doc.getMap("goal");
        const data = map.toJSON();
        if (data.id) goals.push(data as GoalData);
      } catch {
        // Skip unreadable spaces
      }
    }
    return goals;
  }
}
