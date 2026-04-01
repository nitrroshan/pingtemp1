/**
 * AgentManagerV2 End-to-End Test (Legacy Flow)
 *
 * ⚠️  DEPRECATED: This test uses the legacy flow which is deprecated.
 * Use agentManagerV2.orchestrator.test.ts for the new orchestrator flow.
 *
 * Tests the old flow: DefinitionBuilder → WorkerPool
 * New flow: initializeOrchestrator → handleUserMessage → approvePlan
 */

import { AgentManager } from "./AgentManagerV2.js";

async function testAgentManagerV2(task: string): Promise<void> {
  console.log("=".repeat(60));
  console.log("AgentManagerV2 End-to-End Test");
  console.log("=".repeat(60));
  console.log(`Task: "${task}"\n`);

  const mgr = new AgentManager();

  try {
    // Step 1: Configure Workflow (DefinitionBuilder)
    console.log(">>> Step 1: Configure Workflow (DefinitionBuilder)");
    const agents = await mgr.configureWorkflow(task);
    console.log(`✓ Configured ${agents.length} agents:`);
    for (const agent of agents) {
      console.log(`  - ${agent.role}: ${agent.goal}`);
      console.log(`    systemPrompt: ${agent.systemPrompt?.slice(0, 100)}...`);
    }
    console.log();

    // Step 2: Create Plan (PlanBuilder)
    console.log(">>> Step 2: Create Plan (PlanBuilder)");
    const plan = await mgr.createPlan(task);
    console.log(`✓ Created ${plan.tasks.length} tasks:`);
    for (const t of plan.tasks) {
      console.log(
        `  - [${t.assignedRole}] ${t.title || t.description.slice(0, 50)}`,
      );
    }
    if (plan.rationale) {
      console.log(`  Rationale: ${plan.rationale}`);
    }
    console.log();

    // Step 3: Execute ONE Task (WorkerPool)
    console.log(">>> Step 3: Execute One Task (WorkerPool)");

    // Subscribe to events for real-time output
    mgr.events.on("worker:event", ({ taskId, event }) => {
      if (event.type === "message_delta") {
        process.stdout.write((event as any).delta || "");
      }
    });

    mgr.events.on("worker:done", ({ taskId }) => {
      console.log(`\n✓ Task completed: ${taskId}`);
    });

    mgr.events.on("worker:error", ({ taskId, error }) => {
      console.error(`\n✗ Task failed: ${taskId} - ${error}`);
    });

    // Execute just the first task with conversation loop
    const firstTask = plan.tasks[0];
    if (!firstTask) {
      throw new Error("No tasks in plan");
    }
    console.log(`\nStarting conversation with: [${firstTask.assignedRole}]`);
    console.log(`Initial task: ${firstTask.title || firstTask.id}`);
    console.log(`Type 'exit' to end the conversation.\n`);

    // First message - the task description
    let message = firstTask.description;

    // Import readline for interactive input
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer));
      });
    };

    // Conversation loop
    let turnCount = 0;
    let taskId: string | null = null;

    while (true) {
      turnCount++;
      console.log(`\n--- Turn ${turnCount} ---`);
      console.log(
        `You: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`,
      );
      console.log(`\nAgent (${firstTask.assignedRole}):`);

      let result: any;
      if (!taskId) {
        // First message: startTask creates the taskId
        const { taskId: newTaskId, response } = await mgr.startTask(
          firstTask.assignedRole,
          message,
        );
        taskId = newTaskId;
        result = response;
      } else {
        // Subsequent messages: continueTask uses existing taskId
        result = await mgr.continueTask(taskId, message);
      }

      // Print result
      console.log("\n");
      if (typeof result === "string") {
        console.log(result);
      } else if (result?.response) {
        console.log(result.response);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }

      // Get next input
      console.log();
      const nextMessage = await askQuestion("You (or 'exit'): ");

      if (nextMessage.toLowerCase() === "exit") {
        console.log("\nEnding conversation.");
        if (taskId) {
          await mgr.stopTask(taskId);
        }
        break;
      }

      message = nextMessage;
    }

    rl.close();
    console.log(`\n✓ Completed ${turnCount} turns`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Conversation ended");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await mgr.dispose();
    console.log("\n✓ AgentManager disposed");
  }
}

// Run test
const testTask = "Analyze customer feedback and suggest improvements";

testAgentManagerV2(testTask).then(() => {
  console.log("\n" + "=".repeat(60));
  console.log("Test completed.");
  console.log("=".repeat(60));
});
