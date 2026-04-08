/**
 * AgentManagerRegistry - Lazy-loading cache for AgentManager instances
 *
 * Pattern: Registry with lazy loading from MongoDB
 * - Each team gets one AgentManager instance
 * - Created on first access, cached in memory
 * - Evicted when team is deleted or on explicit cleanup
 *
 * Usage:
 *   const manager = await agentManagerRegistry.getForTeam(teamId)
 *   await manager.chatWithWorker(agentId, content)
 */

import mongoose from "mongoose";
import { rootLogger } from "../logging/index.js";
import { AgentManager } from "./AgentManagerV2.js";
import { TeamModel } from "./team/schema/teamSchema.js";
import { AgentModel } from "./team/schema/agentSchema.js";
import { WorkspacePlugin } from "./plugins/WorkspacePlugin.js";
import { CollaborationPlugin } from "./plugins/CollaborationPlugin.js";
import { KnowledgePlugin } from "./plugins/KnowledgePlugin.js";

const logger = rootLogger.child({ module: "AgentManagerRegistry" });

export interface TeamData {
  id: string;
  name: string;
  goal: string;
  roles: Array<{
    id: string;
    role: string;
    name: string;
    goal: string;
    systemPrompt?: string;
  }>;
}

export class AgentManagerRegistry {
  private managers: Map<string, AgentManager> = new Map();
  private loadingPromises: Map<string, Promise<AgentManager>> = new Map();

  /**
   * Get or create AgentManager for a team
   * Lazy loads from MongoDB on first access
   */
  async getForTeam(teamId: string): Promise<AgentManager> {
    // Return cached if exists
    if (this.managers.has(teamId)) {
      logger.debug(`[Registry] Cache hit for team ${teamId}`);
      return this.managers.get(teamId)!;
    }

    // Prevent duplicate loading (race condition)
    if (this.loadingPromises.has(teamId)) {
      logger.debug(`[Registry] Waiting for in-progress load of team ${teamId}`);
      return this.loadingPromises.get(teamId)!;
    }

    // Load from DB
    const loadPromise = this.loadTeam(teamId);
    this.loadingPromises.set(teamId, loadPromise);

    try {
      const manager = await loadPromise;
      return manager;
    } finally {
      this.loadingPromises.delete(teamId);
    }
  }

  /**
   * Load team from MongoDB and create AgentManager
   */
  private async loadTeam(teamId: string): Promise<AgentManager> {
    logger.info(`[Registry] Loading team ${teamId} from database`);

    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      throw new Error(`Invalid team ID "${teamId}" — not a valid ObjectId. Use a real team ID from the database.`);
    }

    // Find team with populated members
    const team = await TeamModel.findById(teamId).lean();
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Get agents for this team
    const agents = await AgentModel.find({ teamId }).lean();

    const teamRoles = agents.map((agent) => ({
      id: agent._id.toString(),
      role: agent.role.toLowerCase(), // Normalize to lowercase for consistent matching
      name: agent.name,
      goal: agent.goal,
      systemPrompt: agent.systemPrompt,
    }));

    logger.info(
      `[Registry] Team ${team.teamName} has ${teamRoles.length} roles: ${teamRoles.map((r) => r.role).join(", ")}`,
    );

    // Create AgentManager
    const manager = new AgentManager();

    // Compute workspace/collab paths
    const workspaceDir = process.env.WORKSPACE_BASE_DIR || "./data/workspaces";
    const teamRepoPath = `${workspaceDir}/${teamId}`;

    // Register plugins — workspace (L1), collaboration (L2), knowledge (L3)
    manager.registerPlugin(
      new WorkspacePlugin({ repoPath: teamRepoPath }),
    );

    const collabPort = process.env.COLLAB_PORT
      ? parseInt(process.env.COLLAB_PORT, 10)
      : undefined;
    manager.registerPlugin(
      new CollaborationPlugin({
        teamId,
        collabStorageDir: `${teamRepoPath}/.ping/collab`,
        repoPath: teamRepoPath,
        collabPort,
      }),
    );

    if (process.env.MONGODB_URI) {
      manager.registerPlugin(
        new KnowledgePlugin({
          mongoUri: process.env.MONGODB_URI,
          promotion: {
            autoApproveFromTrusted: true,
            trustedProposers: ["system", "orchestrator"],
          },
        }),
      );
    }

    // Initialize orchestrator with team data (include MongoDB agent IDs for skill resolution)
    await manager.initializeOrchestrator(
      teamId,
      teamRoles.map((r) => r.role),
      Object.fromEntries(teamRoles.map((r) => [r.role, r.id])),
    );

    // Cache it
    this.managers.set(teamId, manager);
    logger.info(
      `[Registry] AgentManager created and cached for team ${teamId}`,
    );

    return manager;
  }

  /**
   * Evict manager from cache
   * Call when team is deleted or for cleanup
   */
  async remove(teamId: string): Promise<void> {
    const manager = this.managers.get(teamId);
    if (manager) {
      logger.info(`[Registry] Evicting team ${teamId} from cache`);
      await manager.dispose();
      this.managers.delete(teamId);
    }
  }

  /**
   * Check if a team is cached
   */
  has(teamId: string): boolean {
    return this.managers.has(teamId);
  }

  /**
   * Get all cached team IDs
   */
  getCachedTeamIds(): string[] {
    return Array.from(this.managers.keys());
  }

  /**
   * Flush all cached managers (persist buffered data to disk).
   * Call before shutdown to ensure no pending writes are lost.
   */
  async flushAll(): Promise<void> {
    logger.info(`[Registry] Flushing ${this.managers.size} cached managers`);
    const results = await Promise.allSettled(
      Array.from(this.managers.entries()).map(async ([teamId, manager]) => {
        try {
          await manager.flush();
        } catch (err) {
          logger.warn(`[Registry] Flush failed for team ${teamId}:`, err);
        }
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      logger.warn(`[Registry] ${failed} manager(s) failed to flush`);
    }
  }

  /**
   * Clear all cached managers
   * Disposes all managers before clearing
   */
  async clear(): Promise<void> {
    logger.info(
      `[Registry] Clearing all ${this.managers.size} cached managers`,
    );
    // Dispose all managers in parallel
    await Promise.all(
      Array.from(this.managers.values()).map((m) => m.dispose()),
    );
    this.managers.clear();
  }

  /**
   * Get stats about the registry
   */
  getStats(): { cachedTeams: number; teamIds: string[] } {
    return {
      cachedTeams: this.managers.size,
      teamIds: this.getCachedTeamIds(),
    };
  }
}

// Singleton instance
export const agentManagerRegistry = new AgentManagerRegistry();
