/**
 * ServiceRegistry -- creates all service instances.
 *
 * Storage strategy:
 * - Teams + agents + skills: PluginTeamService (derived from plugin folders, no database)
 * - Goals, tasks, teams, orgs: PostgreSQL (Drizzle ORM) — always
 * - Chat: MongoDB (cloud/hybrid) or SQLite (local dev fallback)
 * - Auth: PostgreSQL (hybrid), MongoDB (cloud), SQLite (local) — handled in auth/index.ts
 *
 * Route-layer code NEVER branches on storage mode.
 */

import path from "path";
import { resolve, join } from "path";
import { getConfig } from "../config/index.js";
import type { IChatService, IGoalService, IOrgService, ITeamRegistryService } from "./contracts/index.js";
import type { ITaskPersistence } from "@ping/agent-manager/src/orchestrator/contracts/index.js";
import { PluginTeamService } from "./PluginTeamService.js";

export interface ServiceRegistry {
  teams: PluginTeamService;
  chat: IChatService;
  goals: IGoalService;
  tasks: ITaskPersistence;
  teamRegistry: ITeamRegistryService;
  orgs: IOrgService;
  mode: "hybrid";
  db?: any;
}

/**
 * Create all service instances.
 * Requires DATABASE_URL for PostgreSQL (relational data).
 * Chat uses MongoDB if MONGODB_URI is set, otherwise falls back to SQLite.
 */
export async function createServiceRegistry(dataDir: string = "./data"): Promise<ServiceRegistry> {
  const config = getConfig();

  // Create single PluginLoader instance shared across the app
  const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  const registryDir = process.env.PLUGIN_REGISTRY_DIR
    ?? join(repoRoot, "packages", "registry", "plugins");
  const pluginLoader = new PluginLoader(registryDir);

  // PluginTeamService: teams derived from plugins (no database)
  const teamService = new PluginTeamService(pluginLoader);

  // Relational data: always PostgreSQL
  const { PgGoalService } = await import("./postgres/PgGoalService.js");
  const { PgTaskService } = await import("./postgres/PgTaskService.js");
  const { PgTeamService } = await import("./postgres/PgTeamService.js");
  const { PgOrgService } = await import("./postgres/PgOrgService.js");
  const goalService = new PgGoalService();
  const taskService = new PgTaskService();
  const teamRegistryService = new PgTeamService();
  const orgService = new PgOrgService();

  // Chat: MongoDB if available, SQLite fallback for local dev
  let chatService: IChatService;
  if (config.mongodbUri) {
    const { MongoChatService } = await import("./mongo/MongoChatService.js");
    chatService = new MongoChatService();
  } else {
    const { Database } = await import("bun:sqlite");
    const fs = await import("fs");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const db = new Database(path.join(dataDir, "ping.db"), { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    const { SqliteChatService } = await import("./sqlite/index.js");
    chatService = new SqliteChatService(db);
  }

  return {
    teams: teamService,
    chat: chatService,
    goals: goalService,
    tasks: taskService,
    teamRegistry: teamRegistryService,
    orgs: orgService,
    mode: "hybrid",
  };
}
