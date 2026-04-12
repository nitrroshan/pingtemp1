/**
 * MongoAgentService — Wraps the existing Agent Mongoose model
 * behind the IAgentService interface.
 */

import type { IAgentService } from "../contracts/index.js";
import type { Agent } from "../types/index.js";

export class MongoAgentService implements IAgentService {
  private getModel() {
    return import("./schemas/AgentRoleSchema.js").then((m) => m.AgentRoleModel);
  }


  //Need Review - Do we have all required fields in the config or do we need to add more fields in the config and also in the schema or do we need to delete some fields from the schema which are not required in the config? [Roshan] [Do Not Remove this comment until the fixed]
  async addAgent(teamId: string, config: Omit<Agent, "id" | "createdAt" | "updatedAt">): Promise<Agent> {
    const AgentModel = await this.getModel();
    const doc = await AgentModel.create({
      teamId,
      name: config.name,
      role: config.role,
      goal: (config as any).goal ?? "",
      systemPrompt: (config as any).systemPrompt ?? "",
      tools: (config as any).tools ?? [],
      mcpClientConfigs: (config as any).mcpClientConfigs ?? {},
    });
    return this.toAgent(doc);
  }

  async getTeamAgents(teamId: string): Promise<Agent[]> {
    const AgentModel = await this.getModel();
    const docs = await AgentModel.find({ teamId }).lean();
    return docs.map((d) => this.toAgent(d));
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    const AgentModel = await this.getModel();
    const doc = await AgentModel.findById(agentId).lean();
    return doc ? this.toAgent(doc) : null;
  }

  async removeAgent(teamId: string, agentId: string): Promise<void> {
    const AgentModel = await this.getModel();
    await AgentModel.findByIdAndDelete(agentId);
  }

  async updateAgentStatus(agentId: string, update: Partial<Pick<Agent, "status" | "errorMessage" | "lastStartedAt" | "isActive">>): Promise<Agent | null> {
    const AgentModel = await this.getModel();
    const doc = await AgentModel.findByIdAndUpdate(agentId, update, { new: true }).lean();
    return doc ? this.toAgent(doc) : null;
  }

  private toAgent(doc: any): Agent {
    return {
      id: doc._id.toString(),
      teamId: doc.teamId?.toString() ?? "",
      role: doc.role ?? "",
      type: doc.type ?? "worker",
      name: doc.name ?? "",
      ownedBy: doc.ownedBy ?? "default",
      delegatedTo: doc.delegatedTo ?? null,
      definitionYaml: doc.definitionYaml ?? "",
      status: doc.status ?? "pending",
      lastStartedAt: doc.lastStartedAt?.toISOString?.() ?? null,
      errorMessage: doc.errorMessage ?? null,
      isActive: doc.isActive ?? true,
      createdAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      systemPrompt: doc.systemPrompt ?? undefined,
      goal: doc.goal ?? undefined,
    };
  }
}
