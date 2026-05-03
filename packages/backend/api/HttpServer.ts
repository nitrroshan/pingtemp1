/**
 * HttpServer — Express HTTP server (slim orchestrator).
 *
 * v5.1 refactor: Domain routes extracted to routes/ modules.
 * This file handles middleware, health checks, auth, swagger,
 * feature flags, and mounts the extracted routers.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { rootLogger } from "../logging/index.js";
import type { AgentManager } from "../agentManager/AgentManagerV2.js";
import { createAgentManagerHandlerV2 } from "./agentManagerHandlerV2.js";
import { swaggerSpec } from "./swagger.js";
import { getAuth, getAuthHandler } from "../auth/index.js";
import { fromNodeHeaders } from "better-auth/node";
import { FRONTEND_FLAG_KEYS } from "../config/featureFlags.js";
import { getConfig } from "../config/index.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";

// v5.1 extracted route modules
import { createSessionRoutes } from "./routes/sessionRoutes.js";
import { createChatRoutes } from "./routes/chatRoutes.js";
import { createGithubRoutes } from "./routes/githubRoutes.js";
import { createCollabRoutes } from "./routes/collabRoutes.js";
import { createWorkspaceRoutes } from "./routes/workspaceRoutes.js";

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

  private setupMiddleware() {
    this.app.use(helmet({
      contentSecurityPolicy: false,
    }));

    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000",
      process.env.BETTER_AUTH_URL || "http://localhost:3002",
      "http://localhost:3001",
    ];
    this.app.use(cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
    }));

    this.app.use("/api/v2", rateLimit({
      windowMs: 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later" },
    }));

    this.app.use((req, res, next) => {
      if (req.path.startsWith("/api/auth")) return next();
      express.json()(req, res, next);
    });

    this.app.use("/api/v2", async (req: any, res, next) => {
      if (req.path === "/health") return next();
      try {
        const auth = await getAuth();
        if (!auth) {
          return res.status(401).json({ error: "Authentication not initialized" });
        }
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        });
        if (!session?.user?.id) {
          return res.status(401).json({ error: "Authentication required" });
        }
        req.userId = session.user.id;
        req.userEmail = session.user.email;
        next();
      } catch (err: any) {
        logger.warn({ err }, "[HttpServer] Auth middleware error");
        return res.status(401).json({ error: "Authentication failed" });
      }
    });
  }

  private setupRoutes(options: HttpServerOptions) {
    const services = options.services;

    // ── Health checks ──
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: Date.now(), service: "AgentManager API" });
    });

    this.app.get("/api/v2/health", async (req, res) => {
      const checks: Record<string, string> = {};
      const config = (await import("../config/index.js")).getConfig();
      const isFileMode = !config.mongodbUri;

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

    // ── Auth ──
    this.app.all("/api/auth/*splat", async (req, res) => {
      const handler = await getAuthHandler();
      return handler(req, res);
    });
    logger.info("[HttpServer] Auth routes mounted at /api/auth/*");

    // ── Feature flags ──
    this.app.get("/api/v2/feature-flags", (req, res) => {
      const config = getConfig();
      const flags: Record<string, any> = {};
      for (const key of FRONTEND_FLAG_KEYS) {
        flags[key] = config.featureFlags[key];
      }
      res.json(flags);
    });

    // ── V2 API (teams/roles/skills CRUD — already extracted) ──
    const v2Routes = services
      ? createAgentManagerHandlerV2(services)
      : createAgentManagerHandlerV2(undefined as any);
    this.app.use("/api/v2", v2Routes);
    this.app.use("/api", v2Routes);

    // ── v5.1 extracted route modules ──
    this.app.use("/api/v2", createSessionRoutes(services));
    this.app.use("/api/v2", createChatRoutes(services));
    this.app.use("/api/v2", createGithubRoutes(services));
    this.app.use("/api", createCollabRoutes());
    this.app.use("/api/v2", createWorkspaceRoutes(services));

    // ── Registry (lazy mount) ──
    this.mountRegistryRoutes();

    // ── Swagger (dev only) ──
    if (process.env.NODE_ENV !== "production") {
      this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
      this.app.get("/api-docs.json", (req, res) => {
        res.json(swaggerSpec);
      });
      logger.info("[HttpServer] Swagger UI available at /api-docs");
    }

    logger.info("[HttpServer] All routes mounted");
  }

  private mountRegistryRoutes(): void {
    this.app.use("/api/registry", async (req, res, next) => {
      try {
        const { join, resolve } = await import("path");
        const { createRegistryRouter } = await import("./registryRouter.js");
        const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
        const { DiscoveryService } = await import("@ping/registry/src/discovery/DiscoveryService");
        const { IndexBuilder } = await import("@ping/registry/src/index/IndexBuilder");

        const repoRoot = resolve(__dirname, "..", "..", "..", "..");
        const registryDir = process.env.PLUGIN_REGISTRY_DIR
          ?? join(repoRoot, "packages", "registry", "plugins");
        const indexPath = join(repoRoot, "packages", "registry", "index.json");

        const loader = new PluginLoader(registryDir);

        let index;
        try {
          index = IndexBuilder.load(indexPath);
        } catch {
          index = { version: "1.0", buildTimestamp: new Date().toISOString(), plugins: [], agents: [], skills: [] };
        }

        const discovery = new DiscoveryService(index);
        const router = createRegistryRouter(discovery, loader);

        this.app.use("/api/registry", router);
        router(req, res, next);
      } catch (error) {
        logger.error(`[HttpServer] Failed to mount registry routes: ${error}`);
        res.status(500).json({ error: "Registry service unavailable" });
      }
    });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.info(`[HttpServer] HTTP API listening on port ${port}`);
        resolve();
      });
    });
  }

  getApp(): express.Application {
    return this.app;
  }

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
