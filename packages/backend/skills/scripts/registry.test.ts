#!/usr/bin/env node
/**
 * Skill Registry Service Test
 *
 * Tests the SkillRegistryService API.
 * Run: npm run test:registry
 */

import dotenv from "dotenv";
import { Logger } from "tslog";
import connectDB, { disconnectDB } from "../../db/config.js";
import { skillRegistry } from "../services/SkillRegistryService.js";
import { SkillModel } from "../schema/skillSchema.js";

dotenv.config();
const logger = new Logger({ name: "registry:test" });

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    logger.info(`✅ ${name}`);
  } catch (error: any) {
    results.push({ name, passed: false, error: error.message });
    logger.error(`❌ ${name}: ${error.message}`);
  }
}

// ============================================
// Tests
// ============================================

/**
 * Test 1: Create Skill
 */
async function testCreateSkill() {
  // Clean up first
  await SkillModel.deleteMany({ skillId: /^test-registry-/ });

  const skill = await skillRegistry.createSkill({
    skillId: "test-registry-skill",
    name: "Test Registry Skill",
    description: "A skill created through the registry service",
    version: "1.0.0",
    skillPath: "~/.ping/skills/test-registry/",
    skillMdPath: "~/.ping/skills/test-registry/SKILL.md",
    author: "test",
    source: "local",
    tags: ["test", "registry"],
  });

  if (!skill.skillId) {
    throw new Error("Skill creation failed");
  }

  if (!skill.embedding || skill.embedding.length !== 1536) {
    throw new Error("Embedding was not generated");
  }
}

/**
 * Test 2: Get Skill
 */
async function testGetSkill() {
  const skill = await skillRegistry.getSkill("test-registry-skill");

  if (!skill) {
    throw new Error("Skill not found");
  }

  if (skill.name !== "Test Registry Skill") {
    throw new Error(`Wrong skill name: ${skill.name}`);
  }
}

/**
 * Test 3: Update Skill
 */
async function testUpdateSkill() {
  const updated = await skillRegistry.updateSkill("test-registry-skill", {
    description: "Updated description for testing",
    rating: 4.5,
  });

  if (!updated) {
    throw new Error("Update failed");
  }

  if (updated.rating !== 4.5) {
    throw new Error(`Rating not updated: ${updated.rating}`);
  }

  // Embedding should be regenerated
  if (!updated.embedding || updated.embedding.length !== 1536) {
    throw new Error("Embedding not regenerated on description change");
  }
}

/**
 * Test 4: Semantic Search
 */
async function testSemanticSearch() {
  // First seed some skills
  await skillRegistry.createSkill({
    skillId: "test-registry-security",
    name: "Security Reviewer",
    description: "Reviews code for security vulnerabilities and exploits",
    version: "1.0.0",
    skillPath: "test",
    skillMdPath: "test",
    author: "test",
    source: "local",
    tags: ["security"],
  });

  await skillRegistry.createSkill({
    skillId: "test-registry-cooking",
    name: "Recipe Writer",
    description: "Writes cooking recipes and meal plans",
    version: "1.0.0",
    skillPath: "test",
    skillMdPath: "test",
    author: "test",
    source: "local",
    tags: ["cooking"],
  });

  // Search for security-related skills
  const results = await skillRegistry.searchSkills({
    query: "find security issues in code",
    limit: 5,
  });

  if (results.length === 0) {
    throw new Error("No search results returned");
  }

  // Security skill should rank higher than cooking
  const securityResult = results.find((r) =>
    r.skill.skillId === "test-registry-security"
  );
  const cookingResult = results.find((r) =>
    r.skill.skillId === "test-registry-cooking"
  );

  if (!securityResult || !cookingResult) {
    throw new Error("Expected skills not found in results");
  }

  if (securityResult.score <= cookingResult.score) {
    throw new Error(
      `Security skill (${securityResult.score.toFixed(3)}) should rank ` +
        `higher than cooking (${cookingResult.score.toFixed(3)})`
    );
  }

  logger.info(`  Security score: ${securityResult.score.toFixed(3)}`);
  logger.info(`  Cooking score: ${cookingResult.score.toFixed(3)}`);
}

/**
 * Test 5: Find Skill for Task
 */
async function testFindSkillForTask() {
  const result = await skillRegistry.findSkillForTask(
    "Check this code for SQL injection vulnerabilities"
  );

  if (!result) {
    throw new Error("No skill found for task");
  }

  // Should match security skill
  if (!result.skill.tags?.includes("security")) {
    throw new Error(`Expected security skill, got: ${result.skill.skillId}`);
  }

  logger.info(`  Best match: ${result.skill.skillId} (score: ${result.score.toFixed(3)})`);
}

/**
 * Test 6: Agent Skill Assignment
 */
async function testAgentSkillAssignment() {
  // Assign skill
  await skillRegistry.assignSkillToAgent("test-agent-1", "test-registry-security");
  await skillRegistry.assignSkillToAgent("test-agent-1", "test-registry-cooking");

  // Get agent skills
  const skills = await skillRegistry.getAgentSkills("test-agent-1");

  if (skills.length !== 2) {
    throw new Error(`Expected 2 skills, got ${skills.length}`);
  }

  // Get agents with skill
  const agents = await skillRegistry.getAgentsWithSkill("test-registry-security");

  if (!agents.includes("test-agent-1")) {
    throw new Error("Agent not found for skill");
  }

  // Remove skill
  await skillRegistry.removeSkillFromAgent("test-agent-1", "test-registry-cooking");
  const updatedSkills = await skillRegistry.getAgentSkills("test-agent-1");

  if (updatedSkills.length !== 1) {
    throw new Error(`Expected 1 skill after removal, got ${updatedSkills.length}`);
  }
}

/**
 * Test 7: Find Similar Skills
 */
async function testFindSimilarSkills() {
  const similar = await skillRegistry.findSimilarSkills("test-registry-security", 3);

  if (similar.length === 0) {
    throw new Error("No similar skills found");
  }

  // Should not include the original skill
  const hasSelf = similar.some((r) => r.skill.skillId === "test-registry-security");
  if (hasSelf) {
    throw new Error("Similar skills should not include the original");
  }

  logger.info(`  Found ${similar.length} similar skills`);
}

/**
 * Test 8: Get Stats
 */
async function testGetStats() {
  const stats = await skillRegistry.getStats();

  if (stats.totalSkills === 0) {
    throw new Error("No skills counted");
  }

  logger.info(`  Total skills: ${stats.totalSkills}`);
  logger.info(`  Sources: ${JSON.stringify(stats.bySource)}`);
}

/**
 * Test 9: Delete Skill
 */
async function testDeleteSkill() {
  const deleted = await skillRegistry.deleteSkill("test-registry-skill");

  if (!deleted) {
    throw new Error("Delete returned false");
  }

  const skill = await skillRegistry.getSkill("test-registry-skill");

  if (skill) {
    throw new Error("Skill still exists after delete");
  }
}

// ============================================
// Main
// ============================================

async function runAllTests() {
  logger.info("🧪 Starting Skill Registry Service Tests");
  logger.info("==================================================");

  await connectDB();

  await runTest("Create Skill", testCreateSkill);
  await runTest("Get Skill", testGetSkill);
  await runTest("Update Skill", testUpdateSkill);
  await runTest("Semantic Search", testSemanticSearch);
  await runTest("Find Skill for Task", testFindSkillForTask);
  await runTest("Agent Skill Assignment", testAgentSkillAssignment);
  await runTest("Find Similar Skills", testFindSimilarSkills);
  await runTest("Get Stats", testGetStats);
  await runTest("Delete Skill", testDeleteSkill);

  // Summary
  logger.info("\n==================================================");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  logger.info(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    logger.error("\n❌ Failed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => logger.error(`  - ${r.name}: ${r.error}`));
  } else {
    logger.info("\n✅ All tests passed!");
  }

  // Cleanup test data
  await SkillModel.deleteMany({ skillId: /^test-registry-/ });

  await disconnectDB();
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
  logger.error("Test suite failed:", err);
  process.exit(1);
});
