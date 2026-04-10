/**
 * MongoSkillService — Wraps the existing Skill Mongoose model
 * behind the ISkillService interface.
 */

import type { ISkillService } from "../contracts/index.js";
import type { Skill } from "../types/index.js";

export class MongoSkillService implements ISkillService {
  private getModel() {
    return import("./schemas/SkillSchema.js").then((m) => m.SkillModel);
  }

  async createSkill(data: Omit<Skill, "id" | "createdAt" | "updatedAt" | "installCount" | "rating"> & { installCount?: number; rating?: number }): Promise<Skill> {
    const SkillModel = await this.getModel();
    const doc = await SkillModel.create(data);
    return this.toSkill(doc);
  }

  async getSkill(skillId: string): Promise<Skill | null> {
    const SkillModel = await this.getModel();
    const doc = await SkillModel.findOne({ skillId }).lean();
    return doc ? this.toSkill(doc) : null;
  }

  async getAllSkills(options?: { tags?: string[]; source?: string; limit?: number; offset?: number }): Promise<Skill[]> {
    const SkillModel = await this.getModel();
    const query: Record<string, unknown> = {};
    if (options?.tags?.length) query.tags = { $in: options.tags };
    if (options?.source) query.source = options.source;

    const docs = await SkillModel.find(query)
      .skip(options?.offset ?? 0)
      .limit(options?.limit ?? 100)
      .lean();
    return docs.map((d) => this.toSkill(d));
  }

  async updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill | null> {
    const SkillModel = await this.getModel();
    const doc = await SkillModel.findOneAndUpdate({ skillId }, updates, { new: true }).lean();
    return doc ? this.toSkill(doc) : null;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const SkillModel = await this.getModel();
    const result = await SkillModel.deleteOne({ skillId });
    return result.deletedCount > 0;
  }

  async incrementInstallCount(skillId: string): Promise<void> {
    const SkillModel = await this.getModel();
    await SkillModel.updateOne({ skillId }, { $inc: { installCount: 1 } });
  }

  private toSkill(doc: any): Skill {
    return {
      id: doc._id?.toString() ?? doc.skillId,
      skillId: doc.skillId,
      name: doc.name,
      description: doc.description,
      version: doc.version,
      skillPath: doc.skillPath,
      skillMdPath: doc.skillMdPath,
      supportingFiles: doc.supportingFiles,
      author: doc.author,
      source: doc.source,
      sourceUrl: doc.sourceUrl,
      installCount: doc.installCount ?? 0,
      rating: doc.rating ?? 0,
      tags: doc.tags ?? [],
      createdAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
