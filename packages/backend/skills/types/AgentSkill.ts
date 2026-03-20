/**
 * Agent-Skill assignment type
 */

export interface AgentSkill {
  _id?: string;  // MongoDB ObjectId
  agentId: string;
  skillId: string;
  assignedAt: Date;
}
