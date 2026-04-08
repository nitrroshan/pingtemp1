/**
 * Server entry point - starts the AgentManager API
 */

import dotenv from "dotenv";
dotenv.config();

import { AgentManagerAPI } from "./api/AgentManagerAPI.js";
import { rootLogger } from "./logging/index.js";
import { connectDB, disconnectDB } from "./db/index.js";
import { getConfig, validateConfig } from "./config/index.js";
import { agentManagerRegistry } from "./agentManager/AgentManagerRegistry.js";

const logger = rootLogger.child({ module: "Server" });

// Validate required env vars before doing anything else
try {
  validateConfig();
} catch (err) {
  // Use console.error so the message is visible even if tslog isn't ready
  console.error("\n✖ Startup validation failed:\n");
  console.error((err as Error).message);
  process.exit(1);
}

const config = getConfig();
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
      await agentManagerRegistry.flushAll();
      await api.stop();
      await disconnectDB();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("\nReceived SIGTERM, shutting down gracefully...");
      await agentManagerRegistry.flushAll();
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
