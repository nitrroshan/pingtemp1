/**
 * SqliteTeamRegistryService — tracks team ownership in SQLite.
 *
 * Teams are loaded from plugins (PluginTeamService), but ownership
 * is tracked here so we know which user created/owns each team.
 */

import { Database } from "bun:sqlite";
import type { ITeamRegistryService, TeamRegistration } from "../contracts/ITeamRegistryService.js";

export class SqliteTeamRegistryService implements ITeamRegistryService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_registry (
        team_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        plugin_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_registry_owner ON team_registry(owner_id);
    `);
  }

  async register(teamId: string, ownerId: string, pluginName: string): Promise<TeamRegistration> {
    const now = new Date().toISOString();
    // Upsert — if team already registered, update owner
    this.db.run(
      `INSERT INTO team_registry (team_id, owner_id, plugin_name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET owner_id = excluded.owner_id`,
      [teamId, ownerId, pluginName, now],
    );
    return { teamId, ownerId, pluginName, createdAt: now };
  }

  async getOwner(teamId: string): Promise<string | null> {
    const row = this.db.query(
      `SELECT owner_id FROM team_registry WHERE team_id = ?`,
    ).get(teamId) as { owner_id: string } | null;
    return row?.owner_id ?? null;
  }

  async canAccess(userId: string, teamId: string): Promise<boolean> {
    // V1: owner = only member. V2: add members table.
    const owner = await this.getOwner(teamId);
    // If team not registered yet, allow access (backward compat for existing teams)
    if (owner === null) return true;
    return owner === userId;
  }

  async getTeamsForUser(userId: string): Promise<string[]> {
    const rows = this.db.query(
      `SELECT team_id FROM team_registry WHERE owner_id = ?`,
    ).all(userId) as Array<{ team_id: string }>;
    return rows.map(r => r.team_id);
  }
}
