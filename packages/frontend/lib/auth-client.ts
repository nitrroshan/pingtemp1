/**
 * better-auth React client for Ping frontend.
 *
 * Provides useSession() hook and signIn/signUp/signOut methods.
 */

import { createAuthClient } from "better-auth/react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3002";

export const authClient = createAuthClient({
  baseURL: API_URL,
});

export const { useSession, signIn, signUp, signOut } = authClient;
