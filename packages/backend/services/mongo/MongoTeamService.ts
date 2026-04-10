/**
 * MongoTeamService — Wraps the existing TeamConfig Mongoose model
 * behind the ITeamService interface.
 *
 * Maps between Mongoose `teamName` and service-layer `name`.
 */

import type { ITeamService } from "../contracts/index.js";
import type { Team } from "../types/index.js";
import { randomUUID } from "crypto";

export class MongoTeamService implements ITeamService {
  private getModel() {
    return import("./schemas/TeamConfigSchema.js").then((m) => m.TeamConfigModel);
  }

  async createTeam(params: Omit<Team, "id" | "createdAt" | "updatedAt">): Promise<Team> {
    const TeamModel = await this.getModel();
    const doc = await TeamModel.create({
      teamName: params.name,
      goal: params.description || "",
      description: params.description || "",
    });
    return this.toTeam(doc);
  }

  async getTeam(teamId: string): Promise<Team | null> {
    const TeamModel = await this.getModel();
    const doc = await TeamModel.findById(teamId).lean();
    return doc ? this.toTeam(doc) : null;
  }

  async listTeams(): Promise<Team[]> {
    const TeamModel = await this.getModel();
    const docs = await TeamModel.find().lean();
    return docs.map((d) => this.toTeam(d));
  }

  async updateTeam(teamId: string, updates: Partial<Team>): Promise<Team | null> {
    const TeamModel = await this.getModel();
    const mongoUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) mongoUpdates.teamName = updates.name;
    if (updates.description !== undefined) mongoUpdates.description = updates.description;

    const doc = await TeamModel.findByIdAndUpdate(teamId, mongoUpdates, { new: true }).lean();
    return doc ? this.toTeam(doc) : null;
  }

  async deleteTeam(teamId: string): Promise<void> {
    const TeamModel = await this.getModel();
    await TeamModel.findByIdAndDelete(teamId);
  }

  private toTeam(doc: any): Team {
    return {
      id: doc._id.toString(),
      name: doc.teamName ?? doc.name ?? "",
      description: doc.description ?? doc.goal ?? "",
      ownerId: "default",
      workspaceId: doc.workspaceId ?? randomUUID(),
      gitRemoteUrl: doc.gitRemoteUrl ?? null,
      gitRemoteToken: doc.gitRemoteToken ?? null,
      settings: doc.settings ?? { executionMode: "sequential", maxConcurrency: 1 },
      createdAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
