/**
 * Server entry point - starts the AgentManager API
 */

import dotenv from "dotenv";
dotenv.config();

import { validateConfig, getConfig } from "./config/index.js";
import { AgentManagerAPI } from "./api/AgentManagerAPI.js";
import { Logger } from "tslog";
import { connectDB, disconnectDB } from "./db/index.js";

// Fail fast if required env vars are missing (before any async work)
validateConfig();

const config = getConfig();
const logger = new Logger({ name: "Server" });

const PORT = config.port;

async function main() {
  try {
    logger.info("Starting AgentManager API Server...");

    // Connect to database
    logger.info("Connecting to MongoDB...");
    await connectDB();

    const api = new AgentManagerAPI(PORT);
    await api.start();

    logger.info(`Server running on:`);
    logger.info(`  HTTP API: http://localhost:${PORT}`);
    logger.info(`  WebSocket: ws://localhost:${PORT + 1}`);

    // Graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("\nShutting down gracefully...");
      await api.stop();
      await disconnectDB();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("\nReceived SIGTERM, shutting down gracefully...");
      await api.stop();
      await disconnectDB();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
