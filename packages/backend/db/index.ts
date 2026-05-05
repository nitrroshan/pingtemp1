/**
 * Database module exports
 */

// MongoDB (existing)
export { default as connectDB, disconnectDB, resetDB } from "./config.js";

// PostgreSQL (new — hybrid mode)
export { getDb, closeDb, getPool, schema } from "./connection.js";
export * from "./schema.js";
