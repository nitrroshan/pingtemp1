#!/usr/bin/env node
/**
 * DB Reset — Drops all data for a clean slate.
 *
 * Handles both MongoDB (cloud mode) and PostgreSQL (hybrid mode).
 *
 * Usage:  bun run db:reset
 * Safety: Refuses to run in NODE_ENV=production
 */

import dotenv from "dotenv";
dotenv.config();

import { rootLogger } from "../../logging/index.js";
import { assertSeedAllowed } from "./guard.js";
import { getConfig } from "../../config/index.js";

const logger = rootLogger.child({ module: "db:reset" });

async function run(): Promise<void> {
  assertSeedAllowed();

  const config = getConfig();

  // Reset PostgreSQL if in hybrid mode
  if (config.mode === "hybrid" && config.databaseUrl) {
    logger.info("[db:reset] Resetting PostgreSQL...");
    const { getDb, closeDb } = await import("../../db/connection.js");
    const { sql } = await import("drizzle-orm");
    const db = getDb();

    await db.execute(sql`
      TRUNCATE organizations, org_members, agent_teams, goals, tasks, agent_definitions,
      "user", session, account, verification CASCADE
    `);
    logger.info("[db:reset] ✅ PostgreSQL tables truncated.");
    await closeDb();
  }

  // Reset MongoDB if available
  if (config.mongodbUri) {
    logger.info("[db:reset] Resetting MongoDB...");
    const { connectDB, disconnectDB, resetDB } = await import("../../db/index.js");
    await connectDB();
    try {
      await resetDB();
      logger.info("[db:reset] ✅ MongoDB cleared.");
    } finally {
      await disconnectDB();
    }
  }

  // Reset SQLite chat DB if no MongoDB (fallback chat storage)
  if (!config.mongodbUri) {
    const path = await import("path");
    const fs = await import("fs");
    const dataDir = process.env.DATA_DIR || "./data";
    const dbPath = path.join(dataDir, "ping.db");
    if (fs.existsSync(dbPath)) {
      logger.info("[db:reset] Resetting SQLite chat DB...");
      const { Database } = await import("bun:sqlite");
      const sqliteDb = new Database(dbPath);
      // Drop chat tables (SqliteChatService tables)
      try {
        sqliteDb.exec("DELETE FROM messages");
        logger.info("[db:reset] ✅ SQLite chat cleared.");
      } catch {
        logger.info("[db:reset] No SQLite chat tables to clear.");
      }
      sqliteDb.close();
    }
  }

  logger.info("[db:reset] ✅ Database reset complete.");
}

run().catch((err) => {
  logger.error("[db:reset] Failed:", err);
  process.exit(1);
});
