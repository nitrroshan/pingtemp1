/**
 * HttpServer - Express HTTP server for REST API endpoints
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { rootLogger } from "../logging/index.js";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { createAgentManagerHandlerV2 } from "./agentManagerHandlerV2.js";
import { swaggerSpec } from "./swagger.js";
import { getAuth, getAuthHandler } from "../auth/index.js";
import { fromNodeHeaders } from "better-auth/node";
import { FRONTEND_FLAG_KEYS } from "../config/featureFlags.js";
import { getConfig } from "../config/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "HttpServer" });

/** Sanitize error messages — hide internals in production */
function safeError(err: any): string {
  if (process.env.NODE_ENV === "production") {
    return "Internal server error";
  }
  return err?.message || String(err);
}

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
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disabled — frontend is served separately by Vite
    }));

    // CORS — allowlist specific origins
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000",
      process.env.BETTER_AUTH_URL || "http://localhost:3002",
      "http://localhost:3001",
    ];
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, curl)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
    }));

    // Rate limiting — per IP (generous for dev; restore endpoint reduces burst count)
    this.app.use("/api/v2", rateLimit({
      windowMs: 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later" },
    }));

    // Skip express.json() for auth routes — better-auth's toNodeHandler() reads the raw body
    this.app.use((req, res, next) => {
      if (req.path.startsWith("/api/auth")) return next();
      express.json()(req, res, next);
    });

    // Auth middleware for /api/v2/* routes — validates better-auth session cookie
    this.app.use("/api/v2", async (req: any, res, next) => {
      // Skip auth for health check
      if (req.path === "/health") return next();
      try {
        const auth = await getAuth();
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        });
        if (!session?.user?.id) {
          return res.status(401).json({ error: "Authentication required" });
        }
        req.userId = session.user.id;
        req.userEmail = session.user.email;
        next();
      } catch (err) {
        logger.warn("[HttpServer] Auth middleware error:", err);
        return res.status(401).json({ error: "Authentication failed" });
      }
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

    // Mount Swagger UI — dev only (don't expose API surface in production)
    if (process.env.NODE_ENV !== "production") {
      this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
      this.app.get("/api-docs.json", (req, res) => {
        res.json(swaggerSpec);
      });
      logger.info("[HttpServer] Swagger UI available at /api-docs");
    }

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
        res.status(500).json({ error: safeError(err) });
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
        res.status(500).json({ error: safeError(err) });
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
        res.status(500).json({ error: safeError(err) });
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
        res.status(500).json({ error: safeError(err) });
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
        res.status(500).json({ error: safeError(err) });
      }
    });
    logger.info("[HttpServer] Goals API mounted at /api/v2/teams/:teamId/goals");

    // Chat Agent — role tasks (Phase 1, Step 1)
    this.app.get("/api/v2/teams/:teamId/roles/:role/tasks", async (req, res) => {
      try {
        const { teamId, role } = req.params;
        const { agentManagerRegistry } =
          await import("../agentManager/AgentManagerRegistry.js");
        if (!agentManagerRegistry.has(teamId)) {
          res.json({ tasks: [], role, enabled: false });
          return;
        }
        const manager = await agentManagerRegistry.getForTeam(teamId);
        const snapshot = manager.getChatAgentSnapshot(role);
        if (!snapshot) {
          // Chat agents not enabled — fall back to TaskStore directly
          res.json({ tasks: [], role, enabled: false });
          return;
        }
        res.json({ ...snapshot, enabled: true });
      } catch (err: any) {
        res.status(500).json({ error: safeError(err) });
      }
    });
    logger.info("[HttpServer] Chat Agent tasks API mounted at /api/v2/teams/:teamId/roles/:role/tasks");

    // Session restore — returns everything needed to rebuild UI in one call
    this.app.get("/api/v2/sessions/:teamId/restore", async (req, res) => {
      try {
        const { teamId } = req.params;
        const requestedGoalId = req.query.goalId as string | undefined;

        let sessionMessages: any[] = [];
        let workerMessages: any[] = [];
        let goals: any[] = [];

        if (options.services) {
          const [sessionResult, goalsResult] = await Promise.all([
            options.services.chat.getSessionMessages(teamId, {
              sessionLimit: 100,
              workerLimit: 50,
            }),
            options.services.goals.getGoals(teamId, { limit: 10 }),
          ]);
          sessionMessages = sessionResult.session;
          workerMessages = sessionResult.worker;
          goals = goalsResult;

          // Re-classify: move planner/chat-agent messages from worker bucket to session bucket
          const reclassified: any[] = [];
          for (const msg of workerMessages) {
            if (msg.agentId === "manager" || msg.agentId === "orchestrator" || msg.agentId === "planner" || msg.agentId?.startsWith("chat-")) {
              sessionMessages.push(msg);
            } else {
              reclassified.push(msg);
            }
          }
          workerMessages = reclassified;
        }

        // Get current plan/tasks from AgentManager
        let plan = null;
        let tasks: any[] = [];
        let orchestratorState: string | null = null;
        let activeGoalId: string | null = requestedGoalId || null;
        let allGoalSummaries: any[] = [];
        try {
          const { agentManagerRegistry } =
            await import("../agentManager/AgentManagerRegistry.js");
          const manager = await agentManagerRegistry.getForTeam(teamId);

          orchestratorState = manager.getOrchestratorState();
          // Use requested goalId, or fall back to manager's current goal
          if (!activeGoalId) {
            activeGoalId = manager.getCurrentGoalId();
          }

          allGoalSummaries = manager.getAllGoalSummaries?.() ?? [];

          const pendingPlan = manager.getOrchestratorPendingPlan();
          if (pendingPlan) {
            plan = pendingPlan.tasks || pendingPlan;
          }

          const taskStore = manager.getTaskStore();
          if (taskStore) {
            // Filter tasks by goalId when available
            const allTasks = activeGoalId
              ? taskStore.getByGoal(activeGoalId)
              : taskStore.getAllTasks();
            if (allTasks.length > 0) {
              tasks = allTasks.map((t: any) => ({
                id: t.id,
                title: t.title || t.description?.slice(0, 80) || t.id,
                description: t.description,
                status: t.status,
                assignedRole: t.assigned_role,
                priority: t.priority,
                dependencies: t.dependants || [],
                goalId: t.goalId,
              }));
              if (!plan) {
                plan = tasks;
              }
            }
          }
        } catch {
          // Manager not initialized — return empty plan/tasks
        }

        // Filter messages by goalId ONLY when explicitly requested by the client.
        // Don't filter on manager's current goalId — on reload the manager may have
        // a different active goal, which would hide the user's conversation.
        if (requestedGoalId) {
          sessionMessages = sessionMessages.filter(m => !m.goalId || m.goalId === requestedGoalId);
          workerMessages = workerMessages.filter(m => !m.goalId || m.goalId === requestedGoalId);
        }

        // Group session messages by agentId for per-agent conversations
        const conversations: Record<string, any[]> = {};
        for (const msg of sessionMessages) {
          const key = msg.agentId;
          if (!conversations[key]) conversations[key] = [];
          conversations[key].push(msg);
        }

        res.json({
          teamId,
          conversations,
          workerMessages,
          goals,
          plan,
          tasks,
          orchestratorState,
          activeGoalId,
          allGoalSummaries,
        });
      } catch (err: any) {
        res.status(500).json({ error: safeError(err) });
      }
    });
    logger.info("[HttpServer] Session restore API mounted at /api/v2/sessions/:teamId/restore");

    // Workspace git push
    this.app.post("/api/v2/workspaces/:teamId/push", async (req, res) => {
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

        // Try to get team info via services (validates team exists)
        if (options.services) {
          const team = await options.services.teams.getTeam(teamId);
          if (!team) { res.status(404).json({ error: "Team not found" }); return; }
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
        res.status(500).json({ error: safeError(err) });
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
