import { Low } from "lowdb";
import { randomUUID } from "crypto";
import type { ITeamService } from "../contracts/index.js";
import type { Team } from "../types/index.js";
import { createDb, now } from "./lowdb-helpers.js";

interface TeamsData { teams: Team[] }

export class FileTeamService implements ITeamService {
  private db!: Low<TeamsData>;
  constructor(private filePath: string) {}

  async init() { this.db = await createDb<TeamsData>(this.filePath, { teams: [] }); }

  async createTeam(params: Omit<Team, "id" | "createdAt" | "updatedAt">): Promise<Team> {
    const team: Team = { ...params, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.data.teams.push(team);
    await this.db.write();
    return team;
  }

  async getTeam(teamId: string): Promise<Team | null> {
    return this.db.data.teams.find(t => t.id === teamId) ?? null;
  }

  async listTeams(): Promise<Team[]> { return this.db.data.teams; }

  async updateTeam(teamId: string, updates: Partial<Team>): Promise<Team | null> {
    const idx = this.db.data.teams.findIndex(t => t.id === teamId);
    if (idx === -1) return null;
    const existing = this.db.data.teams[idx]!;
    const team: Team = { ...existing, ...updates, updatedAt: now() };
    this.db.data.teams[idx] = team;
    await this.db.write();
    return team;
  }

  async deleteTeam(teamId: string): Promise<void> {
    this.db.data.teams = this.db.data.teams.filter(t => t.id !== teamId);
    await this.db.write();
  }
}
