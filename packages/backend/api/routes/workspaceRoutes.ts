/**
 * Workspace routes — git push with SSRF protection.
 */

import { Router } from "express";
import { rootLogger } from "../../logging/index.js";
import { safeError } from "./shared.js";
import type { ServiceRegistry } from "../../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "WorkspaceRoutes" });

export function createWorkspaceRoutes(services?: ServiceRegistry): Router {
  const router = Router();

  // Workspace git push
  router.post("/workspaces/:teamId/push", async (req, res) => {
    try {
      const { teamId } = req.params;

      let remoteUrl = req.body.remoteUrl;
      let remoteToken = req.body.remoteToken;

      // SSRF protection — reject private/internal URLs
      if (remoteUrl) {
        try {
          const parsed = new URL(remoteUrl);
          const hostname = parsed.hostname.toLowerCase();
          const blockedPatterns = [
            /^localhost$/i,
            /^127\./,
            /^10\./,
            /^172\.(1[6-9]|2\d|3[01])\./,
            /^192\.168\./,
            /^169\.254\./,
            /^0\./,
            /^\[::1\]$/,
            /^metadata\.google/i,
          ];
          if (blockedPatterns.some(p => p.test(hostname))) {
            res.status(400).json({ error: "Internal/private URLs are not allowed" });
            return;
          }
          if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
            res.status(400).json({ error: "Only HTTPS and SSH git URLs are allowed" });
            return;
          }
        } catch {
          res.status(400).json({ error: "Invalid remote URL" });
          return;
        }
      }

      if (services) {
        const team = await services.teams.getTeam(teamId);
        if (!team) { res.status(404).json({ error: "Team not found" }); return; }
      }

      if (!remoteUrl) { res.status(400).json({ error: "No git remote URL configured" }); return; }

      const authUrl = remoteToken
        ? remoteUrl.replace("https://", `https://oauth2:${remoteToken}@`)
        : remoteUrl;

      const { agentManagerRegistry } =
        await import("../../agentManager/AgentManagerRegistry.js");
      const manager = await agentManagerRegistry.getForTeam(teamId);
      const registry = manager.getPluginRegistry();
      const wsStorage = registry?.getPluginStorage?.("workspace");
      const gitManager = (wsStorage as any)?.gitManager;

      if (!gitManager?.addRemote) {
        res.status(500).json({ error: "Workspace not initialized" });
        return;
      }

      await gitManager.addRemote("origin", authUrl);
      await gitManager.push("origin");
      res.json({ success: true, message: "Pushed to remote" });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  logger.info("[WorkspaceRoutes] Mounted: workspaces push");
  return router;
}
