#!/usr/bin/env node
/**
 * DB Reset — Drops all collections for a clean slate.
 *
 * Usage:  bun run db:reset
 * Safety: Refuses to run in NODE_ENV=production
 */

import dotenv from "dotenv";
dotenv.config();

import { Logger } from "tslog";
import { assertSeedAllowed } from "./guard.js";
import { connectDB, disconnectDB, resetDB } from "../../db/index.js";

const logger = new Logger({ name: "db:reset" });

async function run(): Promise<void> {
  assertSeedAllowed();

  logger.info("[db:reset] Connecting...");
  await connectDB();

  try {
    await resetDB();
    logger.info("[db:reset] ✅ Database cleared.");
  } finally {
    await disconnectDB();
  }
}

run().catch((err) => {
  logger.error("[db:reset] Failed:", err);
  process.exit(1);
});
