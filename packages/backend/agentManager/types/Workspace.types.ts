/**
 * Workspace configuration interface
 * Shared workspace configuration used by both WorkspaceManager and AgentWorkspace
 */
export interface WorkspaceConfig {
  /** The absolute path to the repository/workspace */
  repoPath: string;
  
  /** Optional default branch name (e.g., 'main', 'master') */
  defaultBranch?: string;
  
  /** Optional remote repository configuration */
  remote?: {
    /** The URL of the remote repository */
    url: string;
    
    /** Optional name of the remote (defaults to 'origin') */
    name?: string;
  };
}
