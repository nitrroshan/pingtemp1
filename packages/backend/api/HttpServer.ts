/**
 * HttpServer - Express HTTP server for REST API endpoints
 */

import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { rootLogger } from "../logging/index.js";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { createAgentManagerHandlerV2 } from "./agentManagerHandlerV2.js";
import { TeamService } from "../team/index.js";
import { swaggerSpec } from "./swagger.js";
import { skillsRouter } from "../skills/index.js";
import { getAuthHandler } from "../auth/index.js";
import { FRONTEND_FLAG_KEYS } from "../config/featureFlags.js";
import { getConfig } from "../config/index.js";
import { ChatMessageModel } from "../db/models/ChatMessage.js";
import { GoalModel } from "../db/models/Goal.js";

const logger = rootLogger.child({ module: "HttpServer" });

export interface HttpServerOptions {
  agentManager: AgentManager;
  teamService?: TeamService;
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
    this.app.use(express.json());
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

      // MongoDB
      try {
        const mongoose = (await import("mongoose")).default;
        checks.mongodb = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
      } catch {
        checks.mongodb = "error";
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
        (v) => v === "connected" || v === "writable",
      );

      res.status(allOk ? 200 : 503).json({
        status: allOk ? "ok" : "degraded",
        timestamp: Date.now(),
        uptime: process.uptime(),
        checks,
      });
    });

    // Mount better-auth routes (lazy init — after MongoDB is connected)
    this.app.all("/api/auth/*splat", (req, res, next) => {
      const handler = getAuthHandler();
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

    // Mount V2 API routes
    const v2Routes = createAgentManagerHandlerV2();
    this.app.use("/api/v2", v2Routes);
    // Also mount at /api for backward compat
    this.app.use("/api", v2Routes);
    logger.info("[HttpServer] V2 API mounted at /api/v2 and /api");

    // Mount skills API routes
    this.app.use("/api/skills", skillsRouter);
    logger.info("[HttpServer] Skills API mounted at /api/skills");

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

    // Chat message history
    this.app.get("/api/v2/teams/:teamId/messages", async (req, res) => {
      try {
        const { teamId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const before = req.query.before ? new Date(req.query.before as string) : new Date();

        const messages = await ChatMessageModel.find({
          teamId,
          timestamp: { $lt: before },
        })
          .sort({ timestamp: -1 })
          .limit(limit)
          .lean();

        res.json({ messages: messages.reverse() });
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

        const goals = await GoalModel.find({ teamId })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        res.json({ goals });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Goals API mounted at /api/v2/teams/:teamId/goals");

    // Session restore — returns everything needed to rebuild UI in one call
    this.app.get("/api/v2/sessions/:teamId/restore", async (req, res) => {
      try {
        const { teamId } = req.params;

        const [messages, goals] = await Promise.all([
          ChatMessageModel.find({ teamId })
            .sort({ timestamp: -1 })
            .limit(50)
            .lean(),
          GoalModel.find({ teamId })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean(),
        ]);

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
          messages: messages.reverse(),
          goals,
          plan,
          tasks,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
    logger.info("[HttpServer] Session restore API mounted at /api/v2/sessions/:teamId/restore");
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
