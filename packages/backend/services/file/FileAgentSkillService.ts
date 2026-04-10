import { Low } from "lowdb";
import { randomUUID } from "crypto";
import type { IAgentSkillService } from "../contracts/index.js";
import type { AgentSkillAssignment } from "../types/index.js";
import { createDb, now } from "./lowdb-helpers.js";

interface AgentSkillsData { assignments: AgentSkillAssignment[] }

export class FileAgentSkillService implements IAgentSkillService {
  private db!: Low<AgentSkillsData>;
  constructor(private filePath: string) {}

  async init() { this.db = await createDb<AgentSkillsData>(this.filePath, { assignments: [] }); }

  async assignSkillToAgent(agentId: string, skillId: string): Promise<AgentSkillAssignment> {
    const existing = this.db.data.assignments.find(a => a.agentId === agentId && a.skillId === skillId);
    if (existing) return existing;
    const assignment: AgentSkillAssignment = { id: randomUUID(), agentId, skillId, enabled: true, assignedAt: now() };
    this.db.data.assignments.push(assignment);
    await this.db.write();
    return assignment;
  }

  async removeSkillFromAgent(agentId: string, skillId: string): Promise<boolean> {
    const before = this.db.data.assignments.length;
    this.db.data.assignments = this.db.data.assignments.filter(a => !(a.agentId === agentId && a.skillId === skillId));
    if (this.db.data.assignments.length < before) { await this.db.write(); return true; }
    return false;
  }

  async getAgentSkills(agentId: string): Promise<AgentSkillAssignment[]> {
    return this.db.data.assignments.filter(a => a.agentId === agentId);
  }

  async setSkillEnabled(agentId: string, skillId: string, enabled: boolean): Promise<void> {
    const assignment = this.db.data.assignments.find(a => a.agentId === agentId && a.skillId === skillId);
    if (assignment) { assignment.enabled = enabled; await this.db.write(); }
  }
}
