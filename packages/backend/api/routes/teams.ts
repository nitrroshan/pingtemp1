/**
 * Team Routes - Express Router for Team Service API
 *
 * REST endpoints for team management, agent operations, and member management.
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { Logger } from "tslog";
import { TeamService } from "../../team/index.js";
import {
  TeamNotFoundError,
  TeamNameRequiredError,
  AgentNotFoundError,
  CannotAddSecondPlannerError,
  CannotDelegatePlannerError,
  CannotRemovePlannerError,
  AgentAlreadyDelegatedError,
  AgentNotDelegatedError,
  MemberAlreadyExistsError,
  CannotRemoveManagerError,
  SkillAlreadyAssignedError,
} from "../../team/errors.js";

const logger = new Logger({ name: "api/teams" });

// =============================================================================
// Types
// =============================================================================

interface CreateTeamBody {
  name: string;
  ownerId: string;
  description?: string;
  settings?: {
    executionMode?: "sequential" | "parallel" | "hybrid";
    maxConcurrency?: number;
  };
}

interface AddAgentBody {
  name: string;
  role: string;
  yaml?: string;
  skills?: string[];
}

interface DelegateAgentBody {
  employeeId: string;
}

interface AddMemberBody {
  userId: string;
  role: "employee";
}

interface UpdateAgentStatusBody {
  status: "pending" | "running" | "stopped" | "error";
  errorMessage?: string;
}

// Route parameter interfaces
interface TeamParams {
  id: string;
}

interface AgentParams extends TeamParams {
  agentId: string;
}

interface SkillParams extends AgentParams {
  skillId: string;
}

interface MemberParams extends TeamParams {
  userId: string;
}

// =============================================================================
// Error Handler Middleware
// =============================================================================

function handleTeamServiceError(
  error: unknown,
  res: Response,
  operation: string,
): void {
  logger.error(`[teams] ${operation} failed:`, error);

  if (error instanceof TeamNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof AgentNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof TeamNameRequiredError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (
    error instanceof CannotAddSecondPlannerError ||
    error instanceof CannotDelegatePlannerError ||
    error instanceof CannotRemovePlannerError ||
    error instanceof AgentAlreadyDelegatedError ||
    error instanceof AgentNotDelegatedError ||
    error instanceof MemberAlreadyExistsError ||
    error instanceof CannotRemoveManagerError ||
    error instanceof SkillAlreadyAssignedError
  ) {
    res.status(409).json({ error: error.message });
    return;
  }

  // Generic error
  res.status(500).json({
    error: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  });
}

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create team routes with injected TeamService
 */
export function createTeamRoutes(teamService: TeamService): express.Router {
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Logging Middleware
  // ---------------------------------------------------------------------------

  router.use((req: Request, res: Response, next: NextFunction) => {
    logger.debug(`[teams] ${req.method} ${req.path}`);
    next();
  });

  // ---------------------------------------------------------------------------
  // Team CRUD
  // ---------------------------------------------------------------------------

  // POST /teams - Create a new team
  router.post("/", async (req: Request, res: Response) => {
    try {
      const body = req.body as CreateTeamBody;

      if (!body.name) {
        res.status(400).json({ error: "Team name is required" });
        return;
      }

      if (!body.ownerId) {
        res.status(400).json({ error: "Owner ID is required" });
        return;
      }

      logger.info(`[teams] Creating team: ${body.name}`);

      const team = await teamService.createTeam({
        name: body.name,
        ownerId: body.ownerId,
        ...(body.description && { description: body.description }),
        ...(body.settings && { settings: body.settings }),
      });

      logger.info(`[teams] Created team: ${team._id.toHexString()}`);

      res.status(201).json({
        status: "created",
        team: {
          id: team._id.toHexString(),
          name: team.name,
          ownerId: team.ownerId,
          workspaceId: team.workspaceId,
          settings: team.settings,
          createdAt: team.createdAt,
        },
      });
    } catch (error) {
      handleTeamServiceError(error, res, "Create team");
    }
  });

  // GET /teams/:id - Get team by ID
  router.get("/:id", async (req: Request<TeamParams>, res: Response) => {
    try {
      const { id } = req.params;

      const result = await teamService.getTeam(id);

      res.json({
        team: {
          id: result._id.toHexString(),
          name: result.name,
          ownerId: result.ownerId,
          workspaceId: result.workspaceId,
          settings: result.settings,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        },
        agents: result.agents.map((a) => ({
          id: a._id.toHexString(),
          name: a.name,
          role: a.role,
          type: a.type,
          status: a.status,
          delegatedTo: a.delegatedTo,
        })),
        members: result.members.map((m) => ({
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
      });
    } catch (error) {
      handleTeamServiceError(error, res, "Get team");
    }
  });

  // GET /teams - List teams by owner
  router.get("/", async (req: Request, res: Response) => {
    try {
      const { ownerId } = req.query;

      if (!ownerId || typeof ownerId !== "string") {
        res.status(400).json({ error: "ownerId query parameter is required" });
        return;
      }

      const teams = await teamService.listTeams({ ownerId });

      res.json({
        teams: teams.map((t) => ({
          id: t._id.toHexString(),
          name: t.name,
          ownerId: t.ownerId,
          workspaceId: t.workspaceId,
          createdAt: t.createdAt,
        })),
        count: teams.length,
      });
    } catch (error) {
      handleTeamServiceError(error, res, "List teams");
    }
  });

  // PUT /teams/:id - Update team
  router.put("/:id", async (req: Request<TeamParams>, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description, settings } = req.body;

      const team = await teamService.updateTeam(id, {
        name,
        description,
        settings,
      });

      res.json({
        status: "updated",
        team: {
          id: team._id.toHexString(),
          name: team.name,
          ownerId: team.ownerId,
          workspaceId: team.workspaceId,
          settings: team.settings,
          updatedAt: team.updatedAt,
        },
      });
    } catch (error) {
      handleTeamServiceError(error, res, "Update team");
    }
  });

  // DELETE /teams/:id - Delete team
  router.delete("/:id", async (req: Request<TeamParams>, res: Response) => {
    try {
      const { id } = req.params;

      logger.info(`[teams] Deleting team: ${id}`);

      await teamService.deleteTeam(id);

      logger.info(`[teams] Deleted team: ${id}`);

      res.json({
        status: "deleted",
        teamId: id,
      });
    } catch (error) {
      handleTeamServiceError(error, res, "Delete team");
    }
  });

  // ---------------------------------------------------------------------------
  // Agent Management
  // ---------------------------------------------------------------------------

  // POST /teams/:id/agents - Add agent to team
  router.post(
    "/:id/agents",
    async (req: Request<TeamParams>, res: Response) => {
      try {
        const { id } = req.params;
        const body = req.body as AddAgentBody;

        if (!body.name) {
          res.status(400).json({ error: "Agent name is required" });
          return;
        }

        if (!body.role) {
          res.status(400).json({ error: "Agent role is required" });
          return;
        }

        if (!body.yaml) {
          res.status(400).json({ error: "Agent YAML definition is required" });
          return;
        }

        logger.info(`[teams] Adding agent to team ${id}: ${body.name}`);

        const agent = await teamService.addAgent(id, {
          name: body.name,
          role: body.role,
          yaml: body.yaml,
          ...(body.skills && { skillIds: body.skills }),
        });

        res.status(201).json({
          status: "created",
          agent: {
            id: agent._id.toHexString(),
            teamId: agent.teamId.toHexString(),
            name: agent.name,
            role: agent.role,
            type: agent.type,
            status: agent.status,
          },
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Add agent");
      }
    },
  );

  // DELETE /teams/:id/agents/:agentId - Remove agent from team
  router.delete(
    "/:id/agents/:agentId",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { id, agentId } = req.params;

        logger.info(`[teams] Removing agent ${agentId} from team ${id}`);

        await teamService.removeAgent(id, agentId);

        res.json({
          status: "deleted",
          agentId,
          teamId: id,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Remove agent");
      }
    },
  );

  // POST /teams/:id/agents/:agentId/delegate - Delegate agent
  router.post(
    "/:id/agents/:agentId/delegate",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { id, agentId } = req.params;
        const body = req.body as DelegateAgentBody;

        if (!body.employeeId) {
          res.status(400).json({ error: "Employee ID is required" });
          return;
        }

        logger.info(
          `[teams] Delegating agent ${agentId} to ${body.employeeId}`,
        );

        const agent = await teamService.delegateAgent(
          id,
          agentId,
          body.employeeId,
        );

        res.json({
          status: "delegated",
          agent: {
            id: agent._id.toHexString(),
            name: agent.name,
            delegatedTo: agent.delegatedTo,
          },
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Delegate agent");
      }
    },
  );

  // POST /teams/:id/agents/:agentId/reclaim - Reclaim delegated agent
  router.post(
    "/:id/agents/:agentId/reclaim",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { id, agentId } = req.params;

        logger.info(`[teams] Reclaiming agent ${agentId}`);

        const agent = await teamService.reclaimAgent(id, agentId);

        res.json({
          status: "reclaimed",
          agent: {
            id: agent._id.toHexString(),
            name: agent.name,
            delegatedTo: agent.delegatedTo,
          },
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Reclaim agent");
      }
    },
  );

  // PUT /teams/:id/agents/:agentId/status - Update agent status
  router.put(
    "/:id/agents/:agentId/status",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { agentId } = req.params;
        const body = req.body as UpdateAgentStatusBody;

        if (!body.status) {
          res.status(400).json({ error: "Status is required" });
          return;
        }

        const agent = await teamService.updateAgentStatus(agentId, {
          status: body.status,
          errorMessage: body.errorMessage ?? null,
        });

        res.json({
          status: "updated",
          agent: {
            id: agent._id.toHexString(),
            name: agent.name,
            status: agent.status,
            errorMessage: agent.errorMessage,
          },
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Update agent status");
      }
    },
  );

  // PATCH /teams/:id/agents/:agentId — Update agent config (name, role, yaml)
  router.patch(
    "/:id/agents/:agentId",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { agentId } = req.params;
        const { name, role, yaml } = req.body as {
          name?: unknown;
          role?: unknown;
          yaml?: unknown;
        };

        const update: { name?: string; role?: string; yaml?: string } = {};

        if (name !== undefined) {
          if (typeof name !== "string" || !name.trim()) {
            res.status(400).json({ error: "name must be a non-empty string" });
            return;
          }
          update.name = name;
        }

        if (role !== undefined) {
          if (typeof role !== "string" || !role.trim()) {
            res.status(400).json({ error: "role must be a non-empty string" });
            return;
          }
          update.role = role;
        }

        if (yaml !== undefined) {
          if (typeof yaml !== "string" || !yaml.trim()) {
            res.status(400).json({ error: "yaml must be a non-empty string" });
            return;
          }
          update.yaml = yaml;
        }

        if (Object.keys(update).length === 0) {
          res.status(400).json({ error: "At least one field (name, role, yaml) is required" });
          return;
        }

        const agent = await teamService.updateAgent(agentId, update);

        res.json({ status: "updated", agent: {
          id: agent._id.toHexString(),
          name: agent.name,
          role: agent.role,
          definitionYaml: agent.definitionYaml,
          updatedAt: agent.updatedAt,
        }});
      } catch (error) {
        handleTeamServiceError(error, res, "Update agent config");
      }
    },
  );

  // GET /teams/:id/agents/:agentId/skills - Get agent skills
  router.get(
    "/:id/agents/:agentId/skills",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { agentId } = req.params;

        const skills = await teamService.getAgentSkills(agentId);

        res.json({
          agentId,
          skills: skills.map((s) => ({
            skillId: s.skillId,
            enabled: s.enabled,
            assignedAt: s.assignedAt,
          })),
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Get agent skills");
      }
    },
  );

  // POST /teams/:id/agents/:agentId/skills - Assign skill to agent
  router.post(
    "/:id/agents/:agentId/skills",
    async (req: Request<AgentParams>, res: Response) => {
      try {
        const { agentId } = req.params;
        const { skillId } = req.body;

        if (!skillId) {
          res.status(400).json({ error: "Skill ID is required" });
          return;
        }

        await teamService.assignSkillToAgent(agentId, skillId);

        res.status(201).json({
          status: "assigned",
          agentId,
          skillId,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Assign skill");
      }
    },
  );

  // DELETE /teams/:id/agents/:agentId/skills/:skillId - Remove skill
  router.delete(
    "/:id/agents/:agentId/skills/:skillId",
    async (req: Request<SkillParams>, res: Response) => {
      try {
        const { agentId, skillId } = req.params;

        await teamService.removeSkillFromAgent(agentId, skillId);

        res.json({
          status: "removed",
          agentId,
          skillId,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Remove skill");
      }
    },
  );

  // PUT /teams/:id/agents/:agentId/skills/:skillId - Enable/disable skill
  router.put(
    "/:id/agents/:agentId/skills/:skillId",
    async (req: Request<SkillParams>, res: Response) => {
      try {
        const { agentId, skillId } = req.params;
        const { enabled } = req.body;

        if (typeof enabled !== "boolean") {
          res.status(400).json({ error: "enabled (boolean) is required" });
          return;
        }

        await teamService.setSkillEnabled(agentId, skillId, enabled);

        res.json({
          status: "updated",
          agentId,
          skillId,
          enabled,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Set skill enabled");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Member Management
  // ---------------------------------------------------------------------------

  // GET /teams/:id/members - Get team members
  router.get(
    "/:id/members",
    async (req: Request<TeamParams>, res: Response) => {
      try {
        const { id } = req.params;

        const members = await teamService.getTeamMembers(id);

        res.json({
          teamId: id,
          members: members.map((m) => ({
            userId: m.userId,
            role: m.role,
            joinedAt: m.joinedAt,
          })),
          count: members.length,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Get members");
      }
    },
  );

  // POST /teams/:id/members - Add member to team
  router.post(
    "/:id/members",
    async (req: Request<TeamParams>, res: Response) => {
      try {
        const { id } = req.params;
        const body = req.body as AddMemberBody;

        if (!body.userId) {
          res.status(400).json({ error: "User ID is required" });
          return;
        }

        logger.info(`[teams] Adding member ${body.userId} to team ${id}`);

        await teamService.addMember(id, body.userId, body.role || "employee");

        res.status(201).json({
          status: "added",
          teamId: id,
          userId: body.userId,
          role: body.role || "employee",
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Add member");
      }
    },
  );

  // DELETE /teams/:id/members/:userId - Remove member
  router.delete(
    "/:id/members/:userId",
    async (req: Request<MemberParams>, res: Response) => {
      try {
        const { id, userId } = req.params;

        logger.info(`[teams] Removing member ${userId} from team ${id}`);

        await teamService.removeMember(id, userId);

        res.json({
          status: "removed",
          teamId: id,
          userId,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Remove member");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Workspace
  // ---------------------------------------------------------------------------

  // GET /teams/:id/workspace - Get workspace info
  router.get(
    "/:id/workspace",
    async (req: Request<TeamParams>, res: Response) => {
      try {
        const { id } = req.params;

        const workspace = await teamService.getWorkspace(id);

        res.json({
          teamId: id,
          workspace,
        });
      } catch (error) {
        handleTeamServiceError(error, res, "Get workspace");
      }
    },
  );

  return router;
}
