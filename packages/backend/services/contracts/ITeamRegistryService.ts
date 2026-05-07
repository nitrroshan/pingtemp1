export interface TeamRegistration {
  teamId: string;
  ownerId: string;
  pluginName: string;
  createdAt: string;
}

export interface ITeamRegistryService {
  /** Register a team with its owner (called on team creation) */
  register(teamId: string, ownerId: string, pluginName: string): Promise<TeamRegistration>;
  /** Get the owner of a team */
  getOwner(teamId: string): Promise<string | null>;
  /** Check if a user can access a team (read — any member role) */
  canAccess(userId: string, teamId: string): Promise<boolean>;
  /** Check if a user can perform mutating actions (write — not a viewer) */
  canMutate(userId: string, teamId: string): Promise<boolean>;
  /** Get all team IDs accessible to a user */
  getTeamsForUser(userId: string): Promise<string[]>;
  /** Get user's role for a team (owner/admin/member/viewer or null). Org-aware: checks org membership if team is org-owned. */
  getUserRoleForTeam(userId: string, teamId: string): Promise<string | null>;
  /** Transfer a team to an organization */
  transferToOrg(teamId: string, orgId: string): Promise<void>;
  /** Remove a team from its organization (back to user-owned) */
  removeFromOrg(teamId: string): Promise<void>;
}
