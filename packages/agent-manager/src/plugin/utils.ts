/**
 * Core utility functions for orchestration.
 * These live in the core layer — no dependency on L1/L2/L3.
 */

/**
 * Generate stable goalId from goal text.
 * Same goal always produces same goalId — enables replans to land in the same directory.
 */
export function toGoalId(goal: string): string {
  return goal
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}
