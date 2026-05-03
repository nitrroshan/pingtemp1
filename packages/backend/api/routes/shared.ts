/**
 * Shared utilities for route handlers.
 */

/** Sanitize error messages — hide internals in production */
export function safeError(err: any): string {
  if (process.env.NODE_ENV === "production") {
    return "Internal server error";
  }
  return err?.message || String(err);
}
