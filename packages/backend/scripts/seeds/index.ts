#!/usr/bin/env node
/**
 * Seed -- Orchestrates seed scripts
 *
 * Usage:
 *   bun run seed
 *   bun run seed:admin
 *
 * What it does:
 *   - Seeds admin user (via better-auth, works with SQLite or MongoDB)
 *   - Teams/agents are auto-registered from plugin folders at startup (no seeding needed)
 *
 * Safety:
 *   - Refuses to run in NODE_ENV=production
 *   - Idempotent (safe to run multiple times)
 */

import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.secrets", override: true });

import { rootLogger } from "../../logging/index.js";
import { assertSeedAllowed } from "./guard.js";
import { connectDB, disconnectDB } from "../../db/index.js";
import { getAuth } from "../../auth/index.js";

const logger = rootLogger.child({ module: "seed" });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@ping.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin123!";
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

async function runSeeds(): Promise<void> {
  assertSeedAllowed();

  logger.info("[seed] Starting seed process...");

  // Connect DB only if using MongoDB
  if (process.env.MONGODB_URI) {
    await connectDB();
  }

  try {
    // Seed admin user
    const auth = await getAuth();
    try {
      await auth.api.signUpEmail({
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
      });
      logger.info(`[seed] Admin user created: ${ADMIN_EMAIL}`);
    } catch (err: any) {
      if (err?.message?.includes("already") || err?.body?.message?.includes("already")) {
        logger.info(`[seed] Admin user already exists: ${ADMIN_EMAIL}`);
      } else {
        throw err;
      }
    }

    logger.info("[seed] Done. Teams/agents are auto-registered from plugins at startup.");
  } finally {
    if (process.env.MONGODB_URI) {
      await disconnectDB();
    }
  }
}

runSeeds().catch((err) => {
  logger.error("[seed] Seed failed:", err);
  process.exit(1);
});
