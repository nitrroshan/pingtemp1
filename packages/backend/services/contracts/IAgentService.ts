import type { Agent } from "../types/index.js";

export interface IAgentService {
  addAgent(teamId: string, config: Omit<Agent, "id" | "createdAt" | "updatedAt">): Promise<Agent>;
  getTeamAgents(teamId: string): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent | null>;
  removeAgent(teamId: string, agentId: string): Promise<void>;
  updateAgentStatus(agentId: string, update: Partial<Pick<Agent, "status" | "errorMessage" | "lastStartedAt" | "isActive">>): Promise<Agent | null>;
}
