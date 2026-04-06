/**
 * AgentManagerV2 Orchestrator Mode End-to-End Test
 *
 * Tests the orchestrator flow (default mode):
 * 1. Initialize orchestrator with team roles
 * 2. Send conversational messages
 * 3. Receive plan proposal
 * 4. Approve plan
 * 5. Tasks added to MemoryManager
 *
 * Run with: npx tsx src/worker/agentManager/agentManagerV2.orchestrator.test.ts
 * (Orchestrator mode is now the default - no flag needed)
 *
 * To test legacy mode (deprecated): USE_ORCHESTRATOR=false npx tsx ...
 */

import { AgentManager } from "./AgentManagerV2.js";

/**
 * Timeout wrapper for async operations
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );
  return Promise.race([promise, timeout]);
}

async function testOrchestratorMode(): Promise<void> {
  console.log("=".repeat(60));
  console.log("AgentManagerV2 Orchestrator Mode E2E Test");
  console.log(
    `USE_ORCHESTRATOR: ${process.env.USE_ORCHESTRATOR || "not set (default: true)"}`,
  );
  console.log("=".repeat(60));

  // Check feature flag - now defaults to true
  if (process.env.USE_ORCHESTRATOR === "false") {
    console.error("\n⚠️  USE_ORCHESTRATOR=false is deprecated.");
    console.error("   Orchestrator mode is now the default.");
    console.error("   Remove USE_ORCHESTRATOR=false to run this test.\n");
    return;
  }

  const mgr = new AgentManager();
  let rlInterface: any = null;

  // Event handler functions (for cleanup)
  // Register stream callbacks (replaces EventEmitter subscription)
  mgr.registerStreamCallbacks({
    onPlanProposed: (data) => {
      console.log("\n📋 [EVENT] plan:proposed");
      console.log(`   Team: ${data.teamId}`);
      console.log(`   Plan ID: ${data.plan?.planId}`);
      console.log(`   Tasks: ${data.plan?.tasks?.length || 0}`);
      if (data.plan?.tasks) {
        for (const t of data.plan.tasks) {
          console.log(
            `     - [${t.assignedRole}] ${t.title}: ${t.description.slice(0, 60)}...`,
          );
        }
      }
    },
    onPlanUpdate: (data) => {
      if (data.action === "approved") {
        console.log("\n✅ [EVENT] plan:approved");
        console.log(`   Tasks Queued: ${data.tasksQueued}`);
      }
    },
  });

  // Cleanup function
  const cleanup = async () => {
    if (rlInterface) {
      rlInterface.close();
    }
    await mgr.dispose();
  };

  // Handle Ctrl+C gracefully
  process.on("SIGINT", async () => {
    console.log("\n\n⚠️  Interrupted by user. Cleaning up...");
    await cleanup();
    process.exit(0);
  });

  try {
    // Step 1: Initialize orchestrator
    console.log("\n>>> Step 1: Initialize Orchestrator");
    const teamId = "test-team-001";
    const teamRoles = ["backend", "frontend", "qa"];

    await mgr.initializeOrchestrator(teamId, teamRoles);
    console.log(`✓ Orchestrator initialized for team: ${teamId}`);
    console.log(`  Roles: ${teamRoles.join(", ")}`);
    console.log(`  State: ${mgr.getOrchestratorState()}`);

    // Step 2: Interactive conversation loop
    console.log("\n>>> Step 2: Conversation with Orchestrator");
    console.log(
      "You can converse naturally or use commands for better control.",
    );
    console.log("\nCommands:");
    console.log(
      "  /createplan <task>  - Create a plan for a task (RECOMMENDED)",
    );
    console.log("  /approve            - Approve pending plan");
    console.log("  /status             - Show orchestrator state");
    console.log("  /plan               - Show pending plan details");
    console.log("  /tasks              - Show tasks in MemoryManager");
    console.log("");
    console.log("  --- Task Lifecycle (Phase 1) ---");
    console.log("  /autoexec [on|off]  - Toggle auto-execute (default: on)");
    console.log("  /approvetask <id>   - Approve a task for chat");
    console.log("  /starttask <id>     - Start executing an approved task");
    console.log("  /completetask <id>  - Complete a task by user");
    console.log("  /workflow           - Show workflow status");
    console.log("  /agents             - Show active agents");
    console.log("");
    console.log("  /exit               - End conversation");
    console.log(
      "\nTip: Use /autoexec off BEFORE /approve to test manual task lifecycle.",
    );
    console.log();

    // Import readline
    const readline = await import("readline");
    rlInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false, // Prevent double-echo of input
    });

    const askQuestion = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        // Write prompt directly to avoid readline formatting
        process.stdout.write(prompt);
        rlInterface.question("", (answer: string) => resolve(answer.trim()));
      });
    };

    // Start with initial task description
    let message = await askQuestion("\n> ");
    let turnCount = 0;

    while (message.toLowerCase() !== "/exit") {
      turnCount++;

      // Auto-detect approval keywords
      const lowerMsg = message.toLowerCase().trim();
      if (
        (lowerMsg === "approve" ||
          lowerMsg === "approved" ||
          lowerMsg === "yes" ||
          lowerMsg === "ok") &&
        mgr.getOrchestratorState() === "awaiting_approval"
      ) {
        message = "/approve";
      }

      // Handle commands
      if (message.startsWith("/")) {
        const cmd = message.toLowerCase().trim();

        if (cmd.startsWith("/createplan ")) {
          const taskDescription = message.slice("/createplan ".length).trim();
          if (!taskDescription) {
            console.log("Usage: /createplan <task description>");
          } else {
            console.log(`\n[Creating plan for: "${taskDescription}"]`);
            console.log("Sending to orchestrator...\n");
            try {
              // Send message asking to create a plan
              const planRequest = `Please create a plan for the following task: ${taskDescription}`;
              const response = await withTimeout(
                mgr.orchestratorMessage(planRequest),
                120000, // 2 minutes timeout
                "Create plan request",
              );
              console.log("Orchestrator:");
              console.log(response);
              console.log(`\n  [State: ${mgr.getOrchestratorState()}]`);
            } catch (error) {
              console.error(
                "Error:",
                error instanceof Error ? error.message : error,
              );
            }
          }
        } else if (cmd === "/approve") {
          console.log("\n[Approving plan...]");
          const result = await mgr.approveOrchestratorPlan();
          if (result.success) {
            console.log(`✓ Plan approved! ${result.tasksQueued} tasks queued.`);
          } else {
            console.log(`✗ Approval failed: ${result.error}`);
          }
          console.log(`  State: ${mgr.getOrchestratorState()}`);
        } else if (cmd === "/status") {
          console.log(`\n[Status]`);
          console.log(`  State: ${mgr.getOrchestratorState()}`);
          console.log(
            `  Has pending plan: ${mgr.getOrchestratorPendingPlan() !== null}`,
          );
        } else if (cmd === "/plan") {
          const plan = mgr.getOrchestratorPendingPlan();
          if (plan) {
            console.log("\n[Pending Plan]");
            console.log(JSON.stringify(plan, null, 2));
          } else {
            console.log("\n[No pending plan]");
          }
        } else if (cmd === "/tasks") {
          const mm = mgr.getMemoryManager();
          if (mm) {
            console.log("\n[Tasks in MemoryManager]");
            for (const role of ["backend", "frontend", "qa"]) {
              const tasks = mm.getTasks(role);
              console.log(`  ${role}: ${tasks.length} ready tasks`);
              for (const t of tasks) {
                console.log(
                  `    - [${t.status}] ${t.id}: ${t.description.slice(0, 50)}...`,
                );
              }
            }
          } else {
            console.log("\n[MemoryManager not initialized]");
          }
        } else if (cmd.startsWith("/autoexec")) {
          // Toggle auto-execute mode
          const arg = message.slice("/autoexec".length).trim().toLowerCase();
          if (arg === "on" || arg === "true") {
            mgr.setAutoExecute(true);
            console.log(
              "\n✓ Auto-execute ENABLED - tasks will run automatically",
            );
          } else if (arg === "off" || arg === "false") {
            mgr.setAutoExecute(false);
            console.log(
              "\n✓ Auto-execute DISABLED - tasks wait for manual approval",
            );
            console.log("  Use /approvetask <id> to start a task");
          } else {
            const current = mgr.getAutoExecute();
            console.log(`\n[Auto-execute: ${current ? "ON" : "OFF"}]`);
            console.log("Usage: /autoexec [on|off]");
          }
        } else if (cmd.startsWith("/approvetask ")) {
          // Phase 1: Approve task for chat
          const taskId = message.slice("/approvetask ".length).trim();
          if (!taskId) {
            console.log("Usage: /approvetask <taskId>");
          } else {
            console.log(`\n[Approving task for chat: ${taskId}]`);
            try {
              const result = mgr.approveTaskForChat(taskId);
              console.log(`✓ Task approved for chat`);
              console.log(`  Task ID: ${result.taskId}`);
              console.log(`  Role: ${result.role}`);
              console.log(
                `\n  Now you can use /starttask ${taskId} to start working`,
              );
            } catch (error) {
              console.error(
                "✗ Error:",
                error instanceof Error ? error.message : error,
              );
            }
          }
        } else if (cmd.startsWith("/starttask ")) {
          // Start executing an approved task
          const taskId = message.slice("/starttask ".length).trim();
          if (!taskId) {
            console.log("Usage: /starttask <taskId>");
          } else {
            console.log(`\n[Starting task execution: ${taskId}]`);
            try {
              const result = await mgr.startTaskExecution(taskId);
              console.log(`✓ Task started`);
              console.log(`  Task ID: ${result.taskId}`);
              console.log(`  Role: ${result.role}`);
              console.log(`\n  Agent Response:`);
              console.log(
                `  ${result.response.slice(0, 500)}${result.response.length > 500 ? "..." : ""}`,
              );
              console.log(
                `\n  Use /completetask ${taskId} when satisfied with the work`,
              );
            } catch (error) {
              console.error(
                "✗ Error:",
                error instanceof Error ? error.message : error,
              );
            }
          }
        } else if (cmd.startsWith("/completetask ")) {
          // Phase 1: Complete task by user
          const taskId = message.slice("/completetask ".length).trim();
          if (!taskId) {
            console.log("Usage: /completetask <taskId>");
          } else {
            console.log(`\n[Completing task: ${taskId}]`);
            try {
              const result = await mgr.completeTaskByUser(taskId);
              if (result.success) {
                console.log(`✓ Task completed successfully`);
                if (result.mergeError) {
                  console.log(`  ⚠️  Merge warning: ${result.mergeError}`);
                }
              } else {
                console.log(`✗ Completion failed: ${result.mergeError}`);
              }
            } catch (error) {
              console.error(
                "✗ Error:",
                error instanceof Error ? error.message : error,
              );
            }
          }
        } else if (cmd === "/workflow") {
          // Phase 1: Show workflow status
          console.log("\n[Workflow Status]");
          try {
            const status = mgr.getWorkflowStatus();
            console.log(`  State: ${status.state}`);
            console.log(`  Pending Tasks: ${status.pendingTasks}`);
            console.log(`  Active Tasks: ${status.activeTasks}`);
            console.log(`  Completed Tasks: ${status.completedTasks}`);
            if (status.currentPlan) {
              console.log(`  Current Plan: ${status.currentPlan}`);
            }
          } catch (error) {
            console.error(
              "✗ Error:",
              error instanceof Error ? error.message : error,
            );
          }
        } else if (cmd === "/agents") {
          // Phase 1: Show active agents
          console.log("\n[Active Agents]");
          try {
            const agents = mgr.getActiveAgents();
            if (agents.length === 0) {
              console.log("  No active agents");
            } else {
              for (const agent of agents) {
                console.log(
                  `  - [${agent.status}] ${agent.role}: ${agent.taskId}`,
                );
              }
            }
          } catch (error) {
            console.error(
              "✗ Error:",
              error instanceof Error ? error.message : error,
            );
          }
        } else {
          console.log(`Unknown command: ${cmd}`);
        }
      } else {
        // Regular message - send to orchestrator
        console.log(`\n--- Turn ${turnCount} ---`);
        console.log("\nOrchestrator thinking...\n");

        try {
          const response = await withTimeout(
            mgr.orchestratorMessage(message),
            120000, // 2 minutes timeout
            "Orchestrator message",
          );
          console.log("Orchestrator:");
          console.log(response);
          console.log(`\n  [State: ${mgr.getOrchestratorState()}]`);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.error("\n❌ Error:", errorMsg);

          if (errorMsg.includes("timed out")) {
            console.log(
              "\n💡 Tip: The LLM call may be taking too long. Possible causes:",
            );
            console.log("   - Azure OpenAI API rate limits or throttling");
            console.log("   - Network connectivity issues");
            console.log("   - Very long conversation context");
            console.log("\nYou can try:");
            console.log("   - Waiting a moment and trying again");
            console.log("   - Using /status to check state");
            console.log(
              "   - Starting a new conversation with /exit and rerun",
            );
          } else if (
            errorMsg.includes("content") &&
            (errorMsg.includes("filter") || errorMsg.includes("policy"))
          ) {
            console.log("\n💡 Azure Content Filter triggered. This means:");
            console.log(
              "   - Your message or the conversation context triggered safety filters",
            );
            console.log(
              "   - Azure OpenAI blocked the request for content policy reasons",
            );
            console.log("\nWhat to try:");
            console.log(
              "   1. Use /createplan <task> explicitly instead of conversational mode",
            );
            console.log("   2. Rephrase your request with different wording");
            console.log(
              "   3. If state is awaiting_approval, use /approve directly",
            );
            console.log("   4. Check /status to see current state");
            console.log(
              "   5. Restart with /exit and use more specific commands",
            );
          } else if (
            errorMsg.includes("400") ||
            errorMsg.includes("401") ||
            errorMsg.includes("403")
          ) {
            console.log("\n💡 API Error. Possible causes:");
            console.log("   - Invalid API key or endpoint configuration");
            console.log("   - Request exceeds token limits");
            console.log("   - Model deployment not available");
            console.log(
              "\nCheck your .env configuration for Azure OpenAI settings.",
            );
          }
        }
      }

      // Get next input
      message = await askQuestion("\n> ");
    }

    // Final summary
    console.log("\n" + "=".repeat(60));
    console.log("Test Summary");
    console.log("=".repeat(60));
    console.log(`Turns: ${turnCount}`);
    console.log(`Final state: ${mgr.getOrchestratorState()}`);

    const mm = mgr.getMemoryManager();
    if (mm) {
      let totalTasks = 0;
      for (const role of ["backend", "frontend", "qa"]) {
        totalTasks += mm.getTasks(role).length;
      }
      console.log(`Tasks in MemoryManager: ${totalTasks}`);
    }
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await cleanup();
    console.log("\n✓ Cleanup completed");
  }
}

// Run test
testOrchestratorMode().then(() => {
  console.log("\n" + "=".repeat(60));
  console.log("Test completed.");
  console.log("=".repeat(60));
  process.exit(0);
});
