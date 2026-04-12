/**
 * agentManagerHandlerV2 - Express Router for V2 API
 *
 * All data access goes through ServiceRegistry (file or mongo adapters).
 * No Mongoose model imports — storage mode is transparent.
 *
 * Routes:
 *   POST /api/v2/teams           - Create team
 *   GET  /api/v2/teams           - List teams
 *   GET  /api/v2/teams/:id       - Get team by ID
 *   DELETE /api/v2/teams/:id     - Delete team
 *   GET  /api/v2/teams/:id/agents - Get agents for team
 *   GET  /api/v2/sessions/:id    - Get session state
 *   GET  /api/v2/sessions/:id/tasks - Get tasks for session
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { rootLogger } from "../logging/index.js";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";
import { randomUUID } from "crypto";

const logger = rootLogger.child({ module: "AgentManagerHandlerV2" });

/**
 * Create V2 router. ServiceRegistry is REQUIRED — route layer never branches on storage mode.
 */
export function createAgentManagerHandlerV2(services: ServiceRegistry): express.Router {
  const router = express.Router();

  // Helper: load a plugin by name (used by multiple endpoints)
  async function loadPluginByName(pluginName: string) {
    const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
    const { join, resolve } = await import("path");
    const repoRoot = resolve(__dirname, "..", "..", "..", "..");
    const registryDir = process.env.PLUGIN_REGISTRY_DIR
      ?? join(repoRoot, "packages", "registry", "plugins");
    const loader = new PluginLoader(registryDir);
    return loader.loadPlugin(pluginName);
  }

  // Request logging middleware
  router.use((req: Request, res: Response, next: NextFunction) => {
    logger.debug(`[V2 API] ${req.method} ${req.path}`);
    next();
  });

  // ============================================================================
  // Teams CRUD
  // ============================================================================

  /**
   * POST /teams - Create a new team (from plugin or LLM role discovery)
   *
   * Body: { name, goal, description?, pluginName? }
   * When pluginName is provided, loads agents/skills from the plugin folder
   * instead of using LLM role discovery.
   */
  router.post("/teams", async (req: Request, res: Response) => {
    try {
      const { name, goal, description, pluginName } = req.body;

      if (!name || !goal) {
        res.status(400).json({ error: "name and goal are required" });
        return;
      }

      logger.info(`[V2] Creating team: ${name}${pluginName ? ` (plugin: ${pluginName})` : ""}`);

      // ── Plugin-based team creation ──
      // Plugin folder is the single source of truth (like Claude Code).
      // We only persist the team record with pluginName — no per-agent DB writes needed.
      // At runtime, loadTeam() reads agents directly from .md files.
      if (pluginName) {
        const plugin = await loadPluginByName(pluginName);

        // Persist team record only — agents live in plugin .md files
        const team = await services.teams.createTeam({
          name,
          description: description || plugin.manifest.description || goal,
          ownerId: "local",
          workspaceId: randomUUID(),
          pluginName,
          settings: { executionMode: "sequential", maxConcurrency: 1 },
        });

        // Return agent info from plugin (no DB records created)
        const agentRecords = plugin.agents.map((agentDef) => ({
          id: agentDef.id,
          role: agentDef.role,
          name: agentDef.name,
          goal: agentDef.goal,
        }));

        res.status(201).json({
          team: {
            id: team.id,
            name,
            goal,
            description: description || plugin.manifest.description || "",
            memberCount: agentRecords.length,
            plugin: pluginName,
          },
          agents: agentRecords,
          skills: plugin.skills.map((s: any) => ({ id: s.id, name: s.name, description: s.description })),
          modes: plugin.modes,
        });

        logger.info(`[V2] Team created from plugin: ${team.id} (${pluginName}, ${agentRecords.length} agents)`);
        return;
      }

      // ── Legacy: LLM role discovery ──
      const tempManager = new AgentManager();
      await tempManager.configureNewWorkflow(
        description ? `${goal}. ${description}` : goal,
      );

      const roles = await tempManager.getRoles(goal);
      logger.info(
        `[V2] Discovered ${roles.length} roles: ${roles.map((r: any) => r.role).join(", ")}`,
      );

      // Persist team via ServiceRegistry
      const team = await services.teams.createTeam({
        name,
        description: description || goal,
        ownerId: "local",
        workspaceId: randomUUID(),
        settings: { executionMode: "sequential", maxConcurrency: 1 },
      });

      const agentIds: string[] = [];
      for (const role of roles) {
        const agent = await services.agents.addAgent(team.id, {
          teamId: team.id,
          name: role.name,
          role: role.role.toLowerCase(),
          type: "worker",
          ownedBy: "local",
          delegatedTo: null,
          definitionYaml: "",
          status: "pending",
          lastStartedAt: null,
          errorMessage: null,
          isActive: true,
        });
        agentIds.push(agent.id);
      }

      await tempManager.dispose();

      res.status(201).json({
        team: {
          id: team.id,
          name,
          goal,
          description: description || "",
          memberCount: agentIds.length,
        },
        agents: roles.map((r: any, i: number) => ({
          id: agentIds[i],
          role: r.role,
          name: r.name,
          goal: r.goal,
        })),
      });

      logger.info(`[V2] Team created: ${team.id} with ${agentIds.length} agents`);
    } catch (error: any) {
      logger.error("[V2] Error creating team:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  /**
   * GET /teams - List all teams
   */
  router.get("/teams", async (req: Request, res: Response) => {
    try {
      const teams = await services.teams.listTeams();
      const teamList = [];
      for (const t of teams) {
        let memberCount = 0;
        // Plugin teams: count agents from plugin folder
        if ((t as any).pluginName) {
          try {
            const plugin = await loadPluginByName((t as any).pluginName);
            memberCount = plugin.agents.length;
          } catch { /* plugin missing */ }
        } else {
          const agents = await services.agents.getTeamAgents(t.id);
          memberCount = agents.length;
        }
        teamList.push({
          id: t.id,
          name: t.name,
          goal: t.description ?? "",
          description: t.description ?? "",
          memberCount,
          plugin: (t as any).pluginName ?? undefined,
        });
      }
      res.json({ teams: teamList, count: teamList.length });
    } catch (error: any) {
      logger.error("[V2] Error listing teams:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  /**
   * GET /teams/:id - Get team by ID
   */
  router.get("/teams/:id", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.id as string;
      const team = await services.teams.getTeam(teamId);
      if (!team) { res.status(404).json({ error: "Team not found" }); return; }
      const agents = await services.agents.getTeamAgents(teamId);
      res.json({
        team: { id: team.id, name: team.name, goal: team.description ?? "", description: team.description ?? "", memberCount: agents.length },
      });
    } catch (error: any) {
      logger.error("[V2] Error getting team:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  /**
   * DELETE /teams/:id - Delete team
   */
  router.delete("/teams/:id", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.id as string;
      if (!teamId) {
        res.status(400).json({ error: "Team ID is required" });
        return;
      }

      await agentManagerRegistry.remove(teamId);

      const agents = await services.agents.getTeamAgents(teamId);
      for (const agent of agents) {
        await services.agents.removeAgent(teamId, agent.id);
      }
      await services.teams.deleteTeam(teamId);

      res.json({ deleted: true, teamId });
      logger.info(`[V2] Team deleted: ${teamId}`);
    } catch (error: any) {
      logger.error("[V2] Error deleting team:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // ============================================================================
  // Agents
  // ============================================================================

  /**
   * GET /teams/:id/agents - Get agents for a team
   * Plugin teams: loads agents from .md files
   * DB teams: loads from database
   */
  router.get("/teams/:id/agents", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.id as string;
      const team = await services.teams.getTeam(teamId);

      // Plugin team: load agents from plugin folder
      if (team && (team as any).pluginName) {
        try {
          const plugin = await loadPluginByName((team as any).pluginName);
          res.json({
            agents: plugin.agents.map((a) => ({
              id: a.id,
              role: a.role,
              name: a.name,
              goal: a.goal ?? a.description ?? "",
              teamId,
            })),
            count: plugin.agents.length,
          });
          return;
        } catch (error: any) {
          res.status(404).json({ error: `Plugin "${(team as any).pluginName}" not found` });
          return;
        }
      }

      // DB team
      const agents = await services.agents.getTeamAgents(teamId);

      res.json({
        agents: agents.map((a) => ({
          id: a.id,
          role: a.role,
          name: a.name,
          goal: (a as any).goal ?? "",
          teamId: a.teamId,
        })),
        count: agents.length,
      });
    } catch (error: any) {
      logger.error("[V2] Error getting agents:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // ============================================================================
  // Sessions (read-only, runtime state)
  // ============================================================================

  /**
   * GET /sessions/:teamId - Get session state for a team
   * Session is the runtime state of the AgentManager
   */
  router.get("/sessions/:teamId", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;

      // Check if manager is loaded (don't force load for status check)
      if (!agentManagerRegistry.has(teamId)) {
        res.json({
          session: {
            teamId,
            active: false,
            state: "not_initialized",
          },
        });
        return;
      }

      const manager = await agentManagerRegistry.getForTeam(teamId);
      const orchestratorState = manager.getOrchestratorState();
      const pendingPlan = manager.getOrchestratorPendingPlan();

      res.json({
        session: {
          teamId,
          active: true,
          state: orchestratorState || "idle",
          hasPendingPlan: !!pendingPlan,
          planTaskCount: pendingPlan?.tasks?.length || 0,
        },
      });
    } catch (error: any) {
      logger.error("[V2] Error getting session:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  /**
   * GET /sessions/:teamId/tasks - Get tasks for a session
   */
  router.get("/sessions/:teamId/tasks", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;

      if (!agentManagerRegistry.has(teamId)) {
        res.json({ tasks: [], count: 0 });
        return;
      }

      const manager = await agentManagerRegistry.getForTeam(teamId);
      const taskStore = manager.getTaskStore();
      const tasks = taskStore?.getAllTasks() || [];

      res.json({
        tasks: tasks.map((t) => ({
          id: t.id,
          description: t.description,
          status: t.status,
          assignedRole: t.assigned_role,
          priority: t.priority,
        })),
        count: tasks.length,
      });
    } catch (error: any) {
      logger.error("[V2] Error getting tasks:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // ============================================================================
  // Registry Stats (debug endpoint)
  // ============================================================================

  /**
   * GET /registry/stats - Get registry statistics
   */
  router.get("/registry/stats", (req: Request, res: Response) => {
    const stats = agentManagerRegistry.getStats();
    res.json(stats);
  });

  return router;
}
