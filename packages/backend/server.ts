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

    // Connect to database (cloud mode only)
    if (config.mode === "cloud" && config.mongodbUri) {
      logger.info("Cloud mode: connecting to MongoDB for chat + auth...");
      await connectDB();
    } else {
      logger.info("Local mode: file-based storage (lowdb + SQLite)");
    }

    // Create ServiceRegistry (file-based or MongoDB adapters)
    const dataDir = process.env.DATA_DIR || "./data";
    const services = await createServiceRegistry(dataDir);
    logger.info(`ServiceRegistry created (mode: ${services.mode})`);

    const api = new AgentManagerAPI(PORT, services);
    await api.start();

    // Auto-register plugin teams on startup
    // Scans registry/plugins/ and creates team records for any new plugins found
    await autoRegisterPluginTeams(services);

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

/**
 * Auto-register teams from plugin folders.
 * Scans registry/plugins/, creates a team record for each plugin
 * that doesn't already have a corresponding team in the database.
 * Idempotent — safe to run every startup.
 */
async function autoRegisterPluginTeams(services: import("./services/ServiceRegistry.js").ServiceRegistry) {
  try {
    const { resolve, join } = await import("path");
    const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
    const { randomUUID } = await import("crypto");

    // __dirname is packages/backend/dist/ — 3 levels up to repo root
    const repoRoot = resolve(__dirname, "..", "..", "..");
    const registryDir = process.env.PLUGIN_REGISTRY_DIR
      ?? join(repoRoot, "packages", "registry", "plugins");

    const loader = new PluginLoader(registryDir);
    const manifests = await loader.getPluginManifests();

    if (manifests.length === 0) {
      logger.info("[Startup] No plugins found in registry");
      return;
    }

    // Get existing teams to avoid duplicates
    const existing = await services.teams.listTeams();
    const existingPlugins = new Set(
      existing
        .filter((t: any) => t.pluginName)
        .map((t: any) => t.pluginName)
    );

    let created = 0;
    for (const manifest of manifests) {
      if (existingPlugins.has(manifest.name)) continue;

      await services.teams.createTeam({
        name: manifest.name.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        description: manifest.description,
        ownerId: "system",
        workspaceId: randomUUID(),
        pluginName: manifest.name,
        settings: { executionMode: "sequential", maxConcurrency: 1 },
      });
      created++;
      logger.info(`[Startup] Registered plugin team: ${manifest.name}`);
    }

    if (created > 0) {
      logger.info(`[Startup] ${created} plugin team(s) auto-registered`);
    } else {
      logger.info(`[Startup] All ${manifests.length} plugin teams already registered`);
    }
  } catch (error) {
    logger.warn(`[Startup] Plugin auto-registration failed (non-fatal): ${error}`);
  }
}

main();
