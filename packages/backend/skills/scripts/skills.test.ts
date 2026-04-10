#!/usr/bin/env node
/**
 * Skills System Test
 *
 * Tests MongoDB connection, schema, embedding generation, and seeding.
 * Run: npx tsx src/worker/skillRegistry/scripts/skills.test.ts
 */

import dotenv from "dotenv";
import { rootLogger } from "../../logging/index.js";
import connectDB, { disconnectDB } from "../../db/config.js";
import { SkillModel } from "../../services/mongo/schemas/SkillSchema.js";
import { AgentSkillModel } from "../../services/mongo/schemas/AgentSkillSchema.js";
import {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
} from "../services/EmbeddingService.js";

dotenv.config();
const logger = rootLogger.child({ module: "skills:test" });

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

/**
 * Test runner helper
 */
async function runTest(name: string, testFn: () => Promise<void>) {
  try {
    await testFn();
    results.push({ name, passed: true });
    logger.info(`✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
    logger.error(`❌ ${name}: ${error}`);
  }
}

/**
 * Test 1: MongoDB Connection
 */
async function testMongoConnection() {
  await connectDB();
  // If we get here, connection succeeded
}

/**
 * Test 2: Skills Schema Validation
 */
async function testSkillsSchema() {
  // Generate a real embedding for the test
  const testEmbedding = await generateEmbedding("A test skill for validation");

  // Valid skill
  const validSkill = new SkillModel({
    skillId: "test-skill",
    name: "Test Skill",
    description: "A test skill for validation",
    version: "1.0.0",
    skillPath: "~/.ping/skills/test-skill/",
    skillMdPath: "~/.ping/skills/test-skill/SKILL.md",
    author: "test",
    source: "local",
    tags: ["test"],
    embedding: testEmbedding,
  });

  const validationError = validSkill.validateSync();
  if (validationError) {
    throw new Error(
      `Valid skill failed validation: ${validationError.message}`
    );
  }

  // Invalid skill (missing required fields)
  const invalidSkill = new SkillModel({
    skillId: "bad-skill",
    // Missing: name, description, skillPath, skillMdPath
  });

  const invalidError = invalidSkill.validateSync();
  if (!invalidError) {
    throw new Error("Invalid skill should have failed validation");
  }
}

/**
 * Test 3: Embedding Generation
 */
async function testEmbeddingGeneration() {
  const text = "Reviews code for security vulnerabilities";
  const embedding = await generateEmbedding(text);

  if (!embedding || embedding.length !== 1536) {
    throw new Error(`Expected 1536 dimensions, got ${embedding?.length}`);
  }

  // Check it's actually numbers
  if (typeof embedding[0] !== "number") {
    throw new Error("Embedding should contain numbers");
  }
}

/**
 * Test 4: Cosine Similarity
 */
async function testCosineSimilarity() {
  // Similar texts should have high similarity
  const text1 = "security vulnerability scanning code review";
  const text2 = "scan code for security issues and vulnerabilities";
  const text3 = "baking chocolate chip cookies recipe";

  const emb1 = await generateEmbedding(text1);
  const emb2 = await generateEmbedding(text2);
  const emb3 = await generateEmbedding(text3);

  const sim12 = cosineSimilarity(emb1, emb2);
  const sim13 = cosineSimilarity(emb1, emb3);

  logger.info(`  Similarity (security vs security): ${sim12.toFixed(4)}`);
  logger.info(`  Similarity (security vs cooking): ${sim13.toFixed(4)}`);

  // Security texts should be more similar to each other than to cooking
  if (sim12 <= sim13) {
    throw new Error(`Expected sim12 (${sim12}) > sim13 (${sim13})`);
  }

  // Similar texts should have >0.7 similarity
  if (sim12 < 0.7) {
    throw new Error(
      `Expected similar texts to have >0.7 similarity, got ${sim12}`
    );
  }
}

/**
 * Test 5: CRUD Operations
 */
async function testCRUDOperations() {
  // Clean up any existing test data
  await SkillModel.deleteMany({ skillId: /^test-/ });

  // Generate embedding for test
  const testEmbedding = await generateEmbedding("Testing CRUD operations");

  // Create
  const skill = await SkillModel.create({
    skillId: "test-crud-skill",
    name: "Test CRUD Skill",
    description: "Testing CRUD operations",
    version: "1.0.0",
    skillPath: "~/.ping/skills/test-crud/",
    skillMdPath: "~/.ping/skills/test-crud/SKILL.md",
    author: "test",
    source: "local",
    tags: ["test", "crud"],
    embedding: testEmbedding,
  });

  if (!skill._id) {
    throw new Error("Create failed: no _id returned");
  }

  // Read
  const found = await SkillModel.findOne({ skillId: "test-crud-skill" });
  if (!found) {
    throw new Error("Read failed: skill not found");
  }

  // Update
  await SkillModel.updateOne(
    { skillId: "test-crud-skill" },
    { $set: { rating: 4.5 } }
  );
  const updated = await SkillModel.findOne({ skillId: "test-crud-skill" });
  if (updated?.rating !== 4.5) {
    throw new Error(
      `Update failed: expected rating 4.5, got ${updated?.rating}`
    );
  }

  // Delete
  await SkillModel.deleteOne({ skillId: "test-crud-skill" });
  const deleted = await SkillModel.findOne({ skillId: "test-crud-skill" });
  if (deleted) {
    throw new Error("Delete failed: skill still exists");
  }
}

/**
 * Test 6: Agent Skills Assignment
 */
async function testAgentSkillsAssignment() {
  // Clean up
  await AgentSkillModel.deleteMany({ agentId: "test-agent" });

  // Create assignment
  await AgentSkillModel.create({
    agentId: "test-agent",
    skillId: "test-skill-1",
  });

  await AgentSkillModel.create({
    agentId: "test-agent",
    skillId: "test-skill-2",
  });

  // Query assignments
  const assignments = await AgentSkillModel.find({ agentId: "test-agent" });
  if (assignments.length !== 2) {
    throw new Error(`Expected 2 assignments, got ${assignments.length}`);
  }

  // Test unique constraint (should fail on duplicate)
  try {
    await AgentSkillModel.create({
      agentId: "test-agent",
      skillId: "test-skill-1", // Duplicate
    });
    throw new Error("Should have thrown duplicate key error");
  } catch (error: any) {
    if (!error.message.includes("duplicate key") && error.code !== 11000) {
      // Re-throw if not duplicate key error
      if (!error.message.includes("Should have thrown")) {
        // Expected error, continue
      } else {
        throw error;
      }
    }
  }

  // Clean up
  await AgentSkillModel.deleteMany({ agentId: "test-agent" });
}

/**
 * Test 7: Tags Query
 */
async function testTagsQuery() {
  // Create test skills with different tags
  await SkillModel.deleteMany({ skillId: /^test-tag-/ });

  // Generate embeddings for test skills
  const embeddings = await generateEmbeddings([
    "Security testing",
    "Unit testing",
  ]);
  const securityEmbedding = embeddings[0]!;
  const testingEmbedding = embeddings[1]!;

  await SkillModel.create({
    skillId: "test-tag-security",
    name: "Test Security",
    description: "Security testing",
    version: "1.0.0",
    skillPath: "test",
    skillMdPath: "test",
    author: "test",
    source: "local",
    tags: ["security", "code-review"],
    embedding: securityEmbedding,
  });

  await SkillModel.create({
    skillId: "test-tag-testing",
    name: "Test Testing",
    description: "Unit testing",
    version: "1.0.0",
    skillPath: "test",
    skillMdPath: "test",
    author: "test",
    source: "local",
    tags: ["testing", "unit-tests"],
    embedding: testingEmbedding,
  });

  // Query by single tag
  const securitySkills = await SkillModel.find({ tags: "security" });
  if (securitySkills.length !== 1) {
    throw new Error(`Expected 1 security skill, got ${securitySkills.length}`);
  }

  // Query by multiple tags (OR)
  const multiSkills = await SkillModel.find({
    tags: { $in: ["security", "testing"] },
  });
  if (multiSkills.length !== 2) {
    throw new Error(
      `Expected 2 skills with security OR testing, got ${multiSkills.length}`
    );
  }

  // Clean up
  await SkillModel.deleteMany({ skillId: /^test-tag-/ });
}

/**
 * Run all tests
 */
async function runAllTests() {
  logger.info("🧪 Starting Skills System Tests\n");
  logger.info("=".repeat(50));

  // Test 1: MongoDB Connection
  await runTest("MongoDB Connection", testMongoConnection);

  // Test 2: Skills Schema
  await runTest("Skills Schema Validation", testSkillsSchema);

  // Test 3: Embedding Generation
  await runTest("Embedding Generation (1536 dims)", testEmbeddingGeneration);

  // Test 4: Cosine Similarity
  await runTest("Cosine Similarity Calculation", testCosineSimilarity);

  // Test 5: CRUD Operations
  await runTest("CRUD Operations", testCRUDOperations);

  // Test 6: Agent Skills Assignment
  await runTest("Agent Skills Assignment", testAgentSkillsAssignment);

  // Test 7: Tags Query
  await runTest("Tags Query (filter by tags)", testTagsQuery);

  // Summary
  logger.info("\n" + "=".repeat(50));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  logger.info(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    logger.error("\n❌ Failed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => logger.error(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    logger.info("\n✅ All tests passed!");
  }
}

// Run tests
runAllTests()
  .catch((error) => {
    logger.error("Test runner failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDB();
  });
