/**
 * Database utilities for @ping/teams
 *
 * Uses the existing Mongoose connection — @ping/teams expects the caller
 * (e.g. @ping/backend) to have already called mongoose.connect() before
 * using any models. This helper provides optional standalone connection
 * management for environments where @ping/teams is used directly.
 */

import mongoose from "mongoose";
import { Logger } from "tslog";

const logger = new Logger({ name: "@ping/teams/database" });

/**
 * Connect to MongoDB using MONGODB_URI environment variable.
 * No-op if already connected.
 */
export async function connectTeamsDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    logger.debug("[@ping/teams] Mongoose already connected");
    return mongoose;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "[@ping/teams] MONGODB_URI environment variable is required",
    );
  }

  await mongoose.connect(uri);
  logger.info("[@ping/teams] Connected to MongoDB");
  return mongoose;
}

/**
 * Disconnect from MongoDB.
 */
export async function disconnectTeamsDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("[@ping/teams] Disconnected from MongoDB");
  }
}

/**
 * Returns true if Mongoose is currently connected.
 */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Returns the active Mongoose connection (throws if not connected).
 */
export function getConnection(): typeof mongoose.connection {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("[@ping/teams] Database not connected");
  }
  return mongoose.connection;
}

// Legacy aliases for backward-compatibility with @ping/backend/team/database.ts
export const initTeamServiceDb = connectTeamsDb;
export const closeDb = disconnectTeamsDb;
