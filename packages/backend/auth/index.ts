/**
 * better-auth configuration for Ping backend.
 *
 * Storage:
 * - File mode (default): SQLite via better-sqlite3 at data/auth.db
 * - MongoDB mode: when MONGODB_URI is set, uses mongodbAdapter
 *
 * Email + password authentication.
 * Uses toNodeHandler() for Express compatibility.
 */

import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import crypto from "crypto";
import path from "path";

const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3002";

/**
 * Resolve the auth signing secret.
 * Production: BETTER_AUTH_SECRET env var (required).
 * Dev: auto-generates a stable secret derived from baseURL so sessions survive restarts.
 */
function resolveSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) {
    return process.env.BETTER_AUTH_SECRET;
  }
  const devSecret = crypto.createHash("sha256").update(`ping-dev-${baseURL}`).digest("hex");
  console.warn("[Auth] BETTER_AUTH_SECRET not set - using dev fallback. Set it in production.");
  return devSecret;
}

/**
 * Resolve the database adapter based on PING_MODE config.
 * - local mode: always SQLite (even if MONGODB_URI is in .env)
 * - cloud mode: MongoDB via mongoose connection
 */
async function resolveDatabase(): Promise<any> {
  const { getConfig } = await import("../config/index.js");
  const config = getConfig();

  if (config.mode === "cloud" && config.mongodbUri) {
    const mongoose = (await import("mongoose")).default;
    if (mongoose.connection.readyState !== 1) {
      throw new Error("[Auth] Cloud mode requires MongoDB. Ensure connectDB() completes first.");
    }
    const { mongodbAdapter } = await import("better-auth/adapters/mongodb");
    const db = mongoose.connection.getClient().db();
    return mongodbAdapter(db);
  }

  // Local mode: bun:sqlite (native Bun SQLite, no external deps)
  const { Database } = await import("bun:sqlite");
  const fs = await import("fs");
  const dataDir = process.env.DATA_DIR || "./data";
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "auth.db");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");

  // Create tables if they don't exist (better-auth core schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      expiresAt TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      ipAddress TEXT,
      userAgent TEXT,
      userId TEXT NOT NULL REFERENCES "user"(id),
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES "user"(id),
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);

  console.info(`[Auth] Using SQLite at ${dbPath}`);
  return db;
}

async function createAuth() {
  const database = await resolveDatabase();

  // Build trusted origins from env or defaults
  const trustedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
  ];
  if (process.env.FRONTEND_URL) {
    trustedOrigins.push(process.env.FRONTEND_URL);
  }
  if (process.env.BETTER_AUTH_URL && !trustedOrigins.includes(process.env.BETTER_AUTH_URL)) {
    trustedOrigins.push(process.env.BETTER_AUTH_URL);
  }

  return betterAuth({
    secret: resolveSecret(),
    baseURL,
    basePath: "/api/auth",
    database,
    emailAndPassword: {
      enabled: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24,      // refresh session every 24h
    },
    trustedOrigins,
  });
}

let _auth: ReturnType<typeof betterAuth> | null = null;

/**
 * Get the better-auth instance. Lazy-initialized.
 * In file mode, works without MongoDB. In mongo mode, requires connection first.
 */
export async function getAuth() {
  if (!_auth) {
    _auth = await createAuth();
  }
  return _auth;
}

/**
 * Express-compatible handler for better-auth routes.
 * Lazy-initialized on first request.
 */
let _nodeHandler: ReturnType<typeof toNodeHandler> | null = null;

export async function getAuthHandler() {
  if (!_nodeHandler) {
    _nodeHandler = toNodeHandler(await getAuth());
  }
  return _nodeHandler;
}
