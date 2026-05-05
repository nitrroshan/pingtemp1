/**
 * PostgreSQL Connection — Drizzle ORM
 *
 * Uses pg (node-postgres) for local dev and @neondatabase/serverless for production.
 * Connection determined by DATABASE_URL env var.
 *
 * Usage:
 *   import { getDb } from "./connection";
 *   const db = getDb();
 *   const rows = await db.select().from(goals).where(eq(goals.status, "executing"));
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import { rootLogger } from "../logging/index.js";

const logger = rootLogger.child({ module: "db" });

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

/**
 * Get or create the Drizzle database instance.
 * Requires DATABASE_URL environment variable.
 */
export function getDb() {
  if (db) return db;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for hybrid mode. " +
      "Set it to a PostgreSQL connection string (e.g., postgresql://user:pass@localhost:5432/ping)."
    );
  }

  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    logger.error("[DB] Unexpected pool error:", err);
  });

  db = drizzle(pool, { schema });

  logger.info("[DB] PostgreSQL connection pool created");
  return db;
}

/**
 * Close the database connection pool.
 * Call on graceful shutdown.
 */
export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logger.info("[DB] PostgreSQL connection pool closed");
  }
}

/**
 * Get the raw pg Pool (for migrations, health checks, etc.)
 */
export function getPool(): pg.Pool | null {
  return pool;
}

// Re-export schema for convenience
export { schema };
