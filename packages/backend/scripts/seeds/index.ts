#!/usr/bin/env node
/**
 * Seed — Orchestrates all seed scripts
 *
 * Usage:
 *   SEED_ENABLED=true bun run seed
 *   SEED_ENABLED=true bun run seed:teams
 *
 * Safety:
 *   - Refuses to run in NODE_ENV=production
 *   - Requires SEED_ENABLED=true
 *   - Idempotent (safe to run multiple times)
 */

import dotenv from "dotenv";
dotenv.config();

import { rootLogger } from "../../logging/index.js";
import { assertSeedAllowed } from "./guard.js";
import { connectDB, disconnectDB } from "../../db/index.js";
import { seedTeams } from "./teams.seed.js";
import { seedAgents } from "./agents.seed.js";

const logger = rootLogger.child({ module: "seed" });

async function runSeeds(): Promise<void> {
  // Safety guard — never seeds in production
  assertSeedAllowed();

  logger.info("[seed] Starting seed process...");
  logger.info(`[seed] NODE_ENV: ${process.env.NODE_ENV || "development"}`);

  // Connect to database
  await connectDB();

  try {
    // 1. Seed teams
    const teams = await seedTeams();

    // 2. Seed agents for each team
    await seedAgents(teams);

    logger.info("[seed] ✅ All seeds completed successfully.");
    logger.info("[seed] Summary:");
    logger.info(`       Teams: ${teams.length}`);
    for (const team of teams) {
      logger.info(`         - ${team.name}: ${team.goal}`);
    }
  } finally {
    await disconnectDB();
  }
}

runSeeds().catch((err) => {
  logger.error("[seed] Seed failed:", err);
  process.exit(1);
});
