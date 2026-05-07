/**
 * PgOrgService — PostgreSQL implementation for organization CRUD.
 *
 * Responsibilities: create/read/update/delete organizations + member management.
 * Does NOT handle team ownership or access control (that's PgTeamService).
 */

import { eq, and, sql } from "drizzle-orm";
import type { IOrgService, OrgSummary, OrgDetail, OrgMember } from "../contracts/IOrgService.js";
import { getDb } from "../../db/connection.js";
import { organizations, orgMembers } from "../../db/schema.js";

export class PgOrgService implements IOrgService {
  private get db() {
    return getDb();
  }

  async create(name: string, ownerId: string, plan = "free"): Promise<OrgSummary> {
    const rows = await this.db.insert(organizations).values({
      name,
      plan,
    }).returning();

    const org = rows[0];
    if (!org) throw new Error("Failed to create organization");

    await this.db.insert(orgMembers).values({
      orgId: org.id,
      userId: ownerId,
      role: "owner",
    });

    return {
      id: org.id,
      name: org.name,
      plan: org.plan ?? "free",
      createdAt: org.createdAt?.toISOString() ?? new Date().toISOString(),
      memberCount: 1,
      role: "owner",
    };
  }

  async listForUser(userId: string): Promise<OrgSummary[]> {
    const rows = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
        createdAt: organizations.createdAt,
        role: orgMembers.role,
      })
      .from(organizations)
      .innerJoin(orgMembers, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId));

    // Get member counts in a single query
    const orgIds = rows.map((r) => r.id);
    if (orgIds.length === 0) return [];

    const counts = await this.db
      .select({
        orgId: orgMembers.orgId,
        count: sql<number>`count(*)::int`,
      })
      .from(orgMembers)
      .where(sql`${orgMembers.orgId} = ANY(${orgIds})`)
      .groupBy(orgMembers.orgId);

    const countMap = new Map(counts.map((c) => [c.orgId, c.count]));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      plan: r.plan ?? "free",
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
      memberCount: countMap.get(r.id) ?? 1,
      role: r.role,
    }));
  }

  async getById(orgId: string, callerId: string): Promise<OrgDetail | null> {
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return null;

    const members = await this.db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId));

    const callerMember = members.find((m) => m.userId === callerId);

    return {
      id: org.id,
      name: org.name,
      plan: org.plan ?? "free",
      createdAt: org.createdAt?.toISOString() ?? new Date().toISOString(),
      memberCount: members.length,
      role: callerMember?.role ?? "none",
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt?.toISOString() ?? new Date().toISOString(),
      })),
    };
  }

  async update(orgId: string, fields: { name?: string; plan?: string }, callerId?: string): Promise<OrgSummary | null> {
    const updateFields: Record<string, string> = {};
    if (fields.name !== undefined) updateFields.name = fields.name;
    if (fields.plan !== undefined) updateFields.plan = fields.plan;
    if (Object.keys(updateFields).length === 0) return null;

    const [updated] = await this.db
      .update(organizations)
      .set(updateFields)
      .where(eq(organizations.id, orgId))
      .returning();

    if (!updated) return null;

    const memberCount = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId));

    const callerRole = callerId ? await this.getUserRole(orgId, callerId) : null;

    return {
      id: updated.id,
      name: updated.name,
      plan: updated.plan ?? "free",
      createdAt: updated.createdAt?.toISOString() ?? new Date().toISOString(),
      memberCount: memberCount[0]?.count ?? 0,
      role: callerRole ?? "owner",
    };
  }

  async delete(orgId: string): Promise<boolean> {
    const result = await this.db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .returning({ id: organizations.id });

    return result.length > 0;
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

  async updateMemberRole(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
    await this.db
      .update(orgMembers)
      .set({ role })
      .where(and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.userId, userId),
      ));
  }

  async getUserRole(orgId: string, userId: string): Promise<string | null> {
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
}
