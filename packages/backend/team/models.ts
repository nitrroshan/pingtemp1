/**
 * Mongoose Schemas for TeamService
 *
 * Defines Mongoose schemas and models for teams, agents, members, and skills.
 */

import mongoose, { Schema, Document, Types } from "mongoose";

// =============================================================================
// Team Schema
// =============================================================================

export interface ITeam extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  ownerId: string;
  workspaceId: string;
  pluginName?: string;
  settings: {
    executionMode: "sequential" | "parallel" | "hybrid";
    maxConcurrency: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const teamSettingsSchema = new Schema(
  {
    executionMode: {
      type: String,
      enum: ["sequential", "parallel", "hybrid"],
      default: "parallel",
    },
    maxConcurrency: { type: Number, default: 3 },
  },
  { _id: false },
);

const teamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    ownerId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, unique: true },
    pluginName: { type: String, default: null },
    settings: { type: teamSettingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

teamSchema.index({ name: 1, ownerId: 1 });
teamSchema.index({ createdAt: -1 });

export const TeamModel =
  (mongoose.models.Team as mongoose.Model<ITeam>) ||
  mongoose.model<ITeam>("Team", teamSchema);

// =============================================================================
// Agent Schema
// =============================================================================

export interface IAgent extends Document {
  _id: Types.ObjectId;
  teamId: Types.ObjectId;
  role: string;
  type: "planner" | "worker";
  name: string;
  ownedBy: string;
  delegatedTo: string | null;
  definitionYaml: string;
  status: "pending" | "running" | "stopped" | "error";
  lastStartedAt: Date | null;
  errorMessage: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const agentSchema = new Schema<IAgent>(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    role: { type: String, required: true },
    type: { type: String, enum: ["planner", "worker"], required: true },
    name: { type: String, required: true },
    ownedBy: { type: String, required: true },
    delegatedTo: { type: String, default: null, index: true },
    definitionYaml: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "stopped", "error"],
      default: "pending",
      index: true,
    },
    lastStartedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

agentSchema.index({ teamId: 1, role: 1 });
agentSchema.index({ teamId: 1, type: 1 });

export const AgentModel =
  (mongoose.models.Agent as mongoose.Model<IAgent>) ||
  mongoose.model<IAgent>("Agent", agentSchema);

// =============================================================================
// TeamMember Schema
// =============================================================================

export interface ITeamMember extends Document {
  _id: Types.ObjectId;
  teamId: Types.ObjectId;
  userId: string;
  role: "manager" | "employee";
  joinedAt: Date;
}

const teamMemberSchema = new Schema<ITeamMember>(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["manager", "employee"], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
teamMemberSchema.index({ teamId: 1, role: 1 });

export const TeamMemberModel =
  (mongoose.models.TeamMember as mongoose.Model<ITeamMember>) ||
  mongoose.model<ITeamMember>("TeamMember", teamMemberSchema);

// =============================================================================
// AgentSkill Schema (junction table)
// =============================================================================

export interface IAgentSkill extends Document {
  _id: Types.ObjectId;
  agentId: Types.ObjectId;
  skillId: string;
  enabled: boolean;
  assignedAt: Date;
}

const agentSkillSchema = new Schema<IAgentSkill>(
  {
    agentId: {
      type: Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      index: true,
    },
    skillId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

agentSkillSchema.index({ agentId: 1, skillId: 1 }, { unique: true });
agentSkillSchema.index({ agentId: 1, enabled: 1 });

export const AgentSkillModel =
  (mongoose.models.AgentSkill as mongoose.Model<IAgentSkill>) ||
  mongoose.model<IAgentSkill>("AgentSkill", agentSkillSchema);
