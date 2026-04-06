/**
 * @ping/teams — Team management service for Ping
 *
 * Provides TeamService, Mongoose models, types, and error classes for
 * multi-team orchestration. This is the single source of truth for all
 * team, agent, member, and skill-assignment data in the Ping platform.
 *
 * Usage (in @ping/backend):
 *   import { TeamService } from "@ping/teams";
 *   import type { Team, Agent } from "@ping/teams";
 */

// Main service
export { TeamService } from "./TeamService.js";

// Mongoose models (MongoDB schemas)
export {
  TeamModel,
  AgentModel,
  TeamMemberModel,
  AgentSkillModel,
} from "./models.js";
export type { ITeam, IAgent, ITeamMember, IAgentSkill } from "./models.js";

// TypeScript types and interfaces
export * from "./types/index.js";

// Error classes
export * from "./errors.js";

// Database utilities
export {
  connectTeamsDb,
  disconnectTeamsDb,
  isConnected,
  getConnection,
  // Legacy aliases
  initTeamServiceDb,
  closeDb,
} from "./database.js";
