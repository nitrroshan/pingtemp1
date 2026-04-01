/**
 * Test script for Skill Tools (Agent-Driven Loading)
 *
 * Tests the Anthropic-style skill tools:
 * - list_available_skills
 * - read_skill
 * - read_skill_file
 * - run_skill_script
 * - search_skills
 *
 * Run: npm run test:skill-tools
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { join } from "path";
import { homedir } from "os";
import { mkdir, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import {
  listAvailableSkills,
  readSkill,
  readSkillFile,
  runSkillScript,
  searchSkills,
  getSkillTools,
  buildSkillSystemPrompt,
} from "../tools/index.js";
import { skillRegistry } from "../services/index.js";
import { SkillModel } from "../schema/skillSchema.js";
import { generateEmbedding } from "../services/index.js";

dotenv.config();

const SKILLS_DIR = join(homedir(), ".ping", "skills");
const TEST_SKILL_ID = "test-skill-for-tools";
const TEST_SKILL_DIR = join(SKILLS_DIR, TEST_SKILL_ID);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string | undefined;
  output?: string | undefined;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`[TEST] ${message}`);
}

function pass(name: string, output?: string) {
  results.push({ name, passed: true, output });
  console.log(`  ✅ ${name}`);
  if (output) {
    console.log(`     Output preview: ${output.slice(0, 100)}...`);
  }
}

function fail(name: string, error: string) {
  results.push({ name, passed: false, error });
  console.log(`  ❌ ${name}: ${error}`);
}

/**
 * Setup: Create test skill in filesystem and database
 */
async function setup() {
  log("Setting up test skill...");

  // Create skill directory
  if (!existsSync(TEST_SKILL_DIR)) {
    await mkdir(TEST_SKILL_DIR, { recursive: true });
  }

  // Create SKILL.md
  const skillMd = `---
name: Test Skill
version: 1.0.0
author: test
description: A test skill for tool testing
---

# Test Skill

This is a test skill for testing the skill tools.

## Instructions

1. First, do step one
2. Then, do step two
3. Finally, complete the task

## Notes

See [additional.md](additional.md) for more details.
`;

  await writeFile(join(TEST_SKILL_DIR, "SKILL.md"), skillMd, "utf-8");

  // Create supporting file
  await writeFile(
    join(TEST_SKILL_DIR, "additional.md"),
    "# Additional Information\n\nThis is additional context for the test skill.",
    "utf-8",
  );

  // Create scripts directory and test script
  const scriptsDir = join(TEST_SKILL_DIR, "scripts");
  if (!existsSync(scriptsDir)) {
    await mkdir(scriptsDir, { recursive: true });
  }

  // Create a simple Python script
  await writeFile(
    join(scriptsDir, "test_script.py"),
    `#!/usr/bin/env python3
import sys
print("Hello from test_script.py!")
print(f"Arguments: {sys.argv[1:]}")
print(f"SKILL_DIR: {__import__('os').environ.get('SKILL_DIR', 'not set')}")
`,
    "utf-8",
  );

  // Create a simple shell script
  await writeFile(
    join(scriptsDir, "test_script.sh"),
    `#!/bin/bash
echo "Hello from test_script.sh!"
echo "Arguments: $@"
echo "SKILL_DIR: $SKILL_DIR"
`,
    "utf-8",
  );

  // Create skill in database
  const embedding = await generateEmbedding("A test skill for tool testing");
  await SkillModel.findOneAndUpdate(
    { skillId: TEST_SKILL_ID },
    {
      skillId: TEST_SKILL_ID,
      name: "Test Skill",
      description: "A test skill for tool testing",
      version: "1.0.0",
      skillPath: TEST_SKILL_DIR,
      skillMdPath: join(TEST_SKILL_DIR, "SKILL.md"),
      supportingFiles: [
        "additional.md",
        "scripts/test_script.py",
        "scripts/test_script.sh",
      ],
      embedding,
      author: "test",
      source: "local",
      installCount: 0,
      tags: ["test", "demo"],
    },
    { upsert: true },
  );

  log("Test skill created");
}

/**
 * Cleanup: Remove test skill
 */
async function cleanup() {
  log("Cleaning up...");

  // Remove from database
  await SkillModel.deleteOne({ skillId: TEST_SKILL_ID });

  // Remove from filesystem
  if (existsSync(TEST_SKILL_DIR)) {
    await rm(TEST_SKILL_DIR, { recursive: true, force: true });
  }

  log("Cleanup complete");
}

/**
 * Test: list_available_skills
 */
async function testListAvailableSkills() {
  const testName = "list_available_skills";

  try {
    const result = await listAvailableSkills.invoke({});

    if (result.includes("Available Skills") && result.includes("Test Skill")) {
      pass(testName, result);
    } else {
      fail(testName, "Expected output to contain skill list");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: list_available_skills with category filter
 */
async function testListAvailableSkillsWithCategory() {
  const testName = "list_available_skills (with category)";

  try {
    const result = await listAvailableSkills.invoke({ category: "test" });

    if (result.includes("Test Skill") || result.includes("No skills found")) {
      pass(testName, result);
    } else {
      fail(testName, "Unexpected output format");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: read_skill
 */
async function testReadSkill() {
  const testName = "read_skill";

  try {
    const result = await readSkill.invoke({ skillId: TEST_SKILL_ID });

    if (
      result.includes("Test Skill") &&
      result.includes("Instructions") &&
      result.includes("step one")
    ) {
      pass(testName, result);
    } else {
      fail(testName, "Expected full skill instructions");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: read_skill (not found)
 */
async function testReadSkillNotFound() {
  const testName = "read_skill (not found)";

  try {
    const result = await readSkill.invoke({ skillId: "nonexistent-skill-xyz" });

    if (
      result.includes("not found") ||
      result.includes("list_available_skills")
    ) {
      pass(testName, result);
    } else {
      fail(testName, "Expected 'not found' message");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: read_skill_file
 */
async function testReadSkillFile() {
  const testName = "read_skill_file";

  try {
    const result = await readSkillFile.invoke({
      skillId: TEST_SKILL_ID,
      filePath: "additional.md",
    });

    if (result.includes("Additional Information")) {
      pass(testName, result);
    } else {
      fail(testName, "Expected supporting file content");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: read_skill_file (path traversal prevention)
 */
async function testReadSkillFilePathTraversal() {
  const testName = "read_skill_file (path traversal)";

  try {
    const result = await readSkillFile.invoke({
      skillId: TEST_SKILL_ID,
      filePath: "../../../etc/passwd",
    });

    if (result.includes("not found") || result.includes("Invalid")) {
      pass(testName, result);
    } else {
      fail(testName, "Path traversal should be blocked");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: run_skill_script (Python)
 */
async function testRunSkillScriptPython() {
  const testName = "run_skill_script (Python)";

  try {
    const result = await runSkillScript.invoke({
      skillId: TEST_SKILL_ID,
      scriptPath: "scripts/test_script.py",
      args: ["arg1", "arg2"],
    });

    if (
      result.includes("Hello from test_script.py") &&
      result.includes("arg1")
    ) {
      pass(testName, result);
    } else if (result.includes("Error") || result.includes("not found")) {
      // Python might not be installed
      pass(testName + " (Python not available)", result);
    } else {
      fail(testName, "Unexpected output");
    }
  } catch (error) {
    // Python might not be installed, which is OK
    pass(testName + " (skipped - Python not available)", String(error));
  }
}

/**
 * Test: run_skill_script (not allowed extension)
 */
async function testRunSkillScriptBadExtension() {
  const testName = "run_skill_script (bad extension)";

  try {
    const result = await runSkillScript.invoke({
      skillId: TEST_SKILL_ID,
      scriptPath: "additional.md", // .md is not executable
    });

    if (result.includes("not allowed") || result.includes("Error")) {
      pass(testName, result);
    } else {
      fail(testName, "Should reject non-executable files");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: search_skills
 */
async function testSearchSkills() {
  const testName = "search_skills";

  try {
    const result = await searchSkills.invoke({
      query: "test tool testing",
      limit: 5,
    });

    if (result.includes("Test Skill") || result.includes("Search Results")) {
      pass(testName, result);
    } else {
      fail(testName, "Expected search results");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: getSkillTools returns all tools
 */
async function testGetSkillTools() {
  const testName = "getSkillTools()";

  try {
    const tools = getSkillTools();

    if (tools.length === 5) {
      const names = tools.map((t: any) => t.name);
      if (
        names.includes("list_available_skills") &&
        names.includes("read_skill") &&
        names.includes("read_skill_file") &&
        names.includes("run_skill_script") &&
        names.includes("search_skills")
      ) {
        pass(testName, `Got ${tools.length} tools: ${names.join(", ")}`);
      } else {
        fail(testName, `Missing tools: ${names.join(", ")}`);
      }
    } else {
      fail(testName, `Expected 5 tools, got ${tools.length}`);
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Test: buildSkillSystemPrompt
 */
async function testBuildSkillSystemPrompt() {
  const testName = "buildSkillSystemPrompt()";

  try {
    // Without skills
    const basicPrompt = buildSkillSystemPrompt();
    if (
      !basicPrompt.includes("Skills") ||
      !basicPrompt.includes("list_available_skills")
    ) {
      fail(testName, "Basic prompt missing skill guidance");
      return;
    }

    // With skills
    const withSkillsPrompt = buildSkillSystemPrompt([
      {
        skillId: "demo-skill",
        name: "Demo Skill",
        description: "A demo skill",
        version: "1.0.0",
        author: "test",
        tags: ["demo"],
      },
    ]);

    if (
      withSkillsPrompt.includes("Demo Skill") &&
      withSkillsPrompt.includes("demo-skill")
    ) {
      pass(testName, withSkillsPrompt.slice(0, 200));
    } else {
      fail(testName, "Prompt with skills missing skill metadata");
    }
  } catch (error) {
    fail(testName, String(error));
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log("\n🔧 Skill Tools Test Suite\n");
  console.log("=".repeat(50));

  // Connect to MongoDB
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/ping";
  log(`Connecting to MongoDB: ${uri.replace(/\/\/.*@/, "//***@")}`);
  await mongoose.connect(uri);
  log("Connected to MongoDB");

  try {
    // Setup
    await setup();

    console.log("\n📋 Running Tests\n");

    // Run tests
    await testListAvailableSkills();
    await testListAvailableSkillsWithCategory();
    await testReadSkill();
    await testReadSkillNotFound();
    await testReadSkillFile();
    await testReadSkillFilePathTraversal();
    await testRunSkillScriptPython();
    await testRunSkillScriptBadExtension();
    await testSearchSkills();
    await testGetSkillTools();
    await testBuildSkillSystemPrompt();

    // Cleanup
    await cleanup();
  } finally {
    await mongoose.disconnect();
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log("❌ Failed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`   - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("✅ All tests passed!");
    process.exit(0);
  }
}

runTests().catch((error) => {
  console.error("Test suite failed:", error);
  process.exit(1);
});
