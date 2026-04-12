/**
 * Team Service Types
 *
 * Type definitions for team management with Planner Agent,
 * manager ownership, and delegation model.
 */

import type { Types } from "mongoose";

// =============================================================================
// Team Types
// =============================================================================

export interface Team {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  ownerId: string; // Manager (user ID)
  workspaceId: string; // Git repo reference
  settings: TeamSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamSettings {
  executionMode: "sequential" | "parallel" | "hybrid";
  maxConcurrency: number;
  pluginName?: string; // Plugin used to create this team (e.g., "engineering-team")
}

export interface CreateTeamParams {
  name: string;
  ownerId: string;
  description?: string;
  settings?: Partial<TeamSettings>;
}

export interface TeamUpdates {
  name?: string;
  description?: string;
  settings?: Partial<TeamSettings>;
}

export interface TeamFilters {
  ownerId?: string;
  name?: string;
}

export interface TeamWithAgents extends Team {
  agents: Agent[];
  members: TeamMember[];
}

// =============================================================================
// Agent Types
// =============================================================================

export interface Agent {
  _id: Types.ObjectId;
  teamId: Types.ObjectId; // Reference to teams._id
  role: string; // 'planner' | 'engineer' | 'designer' | ...
  type: AgentType;
  name: string;
  ownedBy: string; // Manager ID
  delegatedTo: string | null; // Employee ID or null

  // Agent Definition (stored as YAML text)
  definitionYaml: string; // Full YAML from Team Builder

  // Lifecycle (database-driven sync)
  status: AgentStatus;
  lastStartedAt: Date | null;
  errorMessage: string | null;

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type AgentType = "planner" | "worker";

export type AgentStatus = "pending" | "running" | "stopped" | "error";

export interface AgentConfig {
  name: string;
  role: string;
  yaml: string; // Full YAML definition
  skillIds?: string[]; // Skills to assign
}

export interface AgentStatusUpdate {
  status: AgentStatus;
  lastStartedAt?: Date;
  errorMessage?: string | null;
}

// =============================================================================
// Team Member Types
// =============================================================================

export interface TeamMember {
  _id: Types.ObjectId;
  teamId: Types.ObjectId; // Reference to teams._id
  userId: string;
  role: MemberRole;
  joinedAt: Date;
}

export type MemberRole = "manager" | "employee";

// =============================================================================
// Agent Skills Types (junction table)
// =============================================================================

export interface AgentSkill {
  _id: Types.ObjectId;
  agentId: Types.ObjectId; // Reference to agents._id
  skillId: string; // Reference to skills.skillId
  enabled: boolean; // Runtime enable/disable
  assignedAt: Date;
}

// =============================================================================
// Workspace Types
// =============================================================================

export interface WorkspaceInfo {
  workspaceId: string;
  teamId: string;
  path: string;
  folders: string[];
  gitStatus?: {
    branch: string;
    clean: boolean;
  };
}

// =============================================================================
// Service Interface
// =============================================================================

export interface ITeamService {
  // Team CRUD
  createTeam(params: CreateTeamParams): Promise<Team>;
  getTeam(teamId: string): Promise<TeamWithAgents>;
  listTeams(filters: TeamFilters): Promise<Team[]>;
  updateTeam(teamId: string, updates: TeamUpdates): Promise<Team>;
  deleteTeam(teamId: string): Promise<void>;

  // Agent management
  addAgent(teamId: string, config: AgentConfig): Promise<Agent>;
  getTeamAgents(teamId: string): Promise<Agent[]>;
  removeAgent(teamId: string, agentId: string): Promise<void>;
  updateAgentStatus(agentId: string, update: AgentStatusUpdate): Promise<Agent>;
  delegateAgent(
    teamId: string,
    agentId: string,
    employeeId: string,
  ): Promise<Agent>;
  reclaimAgent(teamId: string, agentId: string): Promise<Agent>;

  // Skill management
  assignSkillToAgent(agentId: string, skillId: string): Promise<void>;
  removeSkillFromAgent(agentId: string, skillId: string): Promise<void>;
  getAgentSkills(agentId: string): Promise<AgentSkill[]>;
  setSkillEnabled(
    agentId: string,
    skillId: string,
    enabled: boolean,
  ): Promise<void>;

  // Member management
  addMember(
    teamId: string,
    userId: string,
    role: MemberRole,
  ): Promise<TeamMember>;
  removeMember(teamId: string, userId: string): Promise<void>;
  getTeamMembers(teamId: string): Promise<TeamMember[]>;

  // Workspace
  getWorkspace(teamId: string): Promise<WorkspaceInfo>;
}
