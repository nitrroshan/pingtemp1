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

  // ── Document Pane: List workspace files for a goal ────────────────────
  router.get("/workspaces/:teamId/goals/:goalId/files", async (req, res) => {
    try {
      const { teamId, goalId } = req.params;
      const { agentManagerRegistry } =
        await import("../../agentManager/AgentManagerRegistry.js");
      const manager = await agentManagerRegistry.getForTeam(teamId);
      const registry = manager.getPluginRegistry();
      const wsStorage = registry?.getPluginStorage?.("workspace");
      const wsManager = (wsStorage as any)?.manager;

      if (!wsManager) {
        res.json({ files: [] });
        return;
      }

      // Try to find a workspace for any task in this goal, or fall back to repo root
      const taskStore = manager.getTaskStore?.();
      const goalTasks = taskStore?.getByGoal?.(goalId) ?? taskStore?.getAll?.() ?? [];
      let files: any[] = [];

      for (const task of goalTasks) {
        const ws = wsManager.getWorkspace?.(task.id);
        if (ws?.listFiles) {
          try {
            const taskFiles = await ws.listFiles();
            files.push(...taskFiles.map((f: any) => ({
              ...f,
              taskId: task.id,
              taskTitle: task.title || task.description?.slice(0, 60),
            })));
          } catch { /* workspace may not exist yet */ }
        }
      }

      res.json({ files });
    } catch (err: any) {
      logger.error("[WorkspaceRoutes] listFiles error:", err);
      res.status(500).json({ error: safeError(err) });
    }
  });

  // ── Document Pane: Read a workspace file ──────────────────────────────
  router.get("/workspaces/:teamId/goals/:goalId/file/:filePath", async (req, res) => {
    try {
      const { teamId, goalId, filePath } = req.params;

      // Path traversal protection
      if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }

      // Extract taskId from query (files are task-scoped)
      const taskId = req.query.taskId as string;
      if (!taskId) {
        res.status(400).json({ error: "taskId query param required" });
        return;
      }

      const { agentManagerRegistry } =
        await import("../../agentManager/AgentManagerRegistry.js");
      const manager = await agentManagerRegistry.getForTeam(teamId);
      const registry = manager.getPluginRegistry();
      const wsStorage = registry?.getPluginStorage?.("workspace");
      const wsManager = (wsStorage as any)?.manager;
      const ws = wsManager?.getWorkspace?.(taskId);

      if (!ws?.readFile) {
        res.status(404).json({ error: "Workspace not found for task" });
        return;
      }

      const content = await ws.readFile(filePath);
      res.json({ content, path: filePath, taskId });
    } catch (err: any) {
      logger.error("[WorkspaceRoutes] readFile error:", err);
      res.status(err.message?.includes("not found") ? 404 : 500).json({ error: safeError(err) });
    }
  });

  logger.info("[WorkspaceRoutes] Mounted: workspaces files (Document Pane)");
  return router;
}
