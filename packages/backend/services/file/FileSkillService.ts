import { Low } from "lowdb";
import { randomUUID } from "crypto";
import type { ISkillService } from "../contracts/index.js";
import type { Skill } from "../types/index.js";
import { createDb, now } from "./lowdb-helpers.js";

interface SkillsData { skills: Skill[] }

export class FileSkillService implements ISkillService {
  private db!: Low<SkillsData>;
  constructor(private filePath: string) {}

  async init() { this.db = await createDb<SkillsData>(this.filePath, { skills: [] }); }

  async createSkill(data: Omit<Skill, "id" | "createdAt" | "updatedAt" | "installCount" | "rating"> & { installCount?: number; rating?: number }): Promise<Skill> {
    const skill: Skill = {
      ...data, id: randomUUID(),
      installCount: data.installCount ?? 0, rating: data.rating ?? 0,
      createdAt: now(), updatedAt: now(),
    };
    this.db.data.skills.push(skill);
    await this.db.write();
    return skill;
  }

  async getSkill(skillId: string): Promise<Skill | null> {
    return this.db.data.skills.find(s => s.skillId === skillId) ?? null;
  }

  async getAllSkills(options?: { tags?: string[]; source?: string; limit?: number; offset?: number }): Promise<Skill[]> {
    let skills = this.db.data.skills;
    if (options?.tags?.length) skills = skills.filter(s => s.tags.some(t => options.tags!.includes(t)));
    if (options?.source) skills = skills.filter(s => s.source === options.source);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? skills.length;
    return skills.slice(offset, offset + limit);
  }

  async updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill | null> {
    const idx = this.db.data.skills.findIndex(s => s.skillId === skillId);
    if (idx === -1) return null;
    const skill = { ...this.db.data.skills[idx], ...updates, updatedAt: now() };
    this.db.data.skills[idx] = skill;
    await this.db.write();
    return skill;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const before = this.db.data.skills.length;
    this.db.data.skills = this.db.data.skills.filter(s => s.skillId !== skillId);
    if (this.db.data.skills.length < before) { await this.db.write(); return true; }
    return false;
  }

  async incrementInstallCount(skillId: string): Promise<void> {
    const skill = this.db.data.skills.find(s => s.skillId === skillId);
    if (skill) { skill.installCount++; skill.updatedAt = now(); await this.db.write(); }
  }
}
