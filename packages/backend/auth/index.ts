/**
 * better-auth configuration for Ping backend.
 *
 * Uses MongoDB adapter for session/user storage.
 * Email + password authentication.
 * Uses toNodeHandler() for Express compatibility.
 */

import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import mongoose from "mongoose";

const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3002";

function createAuth() {
  const db = mongoose.connection.getClient().db();

  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    database: mongodbAdapter(db),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24,      // refresh session every 24h
    },
    trustedOrigins: [
      "http://localhost:3000",
      "http://localhost:3002",
    ],
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

/**
 * Get the better-auth instance. Must call after MongoDB is connected.
 */
export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}

/**
 * Express-compatible handler for better-auth routes.
 * Uses toNodeHandler() to bridge Express req/res to Web API Request/Response.
 * Lazy-initialized — safe to call before MongoDB is connected.
 */
let _nodeHandler: ReturnType<typeof toNodeHandler> | null = null;

export function getAuthHandler() {
  if (!_nodeHandler) {
    _nodeHandler = toNodeHandler(getAuth());
  }
  return _nodeHandler;
}
