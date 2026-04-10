import type { Skill } from "../types/index.js";

export interface ISkillService {
  createSkill(data: Omit<Skill, "id" | "createdAt" | "updatedAt" | "installCount" | "rating"> & { installCount?: number; rating?: number }): Promise<Skill>;
  getSkill(skillId: string): Promise<Skill | null>;
  getAllSkills(options?: { tags?: string[]; source?: string; limit?: number; offset?: number }): Promise<Skill[]>;
  updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill | null>;
  deleteSkill(skillId: string): Promise<boolean>;
  incrementInstallCount(skillId: string): Promise<void>;
}
