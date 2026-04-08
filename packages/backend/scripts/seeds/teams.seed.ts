/**
 * Teams Seed
 *
 * Creates sample teams for demo and testing.
 * Idempotent — safe to run multiple times (upserts by teamName).
 */

import { rootLogger } from "../../logging/index.js";
import { TeamModel } from "../../agentManager/team/schema/teamSchema.js";

const logger = rootLogger.child({ module: "seed:teams" });

export interface SeededTeam {
  id: string;
  name: string;
  goal: string;
}

const SAMPLE_TEAMS = [
  {
    teamName: "Engineering Team",
    goal: "Build a full-stack web application",
    description:
      "A team of engineers focused on delivering high-quality software products. Handles backend API, frontend UI, database design, and DevOps.",
  },
  {
    teamName: "Product Team",
    goal: "Define and ship product features that delight users",
    description:
      "A cross-functional product team that researches user needs, defines requirements, and coordinates delivery.",
  },
  {
    teamName: "Research Team",
    goal: "Analyze market trends and synthesize insights",
    description:
      "A research team that gathers data, performs analysis, and produces actionable reports.",
  },
] as const;

export async function seedTeams(): Promise<SeededTeam[]> {
  logger.info("[seed:teams] Seeding sample teams...");

  const seeded: SeededTeam[] = [];

  for (const teamData of SAMPLE_TEAMS) {
    // Upsert — find by name, create if missing
    const existing = await TeamModel.findOne({ teamName: teamData.teamName });

    if (existing) {
      logger.info(`[seed:teams] Team already exists: ${teamData.teamName}`);
      seeded.push({
        id: existing._id.toString(),
        name: existing.teamName,
        goal: existing.goal,
      });
    } else {
      const team = await TeamModel.create(teamData);
      logger.info(`[seed:teams] Created team: ${teamData.teamName} (${team._id})`);
      seeded.push({
        id: team._id.toString(),
        name: team.teamName,
        goal: team.goal,
      });
    }
  }

  logger.info(`[seed:teams] Done. ${seeded.length} teams seeded.`);
  return seeded;
}
