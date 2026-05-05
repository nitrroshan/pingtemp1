/**
 * MongoTeamRegistryService — tracks team ownership in MongoDB.
 */

import mongoose, { Schema } from "mongoose";
import type { ITeamRegistryService, TeamRegistration } from "../contracts/ITeamRegistryService.js";

// Define schema once at module level (not per-call)
const teamRegistrySchema = new Schema({
  teamId: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true, index: true },
  pluginName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const getTeamRegistryModel = () =>
  (mongoose.models.TeamRegistry as mongoose.Model<any>) ||
  mongoose.model("TeamRegistry", teamRegistrySchema);

export class MongoTeamRegistryService implements ITeamRegistryService {

  async register(teamId: string, ownerId: string, pluginName: string): Promise<TeamRegistration> {
    const Model = getTeamRegistryModel();
    const now = new Date().toISOString();
    await Model.findOneAndUpdate(
      { teamId },
      { teamId, ownerId, pluginName, createdAt: now },
      { upsert: true },
    );
    return { teamId, ownerId, pluginName, createdAt: now };
  }

  async getOwner(teamId: string): Promise<string | null> {
    const Model = getTeamRegistryModel();
    const doc = await Model.findOne({ teamId }).lean();
    return (doc as any)?.ownerId ?? null;
  }

  async canAccess(userId: string, teamId: string): Promise<boolean> {
    const owner = await this.getOwner(teamId);
    if (owner === null) return true; // Not registered yet — backward compat
    return owner === userId;
  }

  async canMutate(userId: string, teamId: string): Promise<boolean> {
    // Mongo mode: owner-only for mutations (no role model)
    return this.canAccess(userId, teamId);
  }

  async getTeamsForUser(userId: string): Promise<string[]> {
    const Model = getTeamRegistryModel();
    const docs = await Model.find({ ownerId: userId }).lean();
    return (docs as any[]).map(d => d.teamId);
  }
}
