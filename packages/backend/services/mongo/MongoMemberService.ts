/**
 * MongoMemberService — Wraps the existing TeamMember Mongoose model
 * behind the IMemberService interface.
 */

import type { IMemberService } from "../contracts/index.js";
import type { TeamMember } from "../types/index.js";

export class MongoMemberService implements IMemberService {
  private getModel() {
    return import("./schemas/TeamMemberSchema.js").then((m) => m.TeamMemberModel);
  }

  async addMember(teamId: string, userId: string, role: "manager" | "employee"): Promise<TeamMember> {
    const TeamMemberModel = await this.getModel();
    const doc = await TeamMemberModel.create({ teamId, userId, role });
    return this.toMember(doc);
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const TeamMemberModel = await this.getModel();
    await TeamMemberModel.deleteOne({ teamId, userId });
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const TeamMemberModel = await this.getModel();
    const docs = await TeamMemberModel.find({ teamId }).lean();
    return docs.map((d) => this.toMember(d));
  }

  private toMember(doc: any): TeamMember {
    return {
      id: doc._id.toString(),
      teamId: doc.teamId?.toString() ?? "",
      userId: doc.userId,
      role: doc.role,
      joinedAt: doc.joinedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
