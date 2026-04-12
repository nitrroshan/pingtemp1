/**
 * agentManagerHandlerV2 - Express Router for V2 API
 *
 * All data access goes through ServiceRegistry (PluginTeamService).
 * Teams always have a pluginName — agents/skills loaded from plugin .md files.
 *
 * Routes:
 *   POST /api/v2/teams           - Create team (requires pluginName)
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
import type { ServiceRegistry } from "../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "AgentManagerHandlerV2" });

/**
 * Create V2 router. ServiceRegistry is REQUIRED — route layer never branches on storage mode.
 */
export function createAgentManagerHandlerV2(services: ServiceRegistry): express.Router {
  const router = express.Router();

  // Request logging middleware
  router.use((req: Request, res: Response, next: NextFunction) => {
    logger.debug(`[V2 API] ${req.method} ${req.path}`);
    next();
  });

  // ============================================================================
  // Teams CRUD
  // ============================================================================

  /**
   * POST /teams - Load a team from a plugin (returns team info with deterministic ID)
   *
   * Body: { name, goal, description?, pluginName }
   * pluginName is REQUIRED — team is derived from the plugin.
   */
  router.post("/teams", async (req: Request, res: Response) => {
    try {
      const { name, goal, description, pluginName } = req.body;

      if (!name || !goal) {
        res.status(400).json({ error: "name and goal are required" });
        return;
      }

      if (!pluginName) {
        res.status(400).json({ error: "pluginName is required — all teams must reference a plugin" });
        return;
      }

      logger.info(`[V2] Loading team from plugin: ${pluginName}`);

      const plugin = await services.teams.loadPluginByName(pluginName);
      const teamId = services.teams.getTeamId(pluginName);

      const agentRecords = plugin.agents.map((agentDef) => ({
        id: agentDef.id,
        role: agentDef.role,
        name: agentDef.name,
        goal: agentDef.goal ?? agentDef.description ?? "",
      }));

      res.status(201).json({
        team: {
          id: teamId,
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

      logger.info(`[V2] Team loaded from plugin: ${teamId} (${pluginName}, ${agentRecords.length} agents)`);
    } catch (error: any) {
      logger.error("[V2] Error loading team:", error);
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
        const agents = await services.teams.getTeamAgents(t.id);
        teamList.push({
          id: t.id,
          name: t.name,
          goal: t.description ?? "",
          description: t.description ?? "",
          memberCount: agents.length,
          plugin: t.pluginName ?? undefined,
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
      const agents = await services.teams.getTeamAgents(teamId);
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

      // Evict cached AgentManager (teams themselves are read-only plugin projections)
      await agentManagerRegistry.remove(teamId);

      res.json({ deleted: true, teamId });
      logger.info(`[V2] Team evicted from cache: ${teamId}`);
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
   */
  router.get("/teams/:id/agents", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.id as string;
      const agents = await services.teams.getTeamAgents(teamId);
      res.json({
        agents: agents.map((a) => ({
          id: a.id,
          role: a.role,
          name: a.name,
          goal: a.goal ?? "",
          teamId,
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
