/**
 * planId — stable identifier for a plan (goal submission).
 *
 * v1.0: timestamp-based (unique enough for single-user).
 * Future: sha1(teamId + goalText + createdAtSecond) for cross-session stability.
 */

export function makePlanId(_teamId: string, _goalText: string, createdAt: number): string {
  return `plan-${createdAt}`;
}
