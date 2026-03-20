import mongoose from "mongoose";
import type { AgentSkill } from "../types/index.js";

/**
 * Agent Skills Collection Schema
 *
 * Many-to-many relationship between agents and skills.
 * Tracks which skills are assigned to which agents.
 */

const agentSkillSchema = new mongoose.Schema<AgentSkill>(
  {
    agentId: {
      type: String,
      required: true,
      trim: true,
    },
    skillId: {
      type: String,
      required: true,
      trim: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

// Indexes
agentSkillSchema.index({ agentId: 1 });
agentSkillSchema.index({ skillId: 1 });
agentSkillSchema.index({ agentId: 1, skillId: 1 }, { unique: true }); // Prevent duplicate assignments

// Use existing model if already compiled, otherwise create new
const AgentSkillModel =
  (mongoose.models.AgentSkill as mongoose.Model<AgentSkill>) ||
  mongoose.model<AgentSkill>("AgentSkill", agentSkillSchema);

export { agentSkillSchema, AgentSkillModel };
