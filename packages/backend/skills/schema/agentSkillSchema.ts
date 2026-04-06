/**
 * Agent Skills Collection Schema
 *
 * Single source of truth: AgentSkillModel lives in the team package (packages/backend/team/models.ts).
 * The canonical schema uses:
 *   - agentId: ObjectId (ref to Agent document)
 *   - skillId: string
 *   - enabled: boolean (used by SkillSelector UI)
 *   - assignedAt: Date
 *
 * This file re-exports from the canonical location to avoid duplicate schema registration.
 * Previously this file defined its own schema with agentId as a plain string and no
 * `enabled` field — that caused the two schemas to compete for the same "AgentSkill"
 * collection, whichever module loaded first would win. Fixed in task-004.
 */

export {
  AgentSkillModel,
  agentSkillSchema,
  type IAgentSkill,
} from "../../team/models.js";

