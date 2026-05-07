/**
 * PgTeamService — PostgreSQL implementation for team ownership.
 *
 * Ownership model (GitHub-style):
 *   - Every agent team has a `created_by` user (direct ownership)
 *   - `org_id` is OPTIONAL — NULL = user-owned, set = org-owned
 *   - Users create orgs explicitly when they want shared teams
 *   - Access control: user-owned → check created_by; org-owned → check org_members
 *   - No phantom "Personal" org — user IS the owner
 */

import { eq, and, or, isNull } from "drizzle-orm";
import type { ITeamRegistryService, TeamRegistration } from "../contracts/index.js";
import { getDb } from "../../db/connection.js";
import { organizations, orgMembers, agentTeams } from "../../db/schema.js";

export class PgTeamService implements ITeamRegistryService {
  private get db() {
    return getDb();
  }

  async register(teamId: string, ownerId: string, pluginName: string): Promise<TeamRegistration> {
    const now = new Date();

    // Insert team with direct user ownership (no org needed)
    const [row] = await this.db.insert(agentTeams).values({
      teamId,
      createdBy: ownerId,
      name: pluginName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      pluginName,
      createdAt: now,
    }).onConflictDoNothing({
      target: [agentTeams.teamId],
    }).returning();

    // If insert was skipped (team existed), fetch and fix ownership if needed
    if (!row) {
      const existing = await this.db
        .select({ createdBy: agentTeams.createdBy, createdAt: agentTeams.createdAt })
        .from(agentTeams)
        .where(eq(agentTeams.teamId, teamId))
        .limit(1);

      const currentOwner = existing[0]?.createdBy;

      // Fix stale 'system' ownership from migration — assign to the real user
      if (currentOwner === "system" && ownerId !== "system") {
        await this.db
          .update(agentTeams)
          .set({ createdBy: ownerId })
          .where(eq(agentTeams.teamId, teamId));
      }

      return {
        teamId,
        ownerId: (currentOwner === "system" && ownerId !== "system") ? ownerId : (currentOwner ?? ownerId),
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
      .select({ createdBy: agentTeams.createdBy })
      .from(agentTeams)
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    const row = rows[0];
    return row ? row.createdBy : null;
  }

  /**
   * Two-path access check:
   *   - User-owned (org_id IS NULL): only created_by has access
   *   - Org-owned (org_id set): any org_member has access
   */
  async canAccess(userId: string, teamId: string): Promise<boolean> {
    if (!userId) return true;

    const team = await this.db
      .select({ orgId: agentTeams.orgId, createdBy: agentTeams.createdBy })
      .from(agentTeams)
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    // If team not in PG (built-in plugin not yet registered), allow access
    const t = team[0];
    if (!t) return true;

    // User-owned: only the creator has access
    if (!t.orgId) return t.createdBy === userId;

    // Org-owned: check org_members
    const member = await this.db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.orgId, t.orgId),
        eq(orgMembers.userId, userId),
      ))
      .limit(1);

    return member.length > 0;
  }

  /**
   * Two-path mutation check:
   *   - User-owned: only created_by can mutate
   *   - Org-owned: any org_member except viewer
   */
  async canMutate(userId: string, teamId: string): Promise<boolean> {
    if (!userId) return true;

    const team = await this.db
      .select({ orgId: agentTeams.orgId, createdBy: agentTeams.createdBy })
      .from(agentTeams)
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    // Team not in PG = built-in plugin = allow
    const t = team[0];
    if (!t) return true;

    // User-owned: only the creator can mutate
    if (!t.orgId) return t.createdBy === userId;

    // Org-owned: check role (viewers denied)
    const role = await this.getUserRoleInOrg(userId, t.orgId);
    if (role === null) return false;
    return role !== "viewer";
  }

  async getTeamsForUser(userId: string): Promise<string[]> {
    // Teams the user owns directly (org_id IS NULL, created_by = userId)
    const ownedRows = await this.db
      .select({ teamId: agentTeams.teamId })
      .from(agentTeams)
      .where(and(
        isNull(agentTeams.orgId),
        eq(agentTeams.createdBy, userId),
      ));

    // Teams under orgs the user belongs to
    const orgRows = await this.db
      .select({ teamId: agentTeams.teamId })
      .from(agentTeams)
      .innerJoin(orgMembers, eq(agentTeams.orgId, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId));

    // Deduplicate (shouldn't overlap, but safe)
    const all = new Set([
      ...ownedRows.map((r) => r.teamId),
      ...orgRows.map((r) => r.teamId),
    ]);
    return [...all];
  }

  // ── Organization management ──

  /**
   * Transfer a team to an organization.
   * Only the team creator or an org owner/admin can do this.
   */
  async transferToOrg(teamId: string, orgId: string): Promise<void> {
    await this.db
      .update(agentTeams)
      .set({ orgId })
      .where(eq(agentTeams.teamId, teamId));
  }

  /**
   * Remove a team from its organization (back to user-owned).
   */
  async removeFromOrg(teamId: string): Promise<void> {
    await this.db
      .update(agentTeams)
      .set({ orgId: null })
      .where(eq(agentTeams.teamId, teamId));
  }

  // ── Extended methods ──

  async getUserRoleForTeam(userId: string, teamId: string): Promise<string | null> {
    const team = await this.db
      .select({ orgId: agentTeams.orgId, createdBy: agentTeams.createdBy })
      .from(agentTeams)
      .where(eq(agentTeams.teamId, teamId))
      .limit(1);

    const t = team[0];
    if (!t) return null;

    // User-owned: creator is implicitly "owner"
    if (!t.orgId) return t.createdBy === userId ? "owner" : null;

    // Org-owned: check org_members
    return this.getUserRoleInOrg(userId, t.orgId);
  }

  private async getUserRoleInOrg(userId: string, orgId: string): Promise<string | null> {
    const rows = await this.db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.userId, userId),
      ))
      .limit(1);

    return rows[0]?.role ?? null;
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
