/**
 * Team Service (Mongoose version)
 *
 * Manages teams with Planner Agent, manager ownership, and delegation model.
 * Uses Mongoose ODM for MongoDB persistence.
 */

import { Types } from "mongoose";
import {
  TeamModel,
  AgentModel,
  TeamMemberModel,
  AgentSkillModel,
} from "./models.js";
import type { ITeam, IAgent, ITeamMember, IAgentSkill } from "./models.js";
import type {
  Team,
  TeamWithAgents,
  Agent,
  TeamMember,
  AgentSkill,
  CreateTeamParams,
  TeamUpdates,
  TeamFilters,
  AgentConfig,
  AgentStatusUpdate,
  MemberRole,
  WorkspaceInfo,
  ITeamService,
  TeamSettings,
} from "./types/index.js";
import {
  TeamNotFoundError,
  TeamNameRequiredError,
  AgentNotFoundError,
  CannotAddSecondPlannerError,
  CannotDelegatePlannerError,
  CannotRemovePlannerError,
  AgentAlreadyDelegatedError,
  AgentNotDelegatedError,
  MemberNotFoundError,
  MemberAlreadyExistsError,
  CannotRemoveManagerError,
  SkillAlreadyAssignedError,
  SkillNotAssignedError,
} from "./errors.js";

// Default Planner Agent YAML template
const PLANNER_AGENT_YAML = `
id: planner
name: Planner Agent
role: planner
type: internal
goal: Help manager break down goals into tasks and coordinate worker agents
config:
  model:
    provider: azure-openai
    deployment: gpt-4o-2
  systemPrompt: |
    You are a Planner Agent that helps the manager:
    - Break down goals into actionable tasks
    - Assign tasks to appropriate worker agents
    - Track progress and handle blockers
    - Coordinate artifacts and deliverables
`.trim();

const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  executionMode: "parallel",
  maxConcurrency: 3,
};

// =============================================================================
// Helper: Convert Mongoose documents to plain types
// =============================================================================

function toTeam(doc: ITeam): Team {
  return {
    _id: doc._id,
    name: doc.name,
    ...(doc.description && { description: doc.description }),
    ownerId: doc.ownerId,
    workspaceId: doc.workspaceId,
    settings: doc.settings,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toAgent(doc: IAgent): Agent {
  return {
    _id: doc._id,
    teamId: doc.teamId,
    role: doc.role,
    type: doc.type,
    name: doc.name,
    ownedBy: doc.ownedBy,
    delegatedTo: doc.delegatedTo,
    definitionYaml: doc.definitionYaml,
    status: doc.status,
    lastStartedAt: doc.lastStartedAt,
    errorMessage: doc.errorMessage,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toMember(doc: ITeamMember): TeamMember {
  return {
    _id: doc._id,
    teamId: doc.teamId,
    userId: doc.userId,
    role: doc.role,
    joinedAt: doc.joinedAt,
  };
}

function toSkill(doc: IAgentSkill): AgentSkill {
  return {
    _id: doc._id,
    agentId: doc.agentId,
    skillId: doc.skillId,
    enabled: doc.enabled,
    assignedAt: doc.assignedAt,
  };
}

// =============================================================================
// TeamService Class
// =============================================================================

export class TeamService implements ITeamService {
  // ===========================================================================
  // Team CRUD
  // ===========================================================================

  async createTeam(params: CreateTeamParams): Promise<Team> {
    if (!params.name?.trim()) {
      throw new TeamNameRequiredError();
    }

    const teamId = new Types.ObjectId();
    const workspaceId = `workspace-${teamId.toHexString()}`;

    const team = await TeamModel.create({
      _id: teamId,
      name: params.name.trim(),
      ...(params.description && { description: params.description.trim() }),
      ownerId: params.ownerId,
      workspaceId,
      settings: { ...DEFAULT_TEAM_SETTINGS, ...params.settings },
    });

    // Auto-create Planner Agent
    await this.createPlannerAgent(teamId, params.ownerId);

    // Add owner as manager member
    await this.addMember(teamId.toHexString(), params.ownerId, "manager");

    return toTeam(team);
  }

  async getTeam(teamId: string): Promise<TeamWithAgents> {
    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    const agents = await this.getTeamAgents(teamId);
    const members = await this.getTeamMembers(teamId);

    return { ...toTeam(team), agents, members };
  }

  async listTeams(filters: TeamFilters): Promise<Team[]> {
    const query: Record<string, unknown> = {};

    if (filters.ownerId) {
      query.ownerId = filters.ownerId;
    }
    if (filters.name) {
      query.name = { $regex: filters.name, $options: "i" };
    }

    const teams = await TeamModel.find(query).sort({ createdAt: -1 });
    return teams.map(toTeam);
  }

  async updateTeam(teamId: string, updates: TeamUpdates): Promise<Team> {
    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    if (updates.name?.trim()) {
      team.name = updates.name.trim();
    }
    if (updates.description !== undefined) {
      team.description = updates.description?.trim();
    }
    if (updates.settings) {
      team.settings = { ...team.settings, ...updates.settings };
    }

    await team.save();
    return toTeam(team);
  }

  async deleteTeam(teamId: string): Promise<void> {
    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    const oid = new Types.ObjectId(teamId);

    // Get all agent IDs for skill cleanup
    const agents = await AgentModel.find({ teamId: oid });
    const agentIds = agents.map((a) => a._id);

    // Cascade delete
    await AgentSkillModel.deleteMany({ agentId: { $in: agentIds } });
    await AgentModel.deleteMany({ teamId: oid });
    await TeamMemberModel.deleteMany({ teamId: oid });
    await TeamModel.deleteOne({ _id: oid });

    // TODO: Delete workspace (Git repo) via WorkspaceManager
  }

  // ===========================================================================
  // Agent Management
  // ===========================================================================

  private async createPlannerAgent(
    teamId: Types.ObjectId,
    ownerId: string,
  ): Promise<Agent> {
    const planner = await AgentModel.create({
      teamId,
      role: "planner",
      type: "planner",
      name: "Planner Agent",
      ownedBy: ownerId,
      delegatedTo: null,
      definitionYaml: PLANNER_AGENT_YAML,
      status: "pending",
      lastStartedAt: null,
      errorMessage: null,
      isActive: true,
    });

    return toAgent(planner);
  }

  async addAgent(teamId: string, config: AgentConfig): Promise<Agent> {
    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    // Check if adding another planner (not allowed)
    if (config.role === "planner") {
      const existing = await AgentModel.findOne({
        teamId: new Types.ObjectId(teamId),
        type: "planner",
      });
      if (existing) {
        throw new CannotAddSecondPlannerError(teamId);
      }
    }

    const agent = await AgentModel.create({
      teamId: new Types.ObjectId(teamId),
      role: config.role,
      type: "worker",
      name: config.name,
      ownedBy: team.ownerId,
      delegatedTo: null,
      definitionYaml: config.yaml,
      status: "pending",
      lastStartedAt: null,
      errorMessage: null,
      isActive: true,
    });

    // Assign skills if provided
    if (config.skillIds?.length) {
      for (const skillId of config.skillIds) {
        await this.assignSkillToAgent(agent._id.toHexString(), skillId);
      }
    }

    return toAgent(agent);
  }

  async getTeamAgents(teamId: string): Promise<Agent[]> {
    const agents = await AgentModel.find({
      teamId: new Types.ObjectId(teamId),
    }).sort({ type: 1, createdAt: 1 }); // Planner first, then by creation
    return agents.map(toAgent);
  }

  async removeAgent(teamId: string, agentId: string): Promise<void> {
    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    // Cannot remove Planner Agent
    if (agent.type === "planner") {
      throw new CannotRemovePlannerError(agentId);
    }

    // Delete agent skills
    await AgentSkillModel.deleteMany({ agentId: new Types.ObjectId(agentId) });

    // Delete agent
    await AgentModel.deleteOne({ _id: new Types.ObjectId(agentId) });
  }

  async updateAgentStatus(
    agentId: string,
    update: AgentStatusUpdate,
  ): Promise<Agent> {
    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    agent.status = update.status;
    if (update.lastStartedAt) {
      agent.lastStartedAt = update.lastStartedAt;
    }
    if (update.errorMessage !== undefined) {
      agent.errorMessage = update.errorMessage;
    }

    await agent.save();
    return toAgent(agent);
  }

  async delegateAgent(
    teamId: string,
    agentId: string,
    employeeId: string,
  ): Promise<Agent> {
    if (typeof employeeId !== "string" || !employeeId.trim()) {
      throw new Error("employeeId must be a non-empty string");
    }

    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    // Cannot delegate Planner Agent
    if (agent.type === "planner") {
      throw new CannotDelegatePlannerError(agentId);
    }

    // Check if already delegated
    if (agent.delegatedTo) {
      throw new AgentAlreadyDelegatedError(agentId, agent.delegatedTo);
    }

    // Verify employee is a team member
    const member = await TeamMemberModel.findOne({
      teamId: new Types.ObjectId(teamId),
      userId: employeeId.trim(),
    });
    if (!member) {
      throw new MemberNotFoundError(employeeId, teamId);
    }

    agent.delegatedTo = employeeId.trim();
    await agent.save();

    return toAgent(agent);
  }

  async reclaimAgent(teamId: string, agentId: string): Promise<Agent> {
    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    // Check if actually delegated
    if (!agent.delegatedTo) {
      throw new AgentNotDelegatedError(agentId);
    }

    agent.delegatedTo = null;
    await agent.save();

    return toAgent(agent);
  }

  // ===========================================================================
  // Skill Management
  // ===========================================================================

  async assignSkillToAgent(agentId: string, skillId: string): Promise<void> {
    if (typeof skillId !== "string") {
      throw new Error("skillId must be a string");
    }
    if (!skillId.trim()) {
      throw new Error("skillId must be a non-empty string");
    }

    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    // Check if already assigned
    const existing = await AgentSkillModel.findOne({
      agentId: new Types.ObjectId(agentId),
      skillId: skillId.trim(),
    });
    if (existing) {
      throw new SkillAlreadyAssignedError(agentId, skillId);
    }

    await AgentSkillModel.create({
      agentId: new Types.ObjectId(agentId),
      skillId: skillId.trim(),
      enabled: true,
      assignedAt: new Date(),
    });
  }

  async removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
    const result = await AgentSkillModel.deleteOne({
      agentId: new Types.ObjectId(agentId),
      skillId,
    });

    if (result.deletedCount === 0) {
      throw new SkillNotAssignedError(agentId, skillId);
    }
  }

  async getAgentSkills(agentId: string): Promise<AgentSkill[]> {
    const skills = await AgentSkillModel.find({
      agentId: new Types.ObjectId(agentId),
    });
    return skills.map(toSkill);
  }

  async setSkillEnabled(
    agentId: string,
    skillId: string,
    enabled: boolean,
  ): Promise<void> {
    const result = await AgentSkillModel.updateOne(
      { agentId: new Types.ObjectId(agentId), skillId },
      { $set: { enabled } },
    );

    if (result.matchedCount === 0) {
      throw new SkillNotAssignedError(agentId, skillId);
    }
  }

  // ===========================================================================
  // Member Management
  // ===========================================================================

  async addMember(
    teamId: string,
    userId: string,
    role: MemberRole,
  ): Promise<TeamMember> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("userId must be a non-empty string");
    }

    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    // Check if already a member
    const existing = await TeamMemberModel.findOne({
      teamId: new Types.ObjectId(teamId),
      userId: userId.trim(),
    });
    if (existing) {
      throw new MemberAlreadyExistsError(userId, teamId);
    }

    const member = await TeamMemberModel.create({
      teamId: new Types.ObjectId(teamId),
      userId: userId.trim(),
      role,
      joinedAt: new Date(),
    });

    return toMember(member);
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    // Cannot remove the manager
    if (team.ownerId === userId) {
      throw new CannotRemoveManagerError(userId, teamId);
    }

    const member = await TeamMemberModel.findOne({
      teamId: new Types.ObjectId(teamId),
      userId,
    });
    if (!member) {
      throw new MemberNotFoundError(userId, teamId);
    }

    // Reclaim any agents delegated to this member
    await AgentModel.updateMany(
      { teamId: new Types.ObjectId(teamId), delegatedTo: userId },
      { $set: { delegatedTo: null } },
    );

    // Remove member
    await TeamMemberModel.deleteOne({ _id: member._id });
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const members = await TeamMemberModel.find({
      teamId: new Types.ObjectId(teamId),
    }).sort({ role: 1, joinedAt: 1 }); // Manager first, then by join date
    return members.map(toMember);
  }

  // ===========================================================================
  // Workspace
  // ===========================================================================

  async getWorkspace(teamId: string): Promise<WorkspaceInfo> {
    const team = await TeamModel.findById(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    // TODO: Integrate with WorkspaceManager for real Git status
    return {
      workspaceId: team.workspaceId,
      teamId,
      path: `./workspaces/${team.workspaceId}`,
      folders: ["docs", "code", "designs", "data"],
      gitStatus: {
        branch: "main",
        clean: true,
      },
    };
  }
}
