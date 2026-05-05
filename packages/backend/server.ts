/**
 * Server entry point - starts the AgentManager API
 */

import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.secrets", override: true });

import { AgentManagerAPI } from "./api/AgentManagerAPI.js";
import { rootLogger } from "./logging/index.js";
import { connectDB, disconnectDB } from "./db/index.js";
import { getConfig, validateConfig } from "./config/index.js";
import { agentManagerRegistry } from "./agentManager/AgentManagerRegistry.js";
import { createServiceRegistry } from "./services/ServiceRegistry.js";

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

    logger.info(`Ping mode: ${config.mode}`);

    // Connect to MongoDB (cloud + hybrid modes — hybrid uses Mongo for chat)
    if ((config.mode === "cloud" || config.mode === "hybrid") && config.mongodbUri) {
      logger.info(`${config.mode} mode: connecting to MongoDB for chat...`);
      await connectDB();
    } else if (config.mode === "hybrid" && !config.mongodbUri) {
      logger.info("Hybrid mode: no MONGODB_URI — using SQLite for chat (dev fallback)");
    } else {
      logger.info("Local mode: file-based storage (lowdb + SQLite)");
    }

    // Create ServiceRegistry (SQLite local / MongoDB cloud)
    const dataDir = process.env.DATA_DIR || "./data";
    const services = await createServiceRegistry(dataDir);
    logger.info(`ServiceRegistry created (mode: ${services.mode})`);

    const api = new AgentManagerAPI(PORT, services);
    await api.start();

    // Log discovered plugins (teams are derived from plugins automatically)
    const teams = await services.teams.listTeams();
    logger.info(`[Startup] ${teams.length} plugin team(s) available: ${teams.map(t => t.pluginName).join(", ")}`);

    logger.info(`Server running on:`);
    logger.info(`  HTTP API: http://localhost:${PORT}`);
    logger.info(`  WebSocket: ws://localhost:${PORT + 1}`);

    // Graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("\nShutting down gracefully...");
      await agentManagerRegistry.flushAll();
      await api.stop();
      if (config.mongodbUri) await disconnectDB();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("\nReceived SIGTERM, shutting down gracefully...");
      await agentManagerRegistry.flushAll();
      await api.stop();
      if (config.mongodbUri) await disconnectDB();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
