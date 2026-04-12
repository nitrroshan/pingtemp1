#!/usr/bin/env node
/**
 * Seed admin user via better-auth API.
 *
 * Usage:
 *   bun run seed:admin
 *   ADMIN_EMAIL=me@example.com ADMIN_PASSWORD=secret bun run seed:admin
 *
 * Defaults:
 *   Email:    admin@ping.local
 *   Password: Admin123!
 *   Name:     Admin
 */

import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.secrets", override: true });

import { rootLogger } from "../../logging/index.js";
import { connectDB, disconnectDB } from "../../db/index.js";
import { getAuth } from "../../auth/index.js";

const logger = rootLogger.child({ module: "seed:admin" });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@ping.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin123!";
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

async function seedAdmin() {
  // Connect DB only if MONGODB_URI is set (auth works with SQLite too)
  if (process.env.MONGODB_URI) {
    await connectDB();
  }

  try {
    const auth = await getAuth();

    // Check if admin already exists
    const existing = await auth.api.signInEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }).catch(() => null);

    if (existing?.user) {
      logger.info(`Admin user already exists: ${ADMIN_EMAIL}`);
      return;
    }

    // Create admin user
    const result = await auth.api.signUpEmail({
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        name: ADMIN_NAME,
      },
    });

    if (result?.user) {
      logger.info(`Admin user created: ${ADMIN_EMAIL}`);
    } else {
      logger.error("Failed to create admin user");
    }
  } catch (err: any) {
    // "User already exists" is fine
    if (err?.message?.includes("already") || err?.body?.message?.includes("already")) {
      logger.info(`Admin user already exists: ${ADMIN_EMAIL}`);
    } else {
      logger.error({ err }, "Failed to seed admin user");
      throw err;
    }
  } finally {
    if (process.env.MONGODB_URI) {
      await disconnectDB();
    }
  }
}

seedAdmin().catch((err) => {
  logger.error({ err }, "seed:admin failed");
  process.exit(1);
});
