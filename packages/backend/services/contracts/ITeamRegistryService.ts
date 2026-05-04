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
  /** Check if a user can access a team (owner or member) */
  canAccess(userId: string, teamId: string): Promise<boolean>;
  /** Get all team IDs accessible to a user */
  getTeamsForUser(userId: string): Promise<string[]>;
}
