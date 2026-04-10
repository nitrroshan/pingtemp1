import type { Team } from "../types/index.js";

export interface ITeamService {
  createTeam(params: Omit<Team, "id" | "createdAt" | "updatedAt">): Promise<Team>;
  getTeam(teamId: string): Promise<Team | null>;
  listTeams(): Promise<Team[]>;
  updateTeam(teamId: string, updates: Partial<Team>): Promise<Team | null>;
  deleteTeam(teamId: string): Promise<void>;
}
