/**
 * ServiceRegistry -- creates all service instances.
 *
 * Storage strategy:
 * - Teams + agents + skills: PluginTeamService (derived from plugin folders, no database)
 * - Chat + Goals (local): SQLite via bun:sqlite (data/ping.db)
 * - Chat + Goals (cloud): MongoDB
 * - Auth: SQLite locally, MongoDB when MONGODB_URI is set (handled separately in auth/index.ts)
 *
 * Route-layer code NEVER branches on storage mode.
 */

import path from "path";
import { resolve, join } from "path";
import { getConfig } from "../config/index.js";
import type { IChatService, IGoalService, ITeamRegistryService } from "./contracts/index.js";
import type { ITaskPersistence } from "@ping/agent-manager/src/orchestrator/contracts/index.js";
import { PluginTeamService } from "./PluginTeamService.js";

export interface ServiceRegistry {
  teams: PluginTeamService;
  chat: IChatService;
  goals: IGoalService;
  tasks: ITaskPersistence;
  teamRegistry: ITeamRegistryService;
  mode: "local" | "cloud" | "hybrid";
  db?: any;
}

/**
 * Create all service instances.
 * @param dataDir -- base directory for data files (default: ./data)
 */
export async function createServiceRegistry(dataDir: string = "./data"): Promise<ServiceRegistry> {
  const config = getConfig();

  // Create single PluginLoader instance shared across the app
  const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
  // __dirname at runtime = packages/backend/dist/services/ → 4 levels up to repo root
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  const registryDir = process.env.PLUGIN_REGISTRY_DIR
    ?? join(repoRoot, "packages", "registry", "plugins");
  const pluginLoader = new PluginLoader(registryDir);

  // PluginTeamService: teams derived from plugins (no database)
  const teamService = new PluginTeamService(pluginLoader);

  // Chat + Goals + Tasks: depends on mode
  // - local: SQLite
  // - cloud: MongoDB for everything
  // - hybrid: PostgreSQL for relational (goals, tasks, teams), MongoDB for chat
  let chatService: IChatService;
  let goalService: IGoalService;
  let teamRegistryService: ITeamRegistryService;
  let taskService: ITaskPersistence;

  if (config.mode === "hybrid") {
    // Hybrid mode: PostgreSQL for relational data, MongoDB for chat
    const { PgGoalService } = await import("./postgres/PgGoalService.js");
    const { PgTaskService } = await import("./postgres/PgTaskService.js");
    const { PgTeamService } = await import("./postgres/PgTeamService.js");
    goalService = new PgGoalService();
    taskService = new PgTaskService();
    teamRegistryService = new PgTeamService();

    // Chat stays in MongoDB (document-shaped, append-heavy)
    if (config.mongodbUri) {
      const { MongoChatService } = await import("./mongo/MongoChatService.js");
      chatService = new MongoChatService();
    } else {
      // Hybrid without MongoDB: fall back to SQLite for chat (dev convenience)
      const { Database } = await import("bun:sqlite");
      const fs = await import("fs");
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const db = new Database(path.join(dataDir, "ping.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      const { SqliteChatService } = await import("./sqlite/index.js");
      chatService = new SqliteChatService(db);
    }
  } else if (config.mode === "cloud" && config.mongodbUri) {
    const { MongoChatService } = await import("./mongo/MongoChatService.js");
    const { MongoGoalService } = await import("./mongo/MongoGoalService.js");
    const { MongoTeamRegistryService } = await import("./mongo/MongoTeamRegistryService.js");
    const { MongoTaskService } = await import("./mongo/MongoTaskService.js");
    chatService = new MongoChatService();
    goalService = new MongoGoalService();
    teamRegistryService = new MongoTeamRegistryService();
    taskService = new MongoTaskService();
  } else {
    const { Database } = await import("bun:sqlite");
    const fs = await import("fs");

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new Database(path.join(dataDir, "ping.db"), { create: true });
    // Enable WAL mode for concurrent reads
    db.exec("PRAGMA journal_mode=WAL");

    const { SqliteChatService } = await import("./sqlite/index.js");
    const { SqliteGoalService } = await import("./sqlite/index.js");
    const { SqliteTeamRegistryService } = await import("./sqlite/SqliteTeamRegistryService.js");
    chatService = new SqliteChatService(db);
    goalService = new SqliteGoalService(db);
    teamRegistryService = new SqliteTeamRegistryService(db);
    // v3.1: Real SQLite task persistence for local dev
    const { SqliteTaskService } = await import("./sqlite/SqliteTaskService.js");
    taskService = new SqliteTaskService(db);
  }

  return {
    teams: teamService,
    chat: chatService,
    goals: goalService,
    tasks: taskService,
    teamRegistry: teamRegistryService,
    mode: config.mode === "hybrid" ? "hybrid" : (config.mongodbUri ? "cloud" : "local"),
  };
}
