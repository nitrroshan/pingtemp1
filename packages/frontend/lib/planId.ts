/**
 * planId — stable identifier for a plan (goal submission).
 *
 * v1.0: timestamp-based (unique enough for single-user).
 * Future: sha1(teamId + goalText + createdAtSecond) for cross-session stability.
 */

export function makePlanId(_teamId: string, _goalText: string, createdAt: number): string {
  return `plan-${createdAt}`;
}

/**
 * toGoalId — deterministic goalId from goal text.
 * This is the SINGLE SOURCE OF TRUTH for goalId generation.
 * Backend receives goalId from the frontend and never derives its own.
 * Uses slug (first 50 chars) + hash (8 chars) to avoid collisions on long prompts.
 */
export function toGoalId(goal: string): string {
  const slug = goal
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
  
  // Simple hash to distinguish goals with same first 50 chars
  let hash = 0;
  for (let i = 0; i < goal.length; i++) {
    hash = ((hash << 5) - hash + goal.charCodeAt(i)) | 0;
  }
  const hashStr = Math.abs(hash).toString(36).substring(0, 8);
  
  return `${slug}-${hashStr}`;
}
