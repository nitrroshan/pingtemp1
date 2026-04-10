export interface Agent {
  id: string;
  teamId: string;
  role: string;
  type: "planner" | "worker";
  name: string;
  ownedBy: string;
  delegatedTo: string | null;
  definitionYaml: string;
  status: "pending" | "running" | "stopped" | "error";
  lastStartedAt: string | null;
  errorMessage: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
