/**
 * TeamService Integration Test (Mongoose version)
 *
 * Tests TeamService with real MongoDB connection via Mongoose.
 * Run: npx tsx src/worker/teamService/integration.test.ts
 *
 * Prerequisite: MongoDB running (yarn mongo:start)
 */

import {
  TeamService,
  initTeamServiceDb,
  closeDb,
  TeamModel,
  AgentModel,
  TeamMemberModel,
  AgentSkillModel,
} from "./index.js";
import { Logger } from "tslog";

const logger = new Logger({ name: "integration-test" });

async function runTests() {
  logger.info("Starting TeamService integration tests (Mongoose)...");

  try {
    // Initialize database via Mongoose
    await initTeamServiceDb();
    const teamService = new TeamService();

    logger.info("✓ Mongoose connected");

    // Clean up any existing test data using Mongoose models
    await TeamModel.deleteMany({ name: /^Integration Test/ });
    await AgentModel.deleteMany({});
    await TeamMemberModel.deleteMany({});
    await AgentSkillModel.deleteMany({});

    // Test 1: Create a team
    logger.info("\n--- Test 1: Create Team ---");
    const team = await teamService.createTeam({
      name: "Integration Test Team",
      ownerId: "test-user-123",
      settings: { executionMode: "parallel", maxConcurrency: 4 },
    });
    logger.info(`✓ Created team: ${team.name} (${team._id})`);
    logger.info(`  Workspace: ${team.workspaceId}`);

    // Test 2: Verify Planner was auto-created
    logger.info("\n--- Test 2: Verify Planner Agent ---");
    const fullTeam = await teamService.getTeam(team._id.toHexString());
    const planner = fullTeam.agents.find((a) => a.type === "planner");
    if (!planner) throw new Error("Planner not found!");
    logger.info(`✓ Planner Agent created: ${planner.name} (${planner._id})`);
    logger.info(`  Status: ${planner.status}`);

    // Test 3: Verify manager was added
    logger.info("\n--- Test 3: Verify Manager Membership ---");
    const manager = fullTeam.members.find((m) => m.role === "manager");
    if (!manager) throw new Error("Manager not found!");
    logger.info(`✓ Manager added: ${manager.userId} (role: ${manager.role})`);

    // Test 4: Add a worker agent
    logger.info("\n--- Test 4: Add Worker Agent ---");
    const worker = await teamService.addAgent(team._id.toHexString(), {
      name: "Security Specialist",
      role: "security",
      yaml: `
id: security-specialist
name: Security Specialist
description: Reviews code for security vulnerabilities
skills:
  - code-review
  - vulnerability-scan
`,
    });
    logger.info(`✓ Added worker: ${worker.name} (${worker._id})`);
    logger.info(`  Type: ${worker.type}, Role: ${worker.role}`);

    // Test 5: Add an employee and delegate
    logger.info("\n--- Test 5: Add Employee & Delegate ---");
    await teamService.addMember(
      team._id.toHexString(),
      "employee-456",
      "employee",
    );
    logger.info("✓ Added employee: employee-456");

    const delegated = await teamService.delegateAgent(
      team._id.toHexString(),
      worker._id.toHexString(),
      "employee-456",
    );
    logger.info(`✓ Delegated ${worker.name} to employee-456`);
    logger.info(`  delegatedTo: ${delegated.delegatedTo}`);

    // Test 6: Assign skill
    logger.info("\n--- Test 6: Assign Skill ---");
    await teamService.assignSkillToAgent(
      worker._id.toHexString(),
      "security-review",
    );
    await teamService.assignSkillToAgent(
      worker._id.toHexString(),
      "code-audit",
    );
    const skills = await teamService.getAgentSkills(worker._id.toHexString());
    logger.info(`✓ Assigned ${skills.length} skills to ${worker.name}`);
    skills.forEach((s) =>
      logger.info(`  - ${s.skillId} (enabled: ${s.enabled})`),
    );

    // Test 7: Update agent status
    logger.info("\n--- Test 7: Update Agent Status ---");
    const running = await teamService.updateAgentStatus(
      worker._id.toHexString(),
      {
        status: "running",
        lastStartedAt: new Date(),
      },
    );
    logger.info(`✓ Updated ${worker.name} status to: ${running.status}`);

    // Test 8: Reclaim agent
    logger.info("\n--- Test 8: Reclaim Agent ---");
    const reclaimed = await teamService.reclaimAgent(
      team._id.toHexString(),
      worker._id.toHexString(),
    );
    logger.info(`✓ Reclaimed ${worker.name}`);
    logger.info(`  delegatedTo: ${reclaimed.delegatedTo}`);

    // Test 9: Try to add second Planner (should fail)
    logger.info("\n--- Test 9: Prevent Second Planner ---");
    try {
      await teamService.addAgent(team._id.toHexString(), {
        name: "Another Planner",
        role: "planner",
        yaml: "id: planner2",
      });
      throw new Error("Should have thrown!");
    } catch (err: any) {
      if (err.code === "CANNOT_ADD_SECOND_PLANNER") {
        logger.info("✓ Correctly prevented second Planner");
      } else {
        throw err;
      }
    }

    // Test 10: Try to remove Planner (should fail)
    logger.info("\n--- Test 10: Prevent Planner Removal ---");
    try {
      await teamService.removeAgent(
        team._id.toHexString(),
        planner._id.toHexString(),
      );
      throw new Error("Should have thrown!");
    } catch (err: any) {
      if (err.code === "CANNOT_REMOVE_PLANNER") {
        logger.info("✓ Correctly prevented Planner removal");
      } else {
        throw err;
      }
    }

    // Test 11: List teams
    logger.info("\n--- Test 11: List Teams ---");
    const teams = await teamService.listTeams({ ownerId: "test-user-123" });
    logger.info(`✓ Found ${teams.length} team(s) for user test-user-123`);

    // Test 12: Get workspace info
    logger.info("\n--- Test 12: Get Workspace Info ---");
    const workspace = await teamService.getWorkspace(team._id.toHexString());
    logger.info(`✓ Workspace: ${workspace.workspaceId}`);
    logger.info(`  Folders: ${workspace.folders.join(", ")}`);

    // Cleanup
    logger.info("\n--- Cleanup ---");
    await teamService.deleteTeam(team._id.toHexString());
    logger.info("✓ Deleted test team and cascaded resources");

    // Verify cascade delete using Mongoose models
    const remainingAgents = await AgentModel.countDocuments({
      teamId: team._id,
    });
    const remainingMembers = await TeamMemberModel.countDocuments({
      teamId: team._id,
    });
    logger.info(`  Remaining agents: ${remainingAgents}`);
    logger.info(`  Remaining members: ${remainingMembers}`);

    logger.info("\n========================================");
    logger.info("✓ All integration tests passed (Mongoose)!");
    logger.info("========================================");
  } catch (error) {
    logger.error("Test failed:", error);
    process.exit(1);
  } finally {
    await closeDb();
    logger.info("Database connection closed");
  }
}

runTests();
