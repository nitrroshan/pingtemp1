/**
 * Database Connection for TeamService
 *
 * Uses the existing Mongoose connection from src/worker/db/config.ts
 * Mongoose models are defined in models.ts with indexes.
 */

import mongoose from "mongoose";
import { rootLogger } from "../logging/index.js";
import connectDB, { disconnectDB } from "../db/config.js";

const logger = rootLogger.child({ module: "teamService/database" });

/**
 * Initialize TeamService database connection.
 * Uses the existing Mongoose connection infrastructure.
 * Indexes are defined in the Mongoose schemas (models.ts).
 */
export async function initTeamServiceDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    logger.info("Mongoose already connected");
    return mongoose;
  }

  await connectDB();
  logger.info("TeamService connected via Mongoose");
  return mongoose;
}

/**
 * Close database connection.
 * Delegates to the existing disconnectDB function.
 */
export async function closeDb(): Promise<void> {
  await disconnectDB();
  logger.info("TeamService database connection closed");
}

/**
 * Check if database is connected.
 */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Get the Mongoose connection.
 */
export function getConnection(): mongoose.Connection {
  return mongoose.connection;
}
