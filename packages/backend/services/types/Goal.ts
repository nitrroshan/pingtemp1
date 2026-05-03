export interface Goal {
  id: string;
  teamId: string;
  userId: string;
  goal: string;
  /** Deterministic slug ID for cross-session correlation (matches frontend toGoalId) */
  goalId?: string;
  status: "pending" | "planning" | "executing" | "completed" | "failed";
  planId?: string;
  result?: string;
  repoUrl?: string;
  repoBranch?: string;
  createdAt: string;
  updatedAt: string;
}
