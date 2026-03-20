/**
 * Test Script - New Agent Architecture
 *
 * Run this to validate the new unified agent system before migrating
 * from AgentManager/RoleManager.
 *
 * Usage: npx tsx src/worker/agent/test-agent.ts
 */

import { AgentFactory } from "./AgentFactory.js";
import type { AgentEvent } from "./types.js";

// =============================================================================
// Test Configuration
// =============================================================================

const AGENTS_DIR = "./src/worker/agent/agents";

// Test prompts for each builder
const TEST_PROMPTS = {
  "role-builder":
    "Create roles for a simple code review system that reviews TypeScript code for bugs and style issues.",
  "config-builder":
    "Create an agent config for a CodeReviewer role that reviews TypeScript code.",
  "plan-builder": `
    Goal: Review a TypeScript file for bugs and style issues
    Available Roles: code-reviewer, report-writer
    Create a plan with 2-3 tasks.
  `,
};

// =============================================================================
// Test Runner
// =============================================================================

async function runTest(
  factory: AgentFactory,
  agentId: string,
): Promise<boolean> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${agentId}`);
  console.log("=".repeat(60));

  try {
    // 1. Create the agent
    console.log("\n1. Creating agent from YAML...");
    const agent = factory.createById(agentId);
    console.log(
      `   ✓ Created: ${agent.name} (type: ${agent.type}, role: ${agent.role})`,
    );

    // 2. Initialize
    console.log("\n2. Initializing agent...");
    await agent.initialize();
    console.log(`   ✓ Status: ${agent.getStatus()}`);

    // 3. Execute with test prompt
    const prompt = TEST_PROMPTS[agentId as keyof typeof TEST_PROMPTS];
    console.log("\n3. Executing with test prompt...");
    console.log(`   Prompt: "${prompt.slice(0, 80)}..."`);

    const events: AgentEvent[] = [];
    for await (const event of agent.execute({
      message: prompt,
      threadId: `test-${agentId}-${Date.now()}`,
    })) {
      events.push(event);

      // Log event type
      switch (event.type) {
        case "thinking":
          console.log(`   → Thinking: ${event.content.slice(0, 50)}...`);
          break;
        case "message":
          console.log(`   → Message received (${event.content.length} chars)`);
          break;
        case "done":
          console.log(`   → Done: ${event.summary}`);
          break;
        case "error":
          console.log(`   ✗ Error: ${event.error}`);
          break;
      }
    }

    // 4. Check result
    const doneEvent = events.find((e) => e.type === "done");
    if (doneEvent && doneEvent.type === "done") {
      console.log("\n4. Result:");
      const output = doneEvent.output;
      if (typeof output === "object") {
        console.log(
          JSON.stringify(output, null, 2).split("\n").slice(0, 15).join("\n"),
        );
        if (JSON.stringify(output).length > 500) {
          console.log("   ... (truncated)");
        }
      } else {
        console.log(`   ${String(output).slice(0, 200)}`);
      }
      console.log(`\n✓ ${agentId} PASSED`);
      return true;
    } else {
      console.log("\n✗ No done event received");
      return false;
    }
  } catch (error: any) {
    console.log(`\n✗ ${agentId} FAILED: ${error.message}`);
    console.log(error.stack);
    return false;
  }
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           NEW AGENT ARCHITECTURE TEST                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  // Check env vars
  console.log("\nEnvironment Check:");
  console.log(
    `  AZURE_OPENAI_ENDPOINT_URL: ${process.env.AZURE_OPENAI_ENDPOINT_URL ? "✓ set" : "✗ missing"}`,
  );
  console.log(
    `  AZURE_OPENAI_API_KEY: ${process.env.AZURE_OPENAI_API_KEY ? "✓ set" : "✗ missing"}`,
  );

  if (
    !process.env.AZURE_OPENAI_ENDPOINT_URL ||
    !process.env.AZURE_OPENAI_API_KEY
  ) {
    console.log(
      "\n⚠ Warning: Azure OpenAI credentials not set. Tests may fail.",
    );
  }

  // Create factory
  console.log(`\nCreating AgentFactory from: ${AGENTS_DIR}`);
  const factory = new AgentFactory(AGENTS_DIR);

  // List available definitions
  const definitions = factory.listDefinitions();
  console.log(`Found ${definitions.length} agent definitions:`);
  definitions.forEach((d) => {
    console.log(`  - ${d.id} (type: ${d.type})`);
  });

  // Run tests
  const results: Record<string, boolean> = {};

  // Test which agents? Comment out to skip
  const agentsToTest = [
    "role-builder",
    "config-builder", // Uncomment to test
    "plan-builder", // Uncomment to test
  ];

  for (const agentId of agentsToTest) {
    results[agentId] = await runTest(factory, agentId);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = Object.values(results).filter((r) => r).length;
  const total = Object.keys(results).length;

  for (const [agentId, result] of Object.entries(results)) {
    console.log(`  ${result ? "✓" : "✗"} ${agentId}`);
  }

  console.log(`\nResult: ${passed}/${total} passed`);

  if (passed === total) {
    console.log("\n🎉 All tests passed! Safe to migrate.");
  } else {
    console.log("\n⚠ Some tests failed. Fix issues before migrating.");
  }
}

// Run
main().catch(console.error);
