/**
 * HttpServer - Express HTTP server for REST API endpoints
 */

import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { rootLogger } from "../logging/index.js";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { createAgentManagerHandlerV2 } from "./agentManagerHandlerV2.js";
import { swaggerSpec } from "./swagger.js";
import { getAuthHandler } from "../auth/index.js";
import { FRONTEND_FLAG_KEYS } from "../config/featureFlags.js";
import { getConfig } from "../config/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "HttpServer" });

export interface HttpServerOptions {
  agentManager: AgentManager;
  services?: ServiceRegistry;
}

export class HttpServer {
  private app: express.Application;
  private server: any;

  constructor(options: HttpServerOptions) {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes(options);
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware() {
    this.app.use(cors({ origin: true, credentials: true }));
    // Skip express.json() for auth routes — better-auth's toNodeHandler() reads the raw body
    this.app.use((req, res, next) => {
      if (req.path.startsWith("/api/auth")) return next();
      express.json()(req, res, next);
    });
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(options: HttpServerOptions) {
    // Health check (unauthenticated)
    this.app.get("/health", (req, res) => {
      logger.info("[HttpServer] Health check requested");
      res.json({
        status: "ok",
        timestamp: Date.now(),
        service: "AgentManager API",
      });
    });

    // Extended health check — includes dependency status
    this.app.get("/api/v2/health", async (req, res) => {
      const checks: Record<string, string> = {};
      const config = (await import("../config/index.js")).getConfig();
      const isFileMode = !config.mongodbUri;

      // MongoDB (skip check in file mode)
      if (isFileMode) {
        checks.storage = "file";
      } else {
        try {
          const mongoose = (await import("mongoose")).default;
          checks.mongodb = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
        } catch {
          checks.mongodb = "error";
        }
      }

      // Data directory writable
      try {
        const fs = await import("fs/promises");
        const testFile = "./data/.health-check";
        await fs.writeFile(testFile, "ok");
        await fs.unlink(testFile);
        checks.dataDir = "writable";
      } catch {
        checks.dataDir = "not-writable";
      }

      const allOk = Object.values(checks).every(
        (v) => v === "connected" || v === "writable" || v === "file",
      );

      res.status(allOk ? 200 : 503).json({
        status: allOk ? "ok" : "degraded",
        timestamp: Date.now(),
        uptime: process.uptime(),
        checks,
      });
    });

    // Mount better-auth routes (lazy init - works with SQLite or MongoDB)
    this.app.all("/api/auth/*splat", async (req, res, next) => {
      const handler = await getAuthHandler();
      return handler(req, res, next);
    });
    logger.info("[HttpServer] Auth routes mounted at /api/auth/*");

    // Feature flags endpoint (frontend-safe subset)
    this.app.get("/api/v2/feature-flags", (req, res) => {
      const config = getConfig();
      const flags: Record<string, any> = {};
      for (const key of FRONTEND_FLAG_KEYS) {
        flags[key] = config.featureFlags[key];
      }
      res.json(flags);
    });
    logger.info("[HttpServer] Feature flags API mounted at /api/v2/feature-flags");

    // Mount V2 API routes (ServiceRegistry required)
    const v2Routes = options.services
      ? createAgentManagerHandlerV2(options.services)
      : createAgentManagerHandlerV2(undefined as any); // legacy — should not happen
    this.app.use("/api/v2", v2Routes);
    // Also mount at /api for backward compat
    this.app.use("/api", v2Routes);
    logger.info("[HttpServer] V2 API mounted at /api/v2 and /api");

    // Mount registry API routes (plugin discovery)
    this.mountRegistryRoutes();
    logger.info("[HttpServer] Registry API mounted at /api/registry");

    // Mount Swagger UI
    this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    this.app.get("/api-docs.json", (req, res) => {
      res.json(swaggerSpec);
    });
    logger.info("[HttpServer] Swagger UI available at /api-docs");

    // Collab docs listing endpoint — returns CRDT doc names for a team
    this.app.get("/api/collab/:teamId/docs", async (req, res) => {
      try {
        const { agentManagerRegistry } =
          await import("../agentManager/AgentManagerRegistry.js");
        const manager = await agentManagerRegistry.getForTeam(
          req.params.teamId,
        );
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
        // Filter by team prefix and strip it
        const teamPrefix = req.params.teamId + "/";
        const docs = allDocs
          .filter((d: string) => d.startsWith(teamPrefix))
          .map((d: string) => d.slice(teamPrefix.length));
        res.json({ docs });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info(
      "[HttpServer] Collab docs API mounted at /api/collab/:teamId/docs",
    );

    // Delete a collab document
    this.app.delete("/api/collab/:teamId/docs/:docName", async (req, res) => {
      try {
        const { teamId, docName } = req.params;
        const fullDocName = `${teamId}/${docName}`;

        // Delete the persisted .bin file
        const fs = await import("fs/promises");
        const path = await import("path");
        const storageDir = process.env.WORKSPACE_BASE_DIR
          ? `${process.env.WORKSPACE_BASE_DIR}/${teamId}/.ping/collab`
          : `./data/workspaces/${teamId}/.ping/collab`;
        const binPath = path.join(storageDir, "yjs", `${fullDocName.replace(/\//g, "_")}.bin`);

        try { await fs.unlink(binPath); } catch { /* file may not exist */ }

        // Try to close the in-memory doc if loaded
        const { agentManagerRegistry } =
          await import("../agentManager/AgentManagerRegistry.js");
        if (agentManagerRegistry.has(teamId)) {
          const manager = await agentManagerRegistry.getForTeam(teamId);
          const registry = manager.getPluginRegistry();
          const collabStorage = registry?.getPluginStorage?.("collaboration");
          const server = (collabStorage?.crdt as any)?.collabServer || (collabStorage?.crdt as any)?._collabServer;
          // Hocuspocus doesn't expose a direct "delete doc" — closing connections is enough
          // The doc won't reload since we deleted the .bin
        }

        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Collab doc delete API mounted at /api/collab/:teamId/docs/:docName");

    // Chat message history (team-wide)
    this.app.get("/api/v2/teams/:teamId/messages", async (req, res) => {
      try {
        const { teamId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const before = req.query.before as string | undefined;

        if (options.services) {
          const messages = await options.services.chat.getMessages(teamId, { limit, before });
          res.json({ messages });
        } else {
          res.json({ messages: [] });
        }
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Per-agent chat history
    this.app.get("/api/v2/teams/:teamId/agents/:agentId/messages", async (req, res) => {
      try {
        const { teamId, agentId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

        if (options.services) {
          const messages = await options.services.chat.getAgentMessages(teamId, agentId, { limit });
          res.json({ messages });
        } else {
          res.json({ messages: [] });
        }
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Messages API mounted at /api/v2/teams/:teamId/messages");

    // Goal history
    this.app.get("/api/v2/teams/:teamId/goals", async (req, res) => {
      try {
        const { teamId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

        if (options.services) {
          const goals = await options.services.goals.getGoals(teamId, { limit });
          res.json({ goals });
        } else {
          res.json({ goals: [] });
        }
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Goals API mounted at /api/v2/teams/:teamId/goals");

    // Session restore — returns everything needed to rebuild UI in one call
    this.app.get("/api/v2/sessions/:teamId/restore", async (req, res) => {
      try {
        const { teamId } = req.params;

        let messages: any[] = [];
        let goals: any[] = [];

        if (options.services) {
          [messages, goals] = await Promise.all([
            options.services.chat.getMessages(teamId, { limit: 50 }),
            options.services.goals.getGoals(teamId, { limit: 10 }),
          ]);
        }

        // Try to get current plan/tasks from AgentManager if cached
        let plan = null;
        let tasks: any[] = [];
        try {
          const { agentManagerRegistry } =
            await import("../agentManager/AgentManagerRegistry.js");
          if (agentManagerRegistry.has(teamId)) {
            const manager = await agentManagerRegistry.getForTeam(teamId);
            const state = manager.getState?.();
            if (state) {
              plan = state.plan || null;
              tasks = state.tasks || [];
            }
          }
        } catch {
          // Manager not initialized — return empty plan/tasks
        }

        res.json({
          teamId,
          messages,
          goals,
          plan,
          tasks,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Session restore API mounted at /api/v2/sessions/:teamId/restore");

    // Workspace git push
    this.app.post("/api/v2/workspaces/:teamId/push", async (req, res) => {
      try {
        const { teamId } = req.params;

        let remoteUrl = req.body.remoteUrl;
        let remoteToken = req.body.remoteToken;

        // Try to get team info via services (validates team exists)
        if (options.services) {
          const team = await options.services.teams.getTeam(teamId);
          if (!team) { res.status(404).json({ error: "Team not found" }); return; }
          // Git remote config comes from request body or environment
        }

        if (!remoteUrl) { res.status(400).json({ error: "No git remote URL configured" }); return; }

        // Build authenticated URL if token provided
        const authUrl = remoteToken
          ? remoteUrl.replace("https://", `https://oauth2:${remoteToken}@`)
          : remoteUrl;

        const { agentManagerRegistry } =
          await import("../agentManager/AgentManagerRegistry.js");
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
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Workspace push API mounted at /api/v2/workspaces/:teamId/push");
  }

  /**
   * Mount registry API routes for plugin discovery.
   * Uses dynamic import to avoid hard dependency on @ping/registry at startup.
   */
  private mountRegistryRoutes(): void {
    // Lazy mount — load registry modules only when first request hits
    this.app.use("/api/registry", async (req, res, next) => {
      try {
        const { join, resolve } = await import("path");
        const { createRegistryRouter } = await import("./registryRouter.js");
        const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
        const { DiscoveryService } = await import("@ping/registry/src/discovery/DiscoveryService");
        const { IndexBuilder } = await import("@ping/registry/src/index/IndexBuilder");

        // Resolve registry dir: env var > repo root fallback
        // __dirname is packages/backend/dist/api/ — 4 levels up to repo root
        const repoRoot = resolve(__dirname, "..", "..", "..", "..");
        const registryDir = process.env.PLUGIN_REGISTRY_DIR
          ?? join(repoRoot, "packages", "registry", "plugins");
        const indexPath = join(repoRoot, "packages", "registry", "index.json");

        const loader = new PluginLoader(registryDir);

        // Try loading cached index, rebuild if missing
        let index;
        try {
          index = IndexBuilder.load(indexPath);
        } catch {
          // Index doesn't exist yet — create empty index (suggest endpoint will be limited)
          index = { version: "1.0", buildTimestamp: new Date().toISOString(), plugins: [], agents: [], skills: [] };
        }

        const discovery = new DiscoveryService(index);
        const router = createRegistryRouter(discovery, loader);

        // Replace the lazy middleware with the actual router
        this.app.use("/api/registry", router);
        router(req, res, next);
      } catch (error) {
        logger.error(`[HttpServer] Failed to mount registry routes: ${error}`);
        res.status(500).json({ error: "Registry service unavailable" });
      }
    });
  }

  /**
   * Start the HTTP server
   */
  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.info(`[HttpServer] HTTP API listening on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Get Express app instance (for Socket.IO integration)
   */
  getApp(): express.Application {
    return this.app;
  }

  // /**
  //  * Get HTTP server instance
  //  */
  // getServer(): any {
  //   return this.server;
  // }

  /**
   * Close the HTTP server
   */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        logger.info("[HttpServer] Closing HTTP server...");
        this.server.close((err: any) => {
          if (err) {
            logger.error("[HttpServer] Error closing server:", err);
            reject(err);
          } else {
            logger.info("[HttpServer] HTTP server closed");
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}
