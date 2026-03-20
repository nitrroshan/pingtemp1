/**
 * agentManagerHandler - Express Router for AgentManager API routes
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { Logger } from "tslog";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { Team } from "../agentManager/team/team.js";
import { TeamModel } from "../agentManager/team/schema/teamSchema.js";
import { AgentModel } from "../agentManager/team/schema/agentSchema.js";
import { randomUUID } from "crypto";

const logger = new Logger({ name: "AgentManagerHandler" });

/**
 * Initialize routes with AgentManager instance
 */
export function createAgentMangerRouteHandlers(
  agentManager: AgentManager,
): express.Router {
  const router = express.Router();

  // Middleware specific to agentManager routes
  const timeLog = (req: Request, res: Response, next: NextFunction) => {
    logger.debug(
      `[AgentManager API] ${req.method} ${req.path} - Time: ${Date.now()}`,
    );
    next();
  };

  router.use(timeLog);
  //Create a new workflow
  router.post("/createnewteam", async (req: Request, res: Response) => {
    try {
      const { teamName, goal, description, members } = req.body;

      if (!teamName || !goal) {
        logger.warn(
          "[AgentManagerHandler] Team creation failed: missing required fields",
        );
        res.status(400).json({
          error: "Team name and goal are required",
        });
        return;
      }

      logger.info("[AgentManagerHandler] Creating new team:", teamName);

      const teamConfig = {
        teamName,
        goal,
        description: description || "",
      };

      const team = new Team(teamConfig, [], agentManager);
      // Create team (members will be added after role creation)
      const savedTeam = await TeamModel.create(teamConfig);

      // Configure workflow with goal and description
      const workflowDescription = teamConfig.description
        ? `${teamConfig.goal}. ${teamConfig.description}`
        : teamConfig.goal;

      //TODO: Move to Team class constructor
      await agentManager.configureNewWorkflow(workflowDescription);
      // Get roles from AgentManager (returns AgentConfig[])
      const roles = await agentManager.getRoles(goal);
      logger.info(
        `[AgentManagerHandler] Discovered ${roles.length} roles:`,
        roles.map((r: any) => r.role),
      );

      // Save each role as an Agent document
      const agentIds: any[] = [];
      for (const role of roles) {
        const agentDoc = new AgentModel({
          name: role.name,
          role: role.role,
          goal: role.goal,
          systemPrompt: role.systemPrompt || "",
          tools: (role as any).config?.tools || [],
          mcpClientConfigs: (role as any).config?.mcpClientConfigs || {},
          teamId: savedTeam._id,
        });
        await agentDoc.save();
        agentIds.push(agentDoc._id);
        logger.debug(
          `[AgentManagerHandler] Created agent: ${role.role} (${agentDoc._id})`,
        );
      }

      // Update team with agent IDs in members array
      savedTeam.members = agentIds;
      await savedTeam.save();
      logger.info(
        `[AgentManagerHandler] Updated team with ${agentIds.length} members`,
      );

      res.json({
        status: "created",
        message: "Team created successfully",
        team: savedTeam.toObject(),
        roles: roles,
        agentIds: agentIds,
        timestamp: Date.now(),
      });

      logger.info(
        "[AgentManagerHandler] Team created successfully with roles:",
        teamName,
      );
    } catch (error) {
      logger.error("[AgentManagerHandler] Error creating team:", error);
      res.status(500).json({
        error: String(error),
        timestamp: Date.now(),
      });
    }
  });

  // // Create new task
  // router.post("/createtask", async (req: Request, res: Response) => {
  //   try {
  //     const taskParams = req.body;

  //     if (!taskParams || !taskParams.taskDescription) {
  //       logger.warn(
  //         "[AgentManagerHandler] Task creation failed: missing taskDescription"
  //       );
  //       res.status(400).json({ error: "Task description required" });
  //       return;
  //     }

  //     logger.info(
  //       "[AgentManagerHandler] Creating new task:",
  //       taskParams.taskDescription
  //     );

  //     // Configure workflow
  //     await agentManager.configureNewWorkflow(taskParams.taskDescription);

  //     // Start task asynchronously
  //     await agentManager.createTask(JSON.stringify(taskParams));

  //     res.json({
  //       status: "started",
  //       message: "Task execution started",
  //       taskDescription: taskParams.taskDescription,
  //       timestamp: Date.now(),
  //     });

  //     logger.info(
  //       "[AgentManagerHandler] Task created successfully:",
  //       taskParams.taskDescription
  //     );
  //   } catch (error) {
  //     logger.error("[AgentManagerHandler] Error creating task:", error);
  //     res.status(500).json({
  //       error: String(error),
  //       timestamp: Date.now(),
  //     });
  //   }
  // });

  // Get available roles
  router.get("/roles", async (req: Request, res: Response) => {
    try {
      const teamId = req.query.teamId as string;

      if (teamId) {
        // Get roles from database for specific team
        logger.info(
          "[AgentManagerHandler] Fetching roles from database for team:",
          teamId,
        );

        const agents = await AgentModel.find({ teamId }).lean();

        res.json({
          roles: agents.map((agent) => ({
            id: agent._id,
            name: agent.name,
            role: agent.role,
            goal: agent.goal,
            // systemPrompt: agent.systemPrompt,
            // tools: agent.tools,
            // mcpClientConfigs: agent.mcpClientConfigs,
            teamId: agent.teamId?.toString(),
          })),
          count: agents.length,
          timestamp: Date.now(),
        });

        logger.info(
          `[AgentManagerHandler] Fetched ${agents.length} roles from database`,
        );
      } else {
        // Discover roles dynamically using AgentManager
        const taskDescription =
          (req.query.taskDescription as string) || "Current task";

        logger.info(
          "[AgentManagerHandler] Discovering roles for:",
          taskDescription,
        );

        const roles = await agentManager.getRoles(taskDescription);

        res.json({
          roles,
          timestamp: Date.now(),
        });

        logger.info(
          "[AgentManagerHandler] Roles discovered successfully:",
          roles,
        );
      }
    } catch (error) {
      logger.error("[AgentManagerHandler] Error fetching roles:", error);
      res.status(500).json({
        error: String(error),
        timestamp: Date.now(),
      });
    }
  });

  // Get all teams
  router.get("/teams", async (req: Request, res: Response) => {
    try {
      logger.info("[AgentManagerHandler] Fetching all teams");

      const teams = await TeamModel.find({}).lean();

      res.json({
        teams,
        count: teams.length,
        timestamp: Date.now(),
      });

      logger.info(`[AgentManagerHandler] Fetched ${teams.length} teams`);
    } catch (error) {
      logger.error("[AgentManagerHandler] Error fetching teams:", error);
      res.status(500).json({
        error: String(error),
        timestamp: Date.now(),
      });
    }
  });

  // Get team by ID
  router.get("/teams/:teamId", async (req: Request, res: Response) => {
    try {
      const { teamId } = req.params;
      logger.info("[AgentManagerHandler] Fetching team:", teamId);

      const team = await TeamModel.findById(teamId).lean();

      if (!team) {
        res.status(404).json({
          error: "Team not found",
          timestamp: Date.now(),
        });
        return;
      }

      res.json({
        team,
        timestamp: Date.now(),
      });

      logger.info("[AgentManagerHandler] Team fetched:", teamId);
    } catch (error) {
      logger.error("[AgentManagerHandler] Error fetching team:", error);
      res.status(500).json({
        error: String(error),
        timestamp: Date.now(),
      });
    }
  });

  // Get agents for a team
  router.get("/teams/:teamId/agents", async (req: Request, res: Response) => {
    try {
      const { teamId } = req.params;

      if (!teamId) {
        res.status(400).json({
          error: "Team ID is required",
          timestamp: Date.now(),
        });
        return;
      }

      logger.info("[AgentManagerHandler] Fetching agents for team:", teamId);

      const agents = await AgentModel.find({ teamId }).lean();

      res.json({
        agents,
        count: agents.length,
        timestamp: Date.now(),
      });

      logger.info(
        `[AgentManagerHandler] Fetched ${agents.length} agents for team ${teamId}`,
      );
    } catch (error) {
      logger.error("[AgentManagerHandler] Error fetching team agents:", error);
      res.status(500).json({
        error: String(error),
        timestamp: Date.now(),
      });
    }
  });

  return router;
}
