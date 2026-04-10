import { Low } from "lowdb";
import { randomUUID } from "crypto";
import type { IAgentService } from "../contracts/index.js";
import type { Agent } from "../types/index.js";
import { createDb, now } from "./lowdb-helpers.js";

interface AgentsData { agents: Agent[] }

export class FileAgentService implements IAgentService {
  private db!: Low<AgentsData>;
  constructor(private filePath: string) {}

  async init() { this.db = await createDb<AgentsData>(this.filePath, { agents: [] }); }

  async addAgent(teamId: string, config: Omit<Agent, "id" | "createdAt" | "updatedAt">): Promise<Agent> {
    const agent: Agent = { ...config, teamId, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.data.agents.push(agent);
    await this.db.write();
    return agent;
  }

  async getTeamAgents(teamId: string): Promise<Agent[]> {
    return this.db.data.agents.filter(a => a.teamId === teamId);
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return this.db.data.agents.find(a => a.id === agentId) ?? null;
  }

  async removeAgent(teamId: string, agentId: string): Promise<void> {
    this.db.data.agents = this.db.data.agents.filter(a => !(a.id === agentId && a.teamId === teamId));
    await this.db.write();
  }

  async updateAgentStatus(agentId: string, update: Partial<Pick<Agent, "status" | "errorMessage" | "lastStartedAt" | "isActive">>): Promise<Agent | null> {
    const idx = this.db.data.agents.findIndex(a => a.id === agentId);
    if (idx === -1) return null;
    const agent = { ...this.db.data.agents[idx], ...update, updatedAt: now() };
    this.db.data.agents[idx] = agent;
    await this.db.write();
    return agent;
  }
}
