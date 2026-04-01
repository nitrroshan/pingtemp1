import { AgentManager } from "../AgentManagerV2.js";
import type { TeamConfig } from "../types/index.js";

export type { TeamConfig };

export class Team {
  teamConfig: TeamConfig;
  members: string[];
  agentManager: AgentManager;

  //(TODO:Need to pass control to team to create agentManager instance for team)

  constructor(
    teamConfig: TeamConfig,
    members: string[] = [],
    agentManager: AgentManager
  ) {
    this.teamConfig = teamConfig;
    this.members = members;
    this.agentManager = agentManager;
  }
  addMember(agentId: string): void {
    if (!this.members.includes(agentId)) {
      this.members.push(agentId);
    }
  }

  // addTaskToTeam(taskDescription: string) {
  //   /* Add a new task to the team
  //     Create a new task in the AgentManager
  //   */
  //   this.agentManager.createTask({ taskDescription: taskDescription });
  // }

  get getAgentManager() {
    return this.agentManager;
  }
  get getMembers() {
    // Get team members Names from Id
    return this.members;
  }
  get getTeamInfo() {
    return {
      ...this.teamConfig,
      members: this.members.length,
    };
  }
}
