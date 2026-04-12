export interface Team {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  workspaceId: string;
  gitRemoteUrl?: string | null;
  gitRemoteToken?: string | null;
  /** Plugin name — when set, agents are loaded from plugin folder instead of DB */
  pluginName?: string;
  settings: {
    executionMode: "sequential" | "parallel" | "hybrid";
    maxConcurrency: number;
  };
  createdAt: string;
  updatedAt: string;
}
