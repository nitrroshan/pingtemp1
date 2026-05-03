/**
 * Collab routes — CRDT document listing and deletion.
 */

import { Router } from "express";
import { rootLogger } from "../../logging/index.js";
import { safeError } from "./shared.js";

const logger = rootLogger.child({ module: "CollabRoutes" });

export function createCollabRoutes(): Router {
  const router = Router();

  // List CRDT docs for a team
  router.get("/collab/:teamId/docs", async (req, res) => {
    try {
      const { agentManagerRegistry } =
        await import("../../agentManager/AgentManagerRegistry.js");
      const manager = await agentManagerRegistry.getForTeam(req.params.teamId);
      const registry = manager.getPluginRegistry();
      const collabStorage = registry?.getPluginStorage?.("collaboration");
      const l2 = collabStorage?.crdt;
      if (!l2) {
        res.json({ docs: [] });
        return;
      }
      const collabServer =
        (l2 as any).collabServer || (l2 as any)._collabServer;
      if (!collabServer?.getDocNames) {
        res.json({ docs: [] });
        return;
      }
      const allDocs: string[] = await collabServer.getDocNames();
      const teamPrefix = req.params.teamId + "/";
      const docs = allDocs
        .filter((d: string) => d.startsWith(teamPrefix))
        .map((d: string) => d.slice(teamPrefix.length));
      res.json({ docs });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // Delete a collab document
  router.delete("/collab/:teamId/docs/:docName", async (req, res) => {
    try {
      const { teamId, docName } = req.params;
      const fullDocName = `${teamId}/${docName}`;

      const fs = await import("fs/promises");
      const path = await import("path");
      const storageDir = process.env.WORKSPACE_BASE_DIR
        ? `${process.env.WORKSPACE_BASE_DIR}/${teamId}/.ping/collab`
        : `./data/workspaces/${teamId}/.ping/collab`;
      const binPath = path.join(storageDir, "yjs", `${fullDocName.replace(/\//g, "_")}.bin`);

      try { await fs.unlink(binPath); } catch { /* file may not exist */ }

      const { agentManagerRegistry } =
        await import("../../agentManager/AgentManagerRegistry.js");
      if (agentManagerRegistry.has(teamId)) {
        const manager = await agentManagerRegistry.getForTeam(teamId);
        const registry = manager.getPluginRegistry();
        const collabStorage = registry?.getPluginStorage?.("collaboration");
        const server = (collabStorage?.crdt as any)?.collabServer || (collabStorage?.crdt as any)?._collabServer;
        // Hocuspocus doesn't expose a direct "delete doc" — closing connections is enough
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  logger.info("[CollabRoutes] Mounted: docs list, docs delete");
  return router;
}
