/**
 * better-auth React client for Ping frontend.
 *
 * Provides useSession() hook and signIn/signUp/signOut methods.
 */

import { createAuthClient } from "better-auth/react";

import { API_BASE_URL } from "../constants";

const API_URL = API_BASE_URL;

export const authClient = createAuthClient({
  baseURL: API_URL,
});

export const { useSession, signIn, signUp, signOut } = authClient;
