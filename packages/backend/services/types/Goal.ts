export interface Goal {
  id: string;
  teamId: string;
  sessionId: string;
  goal: string;
  status: "pending" | "planning" | "executing" | "completed" | "failed";
  planId?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
}
