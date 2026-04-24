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

import { rootLogger } from "../logging/index.js";
import { AgentManager } from "./AgentManagerV2.js";
import { join } from "path";
import { WorkspacePlugin } from "./plugins/WorkspacePlugin.js";
import { CollaborationPlugin } from "./plugins/CollaborationPlugin.js";
import { KnowledgePlugin } from "./plugins/KnowledgePlugin.js";
import { SkillPlugin } from "./plugins/SkillPlugin.js";
import { getConfig } from "../config/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";

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
  private services: ServiceRegistry | null = null;

  /**
   * Inject ServiceRegistry for file-mode support.
   * Must be called before getForTeam() in file mode.
   */
  setServices(services: ServiceRegistry) {
    this.services = services;
  }

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
   * Load team data and create AgentManager.
   * Uses PluginTeamService for both team records and agent definitions.
   */
  private async loadTeam(teamId: string): Promise<AgentManager> {
    if (!this.services) {
      throw new Error(
        "[Registry] ServiceRegistry not set — call setServices() before getForTeam(). " +
        "This is a startup wiring bug."
      );
    }

    logger.info(`[Registry] Loading team ${teamId}`);

    const team = await this.services.teams.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found — no plugin maps to this ID`);
    }

    logger.info(`[Registry] Loading team from plugin: ${team.pluginName}`);

    // Load full agent definitions from plugin .md files
    const agentDefs = await this.services.teams.getTeamAgentDefinitions(teamId);

    const teamRoles = agentDefs.map(agentDef => ({
      id: agentDef.id,
      role: agentDef.role.toLowerCase(),
      name: agentDef.name,
      goal: agentDef.goal ?? agentDef.description ?? "",
      systemPrompt: agentDef.systemPrompt,
      pluginConfig: JSON.stringify(agentDef.config),
    }));

    logger.info(
      `[Registry] Plugin "${team.pluginName}" loaded ${teamRoles.length} agents from .md files`,
    );

    logger.info(
      `[Registry] Team "${team.name}" has ${teamRoles.length} roles: ${teamRoles.map((r) => r.role).join(", ")}`,
    );

    // Create AgentManager
    const manager = new AgentManager();

    // Compute workspace/collab paths
    const workspaceDir = process.env.WORKSPACE_BASE_DIR || "./data/workspaces";
    const teamRepoPath = `${workspaceDir}/${teamId}`;

    // Register plugins — workspace (L1), collaboration (L2), knowledge (L3), skills
    manager.registerPlugin(
      new WorkspacePlugin({ repoPath: teamRepoPath }),
    );

    // Skills plugin — loads SKILL.md files scoped to this team's registry plugin
    // Per-role filtering: each agent's .md declares defaultSkills → only those skills are tools for that role
    // __dirname at runtime = packages/backend/dist/agentManager/ — 4 levels up to repo root
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const pluginsDir = process.env.PLUGIN_REGISTRY_DIR
      ?? join(repoRoot, "packages", "registry", "plugins");

    // Build role → skill IDs map from agent definitions (config.skills from agent .md defaultSkills)
    const roleSkillMap = new Map<string, string[]>();
    for (const agentDef of agentDefs) {
      const role = agentDef.role.toLowerCase();
      const skills: string[] = (agentDef.config as any)?.skills ?? [];
      roleSkillMap.set(role, skills);
    }

    manager.registerPlugin(
      new SkillPlugin({
        pluginsDir,
        teams: team.pluginName ? [team.pluginName] : undefined,
        roleSkillMap,
      }),
    );

    const collabPort = process.env.COLLAB_PORT
      ? parseInt(process.env.COLLAB_PORT, 10)
      : undefined;

    const config = getConfig();
    let collabProvider: any = undefined;

    if (config.collabMode === "external") {
      const { RemoteCollabClient } = await import("@ping/collaboration");
      collabProvider = new RemoteCollabClient(config.collabUrl);
      logger.info(`[Registry] Using external collab server: ${config.collabUrl}`);
    }

    manager.registerPlugin(
      new CollaborationPlugin({
        teamId,
        collabStorageDir: `${teamRepoPath}/.ping/collab`,
        repoPath: teamRepoPath,
        collabPort: collabProvider ? undefined : collabPort,
        collabProvider,
      }),
    );

    if (config.mongodbUri) {
      manager.registerPlugin(
        new KnowledgePlugin({
          mongoUri: config.mongodbUri,
          promotion: {
            autoApproveFromTrusted: true,
            trustedProposers: ["system", "orchestrator"],
          },
        }),
      );
    }

    // Initialize orchestrator with team data (pass full agent records for plugin support)
    await manager.initializeOrchestrator(
      teamId,
      teamRoles.map((r) => r.role),
      Object.fromEntries(teamRoles.map((r) => [r.role, r.id])),
      teamRoles,
    );

    // Enable Chat Agents if feature flag is on
    if (config.featureFlags.enableChatAgents) {
      const allowedRoles = config.featureFlags.chatAgentRoles
        ? config.featureFlags.chatAgentRoles.split(",").map((r: string) => r.trim().toLowerCase()).filter(Boolean)
        : [];
      const rolesToEnable = allowedRoles.length > 0
        ? teamRoles.map(r => r.role).filter(r => allowedRoles.includes(r.toLowerCase()))
        : teamRoles.map(r => r.role);
      if (rolesToEnable.length > 0) {
        manager.enableChatAgents(rolesToEnable);
      }
    }

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
