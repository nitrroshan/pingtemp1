/**
 * ServiceRegistry — selects MongoDB or file-based services based on config.
 *
 * Both modes return the same ServiceRegistry interface.
 * Route-layer code NEVER branches on storage mode — it always
 * calls the same service methods regardless of backend.
 */

import path from "path";
import { getConfig } from "../config/index.js";
import type {
  ITeamService, IAgentService, ISkillService, IAgentSkillService,
  IChatService, IGoalService, IMemberService,
} from "./contracts/index.js";

export interface ServiceRegistry {
  teams: ITeamService;
  agents: IAgentService;
  skills: ISkillService;
  agentSkills: IAgentSkillService;
  chat: IChatService;
  goals: IGoalService;
  members: IMemberService;
  mode: "file" | "mongo";
}

/**
 * Create all service instances based on config.
 * @param dataDir — base directory for JSON files (default: ./data)
 */
export async function createServiceRegistry(dataDir: string = "./data"): Promise<ServiceRegistry> {
  const config = getConfig();

  if (config.mongodbUri) {
    // MongoDB mode — lazy import to avoid loading Mongoose when not needed
    const { createMongoServices } = await import("./mongo/index.js");
    return createMongoServices();
  }

  // File mode — lowdb JSON files
  const {
    FileTeamService, FileAgentService, FileSkillService,
    FileAgentSkillService, FileChatService, FileGoalService, FileMemberService,
  } = await import("./file/index.js");

  const teamService = new FileTeamService(path.join(dataDir, "teams.json"));
  const agentService = new FileAgentService(path.join(dataDir, "agents.json"));
  const skillService = new FileSkillService(path.join(dataDir, "skills.json"));
  const agentSkillService = new FileAgentSkillService(path.join(dataDir, "agent-skills.json"));
  const chatService = new FileChatService(path.join(dataDir, "chats"));
  const goalService = new FileGoalService(path.join(dataDir, "goals"));
  const memberService = new FileMemberService(path.join(dataDir, "members.json"));

  await Promise.all([
    teamService.init(),
    agentService.init(),
    skillService.init(),
    agentSkillService.init(),
    memberService.init(),
  ]);

  return {
    teams: teamService,
    agents: agentService,
    skills: skillService,
    agentSkills: agentSkillService,
    chat: chatService,
    goals: goalService,
    members: memberService,
    mode: "file",
  };
}
