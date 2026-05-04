/**
 * Chat routes — message history, goal history, chat-agent snapshots.
 */

import { Router } from "express";
import { rootLogger } from "../../logging/index.js";
import { safeError } from "./shared.js";
import type { ServiceRegistry } from "../../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "ChatRoutes" });

export function createChatRoutes(services?: ServiceRegistry): Router {
  const router = Router();

  // Chat message history (team-wide)
  router.get("/teams/:teamId/messages", async (req, res) => {
    try {
      const { teamId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const before = req.query.before as string | undefined;

      if (services) {
        const messages = await services.chat.getMessages(teamId, { limit, before });
        res.json({ messages });
      } else {
        res.json({ messages: [] });
      }
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // Per-agent chat history
  router.get("/teams/:teamId/agents/:agentId/messages", async (req, res) => {
    try {
      const { teamId, agentId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      if (services) {
        const messages = await services.chat.getAgentMessages(teamId, agentId, { limit });
        res.json({ messages });
      } else {
        res.json({ messages: [] });
      }
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // Goal history
  router.get("/teams/:teamId/goals", async (req, res) => {
    try {
      const { teamId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      if (services) {
        const goals = await services.goals.getGoals(teamId, { limit });
        res.json({ goals });
      } else {
        res.json({ goals: [] });
      }
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // Chat Agent — role tasks snapshot
  router.get("/teams/:teamId/roles/:role/tasks", async (req, res) => {
    try {
      const { teamId, role } = req.params;
      const { agentManagerRegistry } =
        await import("../../agentManager/AgentManagerRegistry.js");
      if (!agentManagerRegistry.has(teamId)) {
        res.json({ tasks: [], role, enabled: false });
        return;
      }
      const manager = await agentManagerRegistry.getForTeam(teamId);
      const snapshot = manager.getChatAgentSnapshot(role);
      if (!snapshot) {
        res.json({ tasks: [], role, enabled: false });
        return;
      }
      res.json({ ...snapshot, enabled: true });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  logger.info("[ChatRoutes] Mounted: messages, goals, chat-agent tasks");
  return router;
}
