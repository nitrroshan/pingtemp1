/**
 * PgTeamService — PostgreSQL implementation for organization + team ownership.
 *
 * Design:
 *   - DB PKs are UUID (gen_random_uuid()) — never exposed to business logic
 *   - Business team_id (SHA-256 hash of pluginName) stored as unique-indexed column
 *   - All lookups go through team_id index, FKs use UUID internally
 */

import { eq, and } from "drizzle-orm";
import type { ITeamRegistryService, TeamRegistration } from "../contracts/index.js";
import { getDb } from "../../db/connection.js";
import { organizations, orgMembers, agentTeams } from "../../db/schema.js";

export class PgTeamService implements ITeamRegistryService {
  private get db() {
    return getDb();
  }

  async register(teamId: string, ownerId: string, pluginName: string): Promise<TeamRegistration> {
    const now = new Date();

    // Create a personal org for the user (or find existing)
    const orgUuid = await this.getOrCreatePersonalOrg(ownerId);

    // Upsert — ON CONFLICT handles race conditions (two concurrent register calls)
    const [row] = await this.db.insert(agentTeams).values({
      teamId,
      orgId: orgUuid,
      name: pluginName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      pluginName,
      createdAt: now,
    }).onConflictDoNothing({
      target: [agentTeams.teamId],
    }).returning();

    // If insert was skipped (team existed), fetch the actual owner
    if (!row) {
      const existing = await this.db
        .select({ createdAt: agentTeams.createdAt })
        .from(agentTeams)
        .where(eq(agentTeams.teamId, teamId))
        .limit(1);

      const actualOwner = await this.getOwner(teamId);
      return {
        teamId,
        ownerId: actualOwner ?? ownerId,
        pluginName,
        createdAt: existing[0]?.createdAt?.toISOString() ?? now.toISOString(),
      };
    }

    return {
      teamId,
      ownerId,
      pluginName,
      createdAt: now.toISOString(),
    };
  }

  async getOwner(teamId: string): Promise<string | null> {
    const rows = await this.db
      .select({ userId: orgMembers.userId })
      .from(agentTeams)
      .innerJoin(orgMembers, and(
        eq(agentTeams.orgId, orgMembers.orgId),
        eq(orgMembers.role, "owner"),
      ))
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    return rows.length > 0 ? rows[0].userId : null;
  }

  async canAccess(userId: string, teamId: string): Promise<boolean> {
    if (!userId) return true;

    const team = await this.db
      .select({ orgId: agentTeams.orgId })
      .from(agentTeams)
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    // If team not in PG (built-in plugin not yet registered), allow access
    if (team.length === 0) return true;

    const member = await this.db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.orgId, team[0].orgId),
        eq(orgMembers.userId, userId),
      ))
      .limit(1);

    return member.length > 0;
  }

  /**
   * Check if a user can perform mutating actions (not a viewer).
   */
  async canMutate(userId: string, teamId: string): Promise<boolean> {
    if (!userId) return true;

    const role = await this.getUserRoleForTeam(userId, teamId);
    if (role === null) {
      // Team not in PG = built-in plugin = allow
      const team = await this.db
        .select({ id: agentTeams.id })
        .from(agentTeams)
        .where(eq(agentTeams.teamId, teamId))
        .limit(1);
      return team.length === 0;
    }
    return role !== "viewer";
  }

  async getTeamsForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ teamId: agentTeams.teamId })
      .from(agentTeams)
      .innerJoin(orgMembers, eq(agentTeams.orgId, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId));

    return rows.map((r) => r.teamId);
  }

  // ── Organization helpers ──

  private async getOrCreatePersonalOrg(userId: string): Promise<string> {
    const existing = await this.db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.role, "owner"),
      ))
      .limit(1);

    if (existing.length > 0) return existing[0].orgId;

    // Create personal org — DB generates UUID
    const [org] = await this.db.insert(organizations).values({
      name: "Personal",
      plan: "free",
    }).returning();

    await this.db.insert(orgMembers).values({
      orgId: org.id,
      userId,
      role: "owner",
    });

    return org.id;
  }

  // ── Extended methods ──

  async getUserRoleForTeam(userId: string, teamId: string): Promise<string | null> {
    const rows = await this.db
      .select({ role: orgMembers.role })
      .from(agentTeams)
      .innerJoin(orgMembers, and(
        eq(agentTeams.orgId, orgMembers.orgId),
        eq(orgMembers.userId, userId),
      ))
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    return rows.length > 0 ? rows[0].role : null;
  }

  async addMember(orgId: string, userId: string, role: "admin" | "member" | "viewer" = "member"): Promise<void> {
    await this.db.insert(orgMembers).values({
      orgId,
      userId,
      role,
    }).onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      set: { role },
    });
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.db
      .delete(orgMembers)
      .where(and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.userId, userId),
      ));
  }

  async getMembers(orgId: string): Promise<Array<{ userId: string; role: string; joinedAt: string }>> {
    const rows = await this.db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId));

    return rows.map((r) => ({
      userId: r.userId,
      role: r.role,
      joinedAt: r.joinedAt?.toISOString() ?? new Date().toISOString(),
    }));
  }
}
