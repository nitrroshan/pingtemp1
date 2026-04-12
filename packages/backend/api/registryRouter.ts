/**
 * Registry Router — REST API for plugin discovery and management
 *
 * Endpoints:
 *   GET  /api/registry/suggest?goal=<text>&limit=5  — Vector search suggestions
 *   GET  /api/registry/plugins                       — List all loaded plugins
 *   GET  /api/registry/plugins/:name                 — Get a specific plugin's details
 */

import express, { type Request, type Response } from "express";
import type { DiscoveryService } from "@ping/registry/src/discovery/DiscoveryService";
import type { PluginLoader } from "@ping/registry/src/loader/PluginLoader";

export function createRegistryRouter(
  discoveryService: DiscoveryService,
  pluginLoader: PluginLoader,
): express.Router {
  const router = express.Router();

  /**
   * GET /suggest — Suggest plugins, agents, skills for a goal
   */
  router.get("/suggest", async (req: Request, res: Response) => {
    try {
      const goal = req.query.goal as string | undefined;
      if (!goal) {
        res.status(400).json({ error: "goal query parameter is required" });
        return;
      }

      const limit = parseInt(req.query.limit as string, 10) || 5;
      const suggestions = await discoveryService.suggest(goal, { limit });
      res.json(suggestions);
    } catch (error: any) {
      console.error("[Registry] Error in /suggest:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  /**
   * GET /plugins — List all available plugins (manifests only)
   */
  router.get("/plugins", async (_req: Request, res: Response) => {
    try {
      const manifests = await pluginLoader.getPluginManifests();
      res.json({ plugins: manifests, count: manifests.length });
    } catch (error: any) {
      console.error("[Registry] Error listing plugins:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  /**
   * GET /plugins/:name — Get full plugin details (agents + skills)
   */
  router.get("/plugins/:name", async (req: Request, res: Response) => {
    try {
      const pluginName = req.params.name as string;
      const plugin = await pluginLoader.loadPlugin(pluginName);

      res.json({
        manifest: plugin.manifest,
        agents: plugin.agents.map((a: any) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          description: a.description,
          skills: (a.config as any).skills ?? [],
        })),
        skills: plugin.skills.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          tags: s.tags,
        })),
        modes: plugin.modes,
      });
    } catch (error: any) {
      console.error(`[Registry] Error loading plugin ${req.params.name}:`, error);
      res.status(404).json({ error: error.message || String(error) });
    }
  });

  return router;
}
