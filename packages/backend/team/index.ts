/**
 * Team Service
 *
 * Manages teams with Planner Agent, manager ownership, and delegation model.
 * Uses Mongoose ODM for MongoDB persistence.
 */

// Main service
export { TeamService } from "./TeamService.js";

// Mongoose models
export {
  TeamModel,
  AgentModel,
  TeamMemberModel,
  AgentSkillModel,
} from "./models.js";
export type { ITeam, IAgent, ITeamMember, IAgentSkill } from "./models.js";

// Types and errors
export * from "./types/index.js";
export * from "./errors.js";

// Database utilities
export {
  initTeamServiceDb,
  closeDb,
  isConnected,
  getConnection,
} from "./database.js";
