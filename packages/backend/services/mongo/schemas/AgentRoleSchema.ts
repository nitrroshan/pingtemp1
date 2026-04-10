/**
 * AgentRole schema — agent record for orchestration.
 *
 * Uses collection "agentroles". Stores agent name, role, goal, systemPrompt.
 * Referenced by TeamConfig and used by AgentManagerRegistry.
 */

import mongoose, { Document } from "mongoose";

export interface IAgentRole extends Document {
  name: string;
  role: string;
  goal: string;
  systemPrompt?: string;
  tools?: any[];
  mcpClientConfigs?: Record<string, unknown>;
  teamId: mongoose.Types.ObjectId;
}

const agentRoleSchema = new mongoose.Schema<IAgentRole>(
  {
    name: { type: String, required: true, index: true },
    role: { type: String, required: true },
    goal: { type: String, required: true },
    systemPrompt: { type: String, required: true },
    tools: [{ type: mongoose.Schema.Types.Mixed }],
    mcpClientConfigs: { type: mongoose.Schema.Types.Mixed },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamConfig",
      required: true,
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
);

agentRoleSchema.index({ teamId: 1, name: 1 });

export const AgentRoleModel =
  (mongoose.models.AgentRole as mongoose.Model<IAgentRole>) ||
  mongoose.model<IAgentRole>("AgentRole", agentRoleSchema);
