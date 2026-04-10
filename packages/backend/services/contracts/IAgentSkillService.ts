import type { AgentSkillAssignment } from "../types/index.js";

export interface IAgentSkillService {
  assignSkillToAgent(agentId: string, skillId: string): Promise<AgentSkillAssignment>;
  removeSkillFromAgent(agentId: string, skillId: string): Promise<boolean>;
  getAgentSkills(agentId: string): Promise<AgentSkillAssignment[]>;
  setSkillEnabled(agentId: string, skillId: string, enabled: boolean): Promise<void>;
}
