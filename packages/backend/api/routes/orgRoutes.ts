/**
 * orgRoutes — Organization CRUD + member management.
 *
 * All endpoints require authentication (global middleware on /api/v2).
 * Authorization: inline checks via IOrgService.getUserRole().
 * Only available in hybrid mode (PostgreSQL).
 */

import { Router } from "express";
import type { ServiceRegistry } from "../../services/ServiceRegistry.js";
import { safeError } from "./shared.js";
import { rootLogger } from "../../logging/index.js";

const logger = rootLogger.child({ module: "OrgRoutes" });

export function createOrgRoutes(services?: ServiceRegistry): Router {
  const router = Router();

  // Guard: org endpoints only work in hybrid mode
  const getOrgService = () => {
    if (!services?.orgs) return null;
    return services.orgs;
  };

  // ── POST /orgs — Create organization ──
  router.post("/orgs", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "name is required" });
      }

      const org = await orgService.create(name.trim(), userId);
      logger.info(`[OrgRoutes] Org created: ${org.id} by ${userId}`);
      res.status(201).json({ org });
    } catch (err) {
      logger.error(`[OrgRoutes] Failed to create org: ${safeError(err)}`);
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── GET /orgs — List user's organizations ──
  router.get("/orgs", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const orgs = await orgService.listForUser(userId);
      res.json({ orgs, count: orgs.length });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── GET /orgs/:id — Get organization detail + members ──
  router.get("/orgs/:id", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const orgId = req.params.id;

      const role = await orgService.getUserRole(orgId, userId);
      if (!role) return res.status(403).json({ error: "Not a member of this organization" });

      const org = await orgService.getById(orgId, userId);
      if (!org) return res.status(404).json({ error: "Organization not found" });

      res.json({ org });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── PATCH /orgs/:id — Update organization ──
  router.patch("/orgs/:id", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const orgId = req.params.id;

      const role = await orgService.getUserRole(orgId, userId);
      if (!role || (role !== "owner" && role !== "admin")) {
        return res.status(403).json({ error: "Only owner or admin can update organization" });
      }

      const { name, plan } = req.body;
      if (!name && !plan) {
        return res.status(400).json({ error: "Provide name or plan to update" });
      }

      const org = await orgService.update(orgId, { name, plan }, userId);
      if (!org) return res.status(404).json({ error: "Organization not found" });

      res.json({ org });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── DELETE /orgs/:id — Delete organization ──
  router.delete("/orgs/:id", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const orgId = req.params.id;

      const role = await orgService.getUserRole(orgId, userId);
      if (role !== "owner") {
        return res.status(403).json({ error: "Only the owner can delete an organization" });
      }

      const deleted = await orgService.delete(orgId);
      if (!deleted) return res.status(404).json({ error: "Organization not found" });

      logger.info(`[OrgRoutes] Org deleted: ${orgId} by ${userId}`);
      res.json({ deleted: true, orgId });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── POST /orgs/:id/members — Add member ──
  router.post("/orgs/:id/members", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const orgId = req.params.id;

      const callerRole = await orgService.getUserRole(orgId, userId);
      if (!callerRole || (callerRole !== "owner" && callerRole !== "admin")) {
        return res.status(403).json({ error: "Only owner or admin can add members" });
      }

      const { userId: targetUserId, role } = req.body;
      if (!targetUserId) return res.status(400).json({ error: "userId is required" });

      const validRoles = ["admin", "member", "viewer"];
      const memberRole = validRoles.includes(role) ? role : "member";

      // Prevent adding someone as owner (only one owner allowed)
      if (role === "owner") {
        return res.status(400).json({ error: "Cannot add a member as owner. Transfer ownership instead." });
      }

      await orgService.addMember(orgId, targetUserId, memberRole);
      logger.info(`[OrgRoutes] Member added to org ${orgId}: ${targetUserId} as ${memberRole}`);
      res.status(201).json({ success: true, orgId, userId: targetUserId, role: memberRole });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── PATCH /orgs/:id/members/:userId — Update member role ──
  router.patch("/orgs/:id/members/:userId", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const callerId = (req as any).userId;
      const orgId = req.params.id;
      const targetUserId = req.params.userId;

      const callerRole = await orgService.getUserRole(orgId, callerId);
      if (callerRole !== "owner") {
        return res.status(403).json({ error: "Only the owner can change member roles" });
      }

      const { role } = req.body;
      const validRoles = ["admin", "member", "viewer"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${validRoles.join(", ")}` });
      }

      // Can't change own role (owner)
      if (targetUserId === callerId) {
        return res.status(400).json({ error: "Cannot change your own role" });
      }

      await orgService.updateMemberRole(orgId, targetUserId, role);
      res.json({ success: true, orgId, userId: targetUserId, role });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── DELETE /orgs/:id/members/:userId — Remove member ──
  router.delete("/orgs/:id/members/:userId", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const callerId = (req as any).userId;
      const orgId = req.params.id;
      const targetUserId = req.params.userId;

      const callerRole = await orgService.getUserRole(orgId, callerId);
      if (!callerRole || (callerRole !== "owner" && callerRole !== "admin")) {
        return res.status(403).json({ error: "Only owner or admin can remove members" });
      }

      // Can't remove owner
      const targetRole = await orgService.getUserRole(orgId, targetUserId);
      if (targetRole === "owner") {
        return res.status(400).json({ error: "Cannot remove the owner. Transfer ownership first." });
      }

      // Admin can't remove other admins (only owner can)
      if (callerRole === "admin" && targetRole === "admin") {
        return res.status(403).json({ error: "Admins cannot remove other admins" });
      }

      await orgService.removeMember(orgId, targetUserId);
      logger.info(`[OrgRoutes] Member removed from org ${orgId}: ${targetUserId}`);
      res.json({ success: true, orgId, userId: targetUserId });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── POST /teams/:teamId/transfer — Transfer team to/from org ──
  router.post("/teams/:teamId/transfer", async (req, res) => {
    try {
      const orgService = getOrgService();
      if (!orgService) return res.status(501).json({ error: "Organizations require hybrid mode" });

      const userId = (req as any).userId;
      const teamId = req.params.teamId;
      const { orgId } = req.body; // null/undefined = remove from org (back to user-owned)

      // Authorization: team creator OR org owner/admin of the team's current org
      const teamOwner = await services!.teamRegistry.getOwner(teamId);
      const callerRole = await services!.teamRegistry.getUserRoleForTeam(userId, teamId);
      const isCreator = teamOwner === userId;
      const isOrgAdmin = callerRole === "owner" || callerRole === "admin";

      if (!isCreator && !isOrgAdmin) {
        return res.status(403).json({ error: "Only the team creator or an org owner/admin can transfer it" });
      }

      if (orgId) {
        // Transferring to org: caller must also be admin/owner in the TARGET org
        const orgRole = await orgService.getUserRole(orgId, userId);
        if (!orgRole || (orgRole !== "owner" && orgRole !== "admin")) {
          return res.status(403).json({ error: "Must be owner or admin of the target organization" });
        }

        await services!.teamRegistry.transferToOrg(teamId, orgId);
        logger.info(`[OrgRoutes] Team ${teamId} transferred to org ${orgId}`);
        res.json({ success: true, teamId, orgId });
      } else {
        // Removing from org: back to user-owned
        await services!.teamRegistry.removeFromOrg(teamId);
        logger.info(`[OrgRoutes] Team ${teamId} removed from org (user-owned)`);
        res.json({ success: true, teamId, orgId: null });
      }
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  return router;
}
