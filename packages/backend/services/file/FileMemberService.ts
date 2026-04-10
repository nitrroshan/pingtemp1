import { Low } from "lowdb";
import { randomUUID } from "crypto";
import type { IMemberService } from "../contracts/index.js";
import type { TeamMember } from "../types/index.js";
import { createDb, now } from "./lowdb-helpers.js";

interface MembersData { members: TeamMember[] }

export class FileMemberService implements IMemberService {
  private db!: Low<MembersData>;
  constructor(private filePath: string) {}

  async init() { this.db = await createDb<MembersData>(this.filePath, { members: [] }); }

  async addMember(teamId: string, userId: string, role: "manager" | "employee"): Promise<TeamMember> {
    const existing = this.db.data.members.find(m => m.teamId === teamId && m.userId === userId);
    if (existing) return existing;
    const member: TeamMember = { id: randomUUID(), teamId, userId, role, joinedAt: now() };
    this.db.data.members.push(member);
    await this.db.write();
    return member;
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    this.db.data.members = this.db.data.members.filter(m => !(m.teamId === teamId && m.userId === userId));
    await this.db.write();
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    return this.db.data.members.filter(m => m.teamId === teamId);
  }
}
