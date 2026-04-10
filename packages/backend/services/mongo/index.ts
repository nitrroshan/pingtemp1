/**
 * MongoDB service implementations — wraps existing Mongoose models
 * behind the ServiceRegistry interfaces.
 *
 * Each adapter lazily imports its Mongoose model to avoid loading
 * Mongoose at module level when in file mode.
 */

import type { ServiceRegistry } from "../ServiceRegistry.js";
import { MongoTeamService } from "./MongoTeamService.js";
import { MongoAgentService } from "./MongoAgentService.js";
import { MongoSkillService } from "./MongoSkillService.js";
import { MongoAgentSkillService } from "./MongoAgentSkillService.js";
import { MongoChatService } from "./MongoChatService.js";
import { MongoGoalService } from "./MongoGoalService.js";
import { MongoMemberService } from "./MongoMemberService.js";

export async function createMongoServices(): Promise<ServiceRegistry> {
  return {
    teams: new MongoTeamService(),
    agents: new MongoAgentService(),
    skills: new MongoSkillService(),
    agentSkills: new MongoAgentSkillService(),
    chat: new MongoChatService(),
    goals: new MongoGoalService(),
    members: new MongoMemberService(),
    mode: "mongo",
  };
}
