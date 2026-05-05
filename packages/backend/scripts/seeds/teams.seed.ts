#!/usr/bin/env bun
/**
 * seed-teams.ts — Register plugin teams in PostgreSQL.
 *
 * Reads all plugins from the registry folder, creates:
 *   - A default organization (owned by the admin user)
 *   - An agent_team row per plugin (with deterministic team_id)
 *
 * Run AFTER seed:admin (needs the admin user to exist for ownership).
 *
 * Usage:
 *   bun run seed:teams                                          # default admin owner
 *   ADMIN_EMAIL=me@example.com bun run seed:teams               # custom owner
 *
 * Idempotent: skips existing teams, safe to re-run.
 * Requires: DATABASE_URL + PING_MODE=hybrid
 */

import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.secrets", override: true });

import { resolve, join } from "path";
import { rootLogger } from "../../logging/index.js";
import { getConfig } from "../../config/index.js";

const logger = rootLogger.child({ module: "seed:teams" });

async function seedTeams() {
  const config = getConfig();

  if (config.mode !== "hybrid") {
    logger.info("[seed:teams] Not in hybrid mode — plugin teams are file-based. Nothing to seed.");
    return;
  }

  if (!config.databaseUrl) {
    logger.error("[seed:teams] DATABASE_URL required for hybrid mode.");
    process.exit(1);
  }

  // Connect MongoDB if needed (for admin user lookup)
  if (config.mongodbUri) {
    const { connectDB } = await import("../../db/index.js");
    await connectDB();
  }

  const { getDb } = await import("../../db/connection.js");
  const { organizations, orgMembers, agentTeams } = await import("../../db/schema.js");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();

  // Resolve admin user ID from auth
  const adminEmail = process.env.ADMIN_EMAIL || "admin@ping.local";
  let adminUserId: string | null = null;

  try {
    const { user } = await import("../../db/schema.js");
    const adminRows = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, adminEmail)).limit(1);
    if (adminRows.length > 0) {
      adminUserId = adminRows[0].id;
      logger.info(`[seed:teams] Admin user found: ${adminEmail} (${adminUserId})`);
    }
  } catch {
    logger.warn("[seed:teams] Could not look up admin user — using 'system' as owner");
  }

  const ownerId = adminUserId || "system";

  // Create or find the default organization
  let orgId: string;
  const existingOrgs = await db.select({ orgId: orgMembers.orgId }).from(orgMembers)
    .where(and(eq(orgMembers.userId, ownerId), eq(orgMembers.role, "owner"))).limit(1);

  if (existingOrgs.length > 0) {
    orgId = existingOrgs[0].orgId;
    logger.info(`[seed:teams] Using existing organization: ${orgId}`);
  } else {
    const [org] = await db.insert(organizations).values({
      name: "Default",
      plan: "free",
    }).returning();
    orgId = org.id;

    await db.insert(orgMembers).values({
      orgId,
      userId: ownerId,
      role: "owner",
    });
    logger.info(`[seed:teams] Created default organization: ${orgId}`);
  }

  // Load all plugins
  const { PluginLoader } = await import("@ping/registry/src/loader/PluginLoader");
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  const registryDir = process.env.PLUGIN_REGISTRY_DIR
    ?? join(repoRoot, "packages", "registry", "plugins");

  const pluginLoader = new PluginLoader(registryDir);
  const manifests = await pluginLoader.getPluginManifests();

  logger.info(`[seed:teams] Found ${manifests.length} plugins in ${registryDir}`);

  // Import PluginTeamService for deterministic team ID generation
  const { PluginTeamService } = await import("../../services/PluginTeamService.js");
  const teamService = new PluginTeamService(pluginLoader);

  let created = 0;
  let skipped = 0;

  for (const manifest of manifests) {
    const teamId = teamService.getTeamId(manifest.name);

    // Check if already registered
    const existing = await db.select({ id: agentTeams.id }).from(agentTeams)
      .where(eq(agentTeams.teamId, teamId)).limit(1);

    if (existing.length > 0) {
      logger.debug(`[seed:teams] Team "${manifest.name}" already registered (${teamId})`);
      skipped++;
      continue;
    }

    // Register team
    const displayName = manifest.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    await db.insert(agentTeams).values({
      teamId,
      orgId,
      name: displayName,
      description: manifest.description ?? "",
      pluginName: manifest.name,
    });

    logger.info(`[seed:teams] Registered: "${manifest.name}" → ${teamId}`);
    created++;
  }

  logger.info(`[seed:teams] Done. Created: ${created}, Skipped: ${skipped}`);

  // Cleanup
  const { closeDb } = await import("../../db/connection.js");
  await closeDb();
  if (config.mongodbUri) {
    const { disconnectDB } = await import("../../db/index.js");
    await disconnectDB();
  }
}

seedTeams().catch((err) => {
  logger.error({ err }, "[seed:teams] Failed");
  process.exit(1);
});
