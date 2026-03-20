/**
 * Team configuration interface
 * Defines the structure for creating and managing a team of agents
 */
export interface TeamConfig {
  /** The name of the team */
  teamName: string;

  /** The team's primary goal or objective */
  goal: string;

  /** Optional detailed description of the team's purpose */
  description: string;

  /** Optional array of agent member IDs */
  members?: string[]; //default empty

  /** Optional timestamp when the team was created */
  createdAt?: Date;

  /** Optional timestamp when the team was last updated */
  updatedAt?: Date;
}
