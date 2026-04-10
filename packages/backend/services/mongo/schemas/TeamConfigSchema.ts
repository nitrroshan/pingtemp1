/**
 * TeamConfig schema — lightweight team record for orchestration.
 *
 * Uses collection "teamconfigs". Stores team name, goal, and agent member refs.
 * This is the schema used by AgentManagerRegistry for team loading.
 */

import mongoose from "mongoose";

export interface ITeamConfig {
  teamName: string;
  goal: string;
  description?: string;
  members: mongoose.Types.ObjectId[];
}

const teamConfigSchema = new mongoose.Schema<ITeamConfig>(
  {
    teamName: { type: String, required: true, index: true },
    goal: { type: String, required: true },
    description: { type: String, required: false },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "AgentRole" }],
  },
  { timestamps: true, versionKey: false },
);

export const TeamConfigModel =
  (mongoose.models.TeamConfig as mongoose.Model<ITeamConfig>) ||
  mongoose.model<ITeamConfig>("TeamConfig", teamConfigSchema);
