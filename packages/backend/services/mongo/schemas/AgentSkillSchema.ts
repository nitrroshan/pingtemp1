/**
 * AgentSkill schema — many-to-many between agents and skills.
 */

import mongoose from "mongoose";

export interface IAgentSkill {
  agentId: string;
  skillId: string;
  enabled?: boolean;
  assignedAt: Date;
}

const agentSkillSchema = new mongoose.Schema<IAgentSkill>(
  {
    agentId: { type: String, required: true, trim: true },
    skillId: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

agentSkillSchema.index({ agentId: 1 });
agentSkillSchema.index({ skillId: 1 });
agentSkillSchema.index({ agentId: 1, skillId: 1 }, { unique: true });

export const AgentSkillModel =
  (mongoose.models.AgentSkill as mongoose.Model<IAgentSkill>) ||
  mongoose.model<IAgentSkill>("AgentSkill", agentSkillSchema);
