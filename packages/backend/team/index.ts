/**
 * @ping/backend/team — re-exports from @ping/teams
 *
 * All team management code lives in the @ping/teams workspace package.
 * These re-exports preserve backward-compatibility for any internal
 * paths that still use "../team/..." imports.
 */
export * from "@ping/teams";
