/**
 * Mongoose schemas — single canonical location for all Mongo models.
 *
 * Import from here instead of scattered locations across the codebase.
 */

export { TeamConfigModel, type ITeamConfig } from "./TeamConfigSchema.js";
export { AgentRoleModel, type IAgentRole } from "./AgentRoleSchema.js";
export { ChatMessageModel, type IChatMessage } from "./ChatMessageSchema.js";
export { GoalModel, type IGoal } from "./GoalSchema.js";
export { SkillModel, type ISkill } from "./SkillSchema.js";
export { AgentSkillModel, type IAgentSkill } from "./AgentSkillSchema.js";
export { TeamMemberModel, type ITeamMember } from "./TeamMemberSchema.js";
