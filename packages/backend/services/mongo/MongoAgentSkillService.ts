/**
 * MongoAgentSkillService — Wraps the existing AgentSkill Mongoose model
 * behind the IAgentSkillService interface.
 */

import type { IAgentSkillService } from "../contracts/index.js";
import type { AgentSkillAssignment } from "../types/index.js";

export class MongoAgentSkillService implements IAgentSkillService {
  private getModel() {
    return import("./schemas/AgentSkillSchema.js").then((m) => m.AgentSkillModel);
  }

  async assignSkillToAgent(agentId: string, skillId: string): Promise<AgentSkillAssignment> {
    const AgentSkillModel = await this.getModel();
    const doc = await AgentSkillModel.findOneAndUpdate(
      { agentId, skillId },
      { agentId, skillId, assignedAt: new Date() },
      { upsert: true, new: true },
    ).lean();
    return this.toAssignment(doc);
  }

  async removeSkillFromAgent(agentId: string, skillId: string): Promise<boolean> {
    const AgentSkillModel = await this.getModel();
    const result = await AgentSkillModel.deleteOne({ agentId, skillId });
    return result.deletedCount > 0;
  }

  async getAgentSkills(agentId: string): Promise<AgentSkillAssignment[]> {
    const AgentSkillModel = await this.getModel();
    const docs = await AgentSkillModel.find({ agentId }).lean();
    return docs.map((d) => this.toAssignment(d));
  }

  async setSkillEnabled(agentId: string, skillId: string, enabled: boolean): Promise<void> {
    const AgentSkillModel = await this.getModel();
    await AgentSkillModel.updateOne({ agentId, skillId }, { enabled });
  }

  private toAssignment(doc: any): AgentSkillAssignment {
    return {
      id: doc._id?.toString() ?? "",
      agentId: doc.agentId,
      skillId: doc.skillId,
      enabled: doc.enabled ?? true,
      assignedAt: doc.assignedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
