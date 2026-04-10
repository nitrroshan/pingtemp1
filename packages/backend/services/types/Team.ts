export interface Team {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  workspaceId: string;
  gitRemoteUrl?: string | null;
  gitRemoteToken?: string | null;
  settings: {
    executionMode: "sequential" | "parallel" | "hybrid";
    maxConcurrency: number;
  };
  createdAt: string;
  updatedAt: string;
}
