/**
 * agentManagerHandlerV2 - Express Router for V2 API
 *
 * Clean REST routes using AgentManagerRegistry (no passed AgentManager)
 *
 * Routes:
 *   POST /api/v2/teams           - Create team
 *   GET  /api/v2/teams           - List teams
 *   GET  /api/v2/teams/:id       - Get team by ID
 *   GET  /api/v2/teams/:id/agents - Get agents for team
 *   GET  /api/v2/sessions/:id    - Get session state
 *   GET  /api/v2/sessions/:id/tasks - Get tasks for session
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { Logger } from "tslog";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";
import { TeamModel } from "../agentManager/team/schema/teamSchema.js";
import { AgentModel } from "../agentManager/team/schema/agentSchema.js";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { randomUUID } from "crypto";

const logger = new Logger({ name: "AgentManagerHandlerV2" });

/**
 * Create V2 router (no dependencies injected)
 */
export function createAgentManagerHandlerV2(): express.Router {
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
   * POST /teams - Create a new team with role discovery
   */
  router.post("/teams", async (req: Request, res: Response) => {
    try {
      const { name, goal, description } = req.body;

      if (!name || !goal) {
        res.status(400).json({ error: "name and goal are required" });
        return;
      }

      logger.info(`[V2] Creating team: ${name}`);

      // Create team in DB first
      const team = await TeamModel.create({
        teamName: name,
        goal,
        description: description || "",
      });

      // Create temporary AgentManager for role discovery
      const tempManager = new AgentManager();
      await tempManager.configureNewWorkflow(
        description ? `${goal}. ${description}` : goal,
      );

      // Discover roles
      const roles = await tempManager.getRoles(goal);
      logger.info(
        `[V2] Discovered ${roles.length} roles: ${roles.map((r: any) => r.role).join(", ")}`,
      );

      // Save agents (normalize role to lowercase for consistent matching)
      const agentIds: string[] = [];
      for (const role of roles) {
        const agent = await AgentModel.create({
          name: role.name,
          role: role.role.toLowerCase(), // Normalize to lowercase
          goal: role.goal,
          systemPrompt: role.systemPrompt || "",
          tools: (role as any).config?.tools || [],
          mcpClientConfigs: (role as any).config?.mcpClientConfigs || {},
          teamId: team._id,
        });
        agentIds.push(agent._id.toString());
      }

      // Update team with members
      team.members = agentIds.map((id) => id as any);
      await team.save();

      // Dispose temp manager - we only needed it for role discovery
      // Registry will create a fresh manager from DB when workflow starts
      await tempManager.dispose();

      res.status(201).json({
        team: {
          id: team._id.toString(),
          name: team.teamName,
          goal: team.goal,
          description: team.description,
          memberCount: agentIds.length,
        },
        agents: roles.map((r: any, i: number) => ({
          id: agentIds[i],
          role: r.role,
          name: r.name,
          goal: r.goal,
        })),
      });

      logger.info(
        `[V2] Team created: ${team._id} with ${agentIds.length} agents`,
      );
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
      const teams = await TeamModel.find().lean();

      // Count agents per team from AgentModel (more reliable than members array)
      const teamIds = teams.map((t) => t._id);
      const agentCounts = await AgentModel.aggregate([
        { $match: { teamId: { $in: teamIds } } },
        { $group: { _id: "$teamId", count: { $sum: 1 } } },
      ]);
      const countMap = new Map(
        agentCounts.map((ac: { _id: any; count: number }) => [ac._id.toString(), ac.count]),
      );

      res.json({
        teams: teams.map((t) => ({
          id: t._id.toString(),
          name: t.teamName,
          goal: t.goal,
          description: t.description,
          memberCount: countMap.get(t._id.toString()) || 0,
        })),
        count: teams.length,
      });
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
      const team = await TeamModel.findById(teamId).lean();

      if (!team) {
        res.status(404).json({ error: "Team not found" });
        return;
      }

      const agentCount = await AgentModel.countDocuments({ teamId: team._id });

      res.json({
        team: {
          id: team._id.toString(),
          name: team.teamName,
          goal: team.goal,
          description: team.description,
          memberCount: agentCount,
        },
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

      // Remove from registry cache (disposes manager)
      await agentManagerRegistry.remove(teamId);

      // Delete agents
      await AgentModel.deleteMany({ teamId });

      // Delete team
      const result = await TeamModel.findByIdAndDelete(teamId);

      if (!result) {
        res.status(404).json({ error: "Team not found" });
        return;
      }

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
   */
  router.get("/teams/:id/agents", async (req: Request, res: Response) => {
    try {
      const teamId = req.params.id as string;
      const agents = await AgentModel.find({ teamId }).lean();

      res.json({
        agents: agents.map((a) => ({
          id: a._id.toString(),
          role: a.role,
          name: a.name,
          goal: a.goal,
          teamId: a.teamId?.toString(),
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
