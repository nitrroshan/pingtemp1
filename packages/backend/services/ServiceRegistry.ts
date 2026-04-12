/**
 * ServiceRegistry -- creates all service instances.
 *
 * Storage strategy:
 * - Teams, agents, skills, agent-skills: always file-based (plugins are source of truth)
 * - Goals, members: always file-based (simple records, no scale concern)
 * - Chat: file-based by default, MongoDB when MONGODB_URI is set (grows unbounded, needs DB at scale)
 * - Auth: SQLite locally, MongoDB when MONGODB_URI is set (handled separately in auth/index.ts)
 *
 * Route-layer code NEVER branches on storage mode.
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
  mode: "file" | "hybrid";
}

/**
 * Create all service instances.
 * @param dataDir -- base directory for JSON files (default: ./data)
 */
export async function createServiceRegistry(dataDir: string = "./data"): Promise<ServiceRegistry> {
  const config = getConfig();

  // All file-based services (always used regardless of MongoDB)
  const {
    FileTeamService, FileAgentService, FileSkillService,
    FileAgentSkillService, FileChatService, FileGoalService, FileMemberService,
  } = await import("./file/index.js");

  const teamService = new FileTeamService(path.join(dataDir, "teams.json"));
  const agentService = new FileAgentService(path.join(dataDir, "agents.json"));
  const skillService = new FileSkillService(path.join(dataDir, "skills.json"));
  const agentSkillService = new FileAgentSkillService(path.join(dataDir, "agent-skills.json"));
  const goalService = new FileGoalService(path.join(dataDir, "goals"));
  const memberService = new FileMemberService(path.join(dataDir, "members.json"));

  await Promise.all([
    teamService.init(),
    agentService.init(),
    skillService.init(),
    agentSkillService.init(),
    memberService.init(),
  ]);

  // Chat: MongoDB in cloud mode, file-based in local mode
  let chatService: IChatService;
  if (config.mode === "cloud" && config.mongodbUri) {
    const { MongoChatService } = await import("./mongo/MongoChatService.js");
    chatService = new MongoChatService();
  } else {
    chatService = new FileChatService(path.join(dataDir, "chats"));
  }

  return {
    teams: teamService,
    agents: agentService,
    skills: skillService,
    agentSkills: agentSkillService,
    chat: chatService,
    goals: goalService,
    members: memberService,
    mode: config.mongodbUri ? "hybrid" : "file",
  };
}
