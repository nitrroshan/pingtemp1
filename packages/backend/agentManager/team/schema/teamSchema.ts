import mongoose from "mongoose";
import type { TeamConfig } from "../../types/index.js";

// Define team config schema (for AgentManager orchestration)
const teamConfigSchema = new mongoose.Schema<TeamConfig>(
  {
    teamName: { type: String, required: true, index: true },
    goal: { type: String, required: true },
    description: { type: String, required: false },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Create the model - use "TeamConfig" to avoid collision with TeamService's "Team" model
const TeamConfigModel =
  (mongoose.models.TeamConfig as mongoose.Model<TeamConfig>) ||
  mongoose.model<TeamConfig>("TeamConfig", teamConfigSchema);

export { teamConfigSchema, TeamConfigModel };
// Backward compatibility alias
export { TeamConfigModel as TeamModel };
