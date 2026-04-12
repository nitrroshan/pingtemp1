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
import type { IChatService, IGoalService } from "./contracts/index.js";
import { PluginTeamService } from "./PluginTeamService.js";

export interface ServiceRegistry {
  teams: PluginTeamService;
  chat: IChatService;
  goals: IGoalService;
  mode: "local" | "cloud";
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

  // Chat + Goals: MongoDB in cloud mode, SQLite in local mode
  let chatService: IChatService;
  let goalService: IGoalService;

  if (config.mode === "cloud" && config.mongodbUri) {
    const { MongoChatService } = await import("./mongo/MongoChatService.js");
    const { MongoGoalService } = await import("./mongo/MongoGoalService.js");
    chatService = new MongoChatService();
    goalService = new MongoGoalService();
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
    chatService = new SqliteChatService(db);
    goalService = new SqliteGoalService(db);
  }

  return {
    teams: teamService,
    chat: chatService,
    goals: goalService,
    mode: config.mongodbUri ? "cloud" : "local",
  };
}
